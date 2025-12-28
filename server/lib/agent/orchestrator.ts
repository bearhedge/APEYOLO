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
import { webBrowse } from './tools/web-browse';
import { toolRegistry } from '../agent-tools';

// Orchestrator model - fast and capable
const ORCHESTRATOR_MODEL = process.env.LLM_ORCHESTRATOR_MODEL || 'qwen2.5:32b';

// Logging helper
function logAgent(stage: string, details: Record<string, unknown> = {}) {
  const timestamp = new Date().toISOString();
  console.log(`[Agent ${timestamp}] ${stage}`, JSON.stringify(details, null, 2));
}

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
      logAgent('START', {
        userMessage: input.userMessage,
        userId: input.userId,
        model: ORCHESTRATOR_MODEL
      });

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

        const iterationStart = Date.now();
        logAgent('LLM_CALL_START', { iteration, model: ORCHESTRATOR_MODEL });

        yield { type: 'thought', content: `Iteration ${iteration}: Asking model what to do...` };

        // Call model with tools
        const response = await chatWithTools({
          model: ORCHESTRATOR_MODEL,
          messages,
          tools: AGENT_TOOLS,
          think: false, // Orchestrator doesn't need deep thinking
        });

        const llmDuration = Date.now() - iterationStart;
        const toolCallNames = response.message.tool_calls?.map(tc => tc.function.name) || [];
        logAgent('LLM_CALL_DONE', {
          iteration,
          durationMs: llmDuration,
          hasToolCalls: toolCallNames.length > 0,
          toolCalls: toolCallNames,
          responsePreview: response.message.content?.slice(0, 100) || '(no content)'
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

            const toolStart = Date.now();
            const toolName = toolCall.function.name;
            const toolArgs = toolCall.function.arguments;

            logAgent('TOOL_START', { tool: toolName, args: toolArgs });
            yield { type: 'tool_start', tool: toolName };

            // Special handling for think_deeply - show thinking indicator
            if (toolName === 'think_deeply') {
              const query = (toolArgs as { query?: string })?.query || 'complex question';
              logAgent('THINK_DEEPLY_START', { query: query.slice(0, 200), model: 'qwen2.5:72b' });
              yield { type: 'thought', content: `🧠 Deep thinking: "${query.slice(0, 100)}${query.length > 100 ? '...' : ''}"` };
            }

            try {
              const result = await this.executeTool(toolCall);
              const toolDuration = Date.now() - toolStart;
              const resultStr = typeof result === 'string' ? result : JSON.stringify(result);

              logAgent('TOOL_DONE', {
                tool: toolName,
                durationMs: toolDuration,
                resultPreview: resultStr.slice(0, 200)
              });

              yield {
                type: 'tool_done',
                tool: toolCall.function.name,
                result,
                durationMs: Date.now() - this.startTime,
              };

              // Emit browser screenshot if web_browse returned one
              if (toolName === 'web_browse' && result && typeof result === 'object') {
                const browseResult = result as { screenshot?: string; url?: string };
                if (browseResult.screenshot) {
                  yield {
                    type: 'browser_screenshot',
                    data: {
                      base64: browseResult.screenshot,
                      url: browseResult.url || '',
                      timestamp: Date.now(),
                    },
                  };
                }
              }

              // Add tool result to messages
              messages.push({
                role: 'tool',
                tool_name: toolCall.function.name,
                content: resultStr,
              });
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : 'Tool error';
              logAgent('TOOL_ERROR', { tool: toolName, error: errorMsg });
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
          const totalDuration = Date.now() - this.startTime;
          const content = response.message.content || '';

          logAgent('FINAL_RESPONSE', {
            totalDurationMs: totalDuration,
            toolCallCount: this.toolCallCount,
            responseLength: content.length,
            responsePreview: content.slice(0, 200)
          });

          yield* this.transitionTo('RESPONDING');

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

      case 'web_browse': {
        const { query, url } = args as { query: string; url?: string };
        const result = await webBrowse({ query, url });
        return {
          answer: result.content,
          url: result.url,
          screenshot: result.screenshot,
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private getSystemPrompt(): string {
    return `You are APEYOLO, a 0DTE SPY options trading assistant with access to real data sources.

CRITICAL RULES - NEVER VIOLATE:
1. ALWAYS use tools for factual data - NEVER make up numbers, prices, or dates
2. For SPY price, VIX, market status NOW: use get_market_data
3. For portfolio, positions, P&L: use get_positions
4. For finding trades: use run_engine
5. For general knowledge (calendars, holidays, definitions): use web_browse
6. For complex analysis requiring deep reasoning: use think_deeply
7. If you genuinely don't know and can't look it up: say "I don't know"

TOOL SELECTION GUIDE:
- "what's SPY at?" → get_market_data (NEVER guess prices)
- "is market open Monday?" → web_browse (search NYSE calendar)
- "show my positions" → get_positions
- "find me a trade" → run_engine
- "should I trade given VIX?" → think_deeply
- "what is a strangle?" → web_browse OR answer from knowledge

Be concise and direct. No emojis. Only state facts from tool outputs.`;
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
