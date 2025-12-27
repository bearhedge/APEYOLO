// server/lib/agent/orchestrator.ts
import {
  OrchestratorState,
  SafetyLimits,
  DEFAULT_SAFETY_LIMITS,
  AgentEvent,
} from './types';
import { AgentMemory, getAgentMemory } from './memory';
import {
  chatWithTools,
  LLMMessage,
  LLMToolMessage,
  LLMAssistantMessage,
  ToolCall,
} from '../llm-client';
import { AGENT_TOOLS } from './tools/definitions';
import { thinkDeeply } from './tools/think-deeply';
import { toolRegistry } from '../agent-tools';

// Orchestrator model - fast and capable
const ORCHESTRATOR_MODEL = process.env.LLM_ORCHESTRATOR_MODEL || 'qwen2.5:32b';

export interface RunInput {
  userMessage: string;
  userId: string;
  conversationId?: string;
}

export class AgentOrchestrator {
  private state: OrchestratorState = 'IDLE';
  private memory: AgentMemory;
  private limits: SafetyLimits;
  private toolCallCount: number = 0;
  private startTime: number = 0;

  constructor(limits?: Partial<SafetyLimits>) {
    this.memory = getAgentMemory();
    this.limits = { ...DEFAULT_SAFETY_LIMITS, ...limits };
  }

  /**
   * Run the agent for a user message.
   * Uses native Ollama tool calling - the model decides what tools to use.
   */
  async *run(input: RunInput): AsyncGenerator<AgentEvent> {
    this.startTime = Date.now();
    this.toolCallCount = 0;

    const conversationId = this.memory.getOrCreateConversation(
      input.userId,
      input.conversationId
    );

    // Save user message
    this.memory.addMessage(conversationId, {
      role: 'user',
      content: input.userMessage,
    });

    try {
      yield* this.transitionTo('PLANNING');

      // Build conversation history
      const history = this.memory.getMessages(conversationId, 10);
      const messages: (LLMMessage | LLMToolMessage | LLMAssistantMessage)[] = [
        {
          role: 'system',
          content: this.getSystemPrompt(),
        },
        ...history.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      ];

      yield* this.transitionTo('EXECUTING');

      // Tool calling loop
      let iteration = 0;
      const maxIterations = this.limits.maxLoopIterations;

      while (iteration < maxIterations) {
        iteration++;

        // Check timeout
        if (Date.now() - this.startTime > this.limits.requestTimeoutMs) {
          yield { type: 'error', error: 'Request timeout', recoverable: false };
          yield* this.transitionTo('ERROR');
          yield* this.transitionTo('IDLE');
          return;
        }

        yield { type: 'thought', content: `Iteration ${iteration}: Asking model what to do...` };

        // Call model with tools
        const response = await chatWithTools({
          model: ORCHESTRATOR_MODEL,
          messages,
          tools: AGENT_TOOLS,
          think: false, // Orchestrator doesn't need deep thinking
        });

        // Add assistant message to history
        messages.push(response.message);

        // Check for tool calls
        if (response.message.tool_calls && response.message.tool_calls.length > 0) {
          yield* this.transitionTo('EXECUTING');

          // Execute each tool call
          for (const toolCall of response.message.tool_calls) {
            this.toolCallCount++;
            if (this.toolCallCount > this.limits.maxToolCalls) {
              yield { type: 'error', error: 'Max tool calls exceeded', recoverable: false };
              yield* this.transitionTo('ERROR');
              yield* this.transitionTo('IDLE');
              return;
            }

            yield { type: 'tool_start', tool: toolCall.function.name };

            // Special handling for think_deeply - show thinking indicator
            if (toolCall.function.name === 'think_deeply') {
              const query = (toolCall.function.arguments as { query?: string })?.query || 'complex question';
              yield { type: 'thought', content: `🧠 Deep thinking: "${query.slice(0, 100)}${query.length > 100 ? '...' : ''}"` };
            }

            try {
              const result = await this.executeTool(toolCall);
              const resultStr = typeof result === 'string' ? result : JSON.stringify(result);

              yield {
                type: 'tool_done',
                tool: toolCall.function.name,
                result,
                durationMs: Date.now() - this.startTime,
              };

              // Add tool result to messages
              messages.push({
                role: 'tool',
                tool_name: toolCall.function.name,
                content: resultStr,
              });
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : 'Tool error';
              yield { type: 'tool_error', tool: toolCall.function.name, error: errorMsg };

              messages.push({
                role: 'tool',
                tool_name: toolCall.function.name,
                content: `Error: ${errorMsg}`,
              });
            }
          }
        } else {
          // No tool calls - model is ready to respond
          yield* this.transitionTo('RESPONDING');

          const content = response.message.content || '';

          // Stream the response
          yield { type: 'response_chunk', content };

          // Save to memory
          this.memory.addMessage(conversationId, {
            role: 'assistant',
            content,
          });

          yield { type: 'done', finalResponse: content };
          yield* this.transitionTo('IDLE');
          return;
        }
      }

      // Max iterations reached
      yield { type: 'error', error: 'Max iterations reached', recoverable: false };
      yield* this.transitionTo('ERROR');
      yield* this.transitionTo('IDLE');

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      yield { type: 'error', error: errorMessage, recoverable: false };
      this.memory.logAudit(conversationId, 'error', { error: errorMessage });
      yield* this.transitionTo('ERROR');
      yield* this.transitionTo('IDLE');
    }
  }

  /**
   * Execute a tool call and return the result.
   */
  private async executeTool(toolCall: ToolCall): Promise<unknown> {
    const { name, arguments: args } = toolCall.function;

    switch (name) {
      case 'get_market_data': {
        const result = await toolRegistry.getMarketData.execute({});
        if (!result.success) throw new Error(result.error || 'Failed to get market data');
        return result.data;
      }

      case 'get_positions': {
        const result = await toolRegistry.getPositions.execute({});
        if (!result.success) throw new Error(result.error || 'Failed to get positions');
        return result.data;
      }

      case 'run_engine': {
        const result = await toolRegistry.runEngine.execute(args);
        if (!result.success) throw new Error(result.error || 'Failed to run engine');
        return result.data;
      }

      case 'think_deeply': {
        const { query, context } = args as { query: string; context?: string };
        const result = await thinkDeeply({ query, context });
        // Return just the conclusion for the orchestrator, reasoning is internal
        return {
          analysis: result.conclusion,
          hadDeepThinking: true,
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private getSystemPrompt(): string {
    return `You are a 0DTE SPY options trading assistant. You help users with market analysis, portfolio management, and finding trading opportunities.

You have these tools available:
- get_market_data: Get current SPY price, VIX, and market status
- get_positions: Get the user's current positions and P&L
- run_engine: Find 0DTE strangle trade opportunities
- think_deeply: Use deep analysis for complex questions

Guidelines:
- For simple greetings, respond directly without tools
- For market questions, use get_market_data
- For portfolio questions, use get_positions
- For trade requests, use run_engine
- For complex analysis or risk assessment, use think_deeply
- Be concise and helpful
- Always use real data from tools, never make up numbers`;
  }

  private async *transitionTo(newState: OrchestratorState): AsyncGenerator<AgentEvent> {
    const from = this.state;
    this.state = newState;
    yield { type: 'state_change', from, to: newState };
  }

  getState(): OrchestratorState {
    return this.state;
  }
}

// Factory function
export function createAgentOrchestrator(
  limits?: Partial<SafetyLimits>
): AgentOrchestrator {
  return new AgentOrchestrator(limits);
}
