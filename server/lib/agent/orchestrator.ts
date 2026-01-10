// server/lib/agent/orchestrator.ts
// ReAct Agent Loop - Reason, Act, Observe, Repeat

import { AgentEvent, OrchestratorState } from './types';
import { AgentMemory, getAgentMemory } from './memory';
import { chatWithTools, LLMMessage, LLMToolMessage, LLMAssistantMessage } from '../llm-client';
import { AGENT_TOOLS } from './tools/definitions';
import { toolRegistry } from '../agent-tools';
import { classifyQuery } from './classifier';
import { classifyError, formatErrorForUser, isCriticalTool, AgentErrorType } from './errors';

export interface RunInput {
  userMessage: string;
  userId: string;
  conversationId?: string;
}

interface ReActOptions {
  model: string;
  maxIterations?: number;
  think?: boolean;
}

const AGENT_SYSTEM_PROMPT = `You are APEYOLO, a helpful 0DTE SPY options trading assistant.

You have access to tools to help answer questions. When you need information, call the appropriate tool.

IMPORTANT RULES:
1. For time/date questions, use get_current_time
2. For market data (SPY price, VIX, market status), use get_market_data
3. For portfolio information, use get_positions
4. For trading analysis, use run_engine
5. Be concise and direct in your responses
6. Always use tools when needed - don't guess or make up data

After receiving tool results, provide a helpful response to the user.`;

export class AgentOrchestrator {
  private state: OrchestratorState = 'IDLE';
  private memory: AgentMemory;

  constructor() {
    this.memory = getAgentMemory();
  }

  /**
   * Run the agent using ReAct pattern:
   * 1. Classify query complexity
   * 2. Run ReAct loop (Reason → Act → Observe → Repeat)
   * 3. Return final response
   */
  async *run(input: RunInput): AsyncGenerator<AgentEvent> {
    const startTime = Date.now();

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
      // Classify query to determine model and approach
      const classification = classifyQuery(input.userMessage);
      console.log(`[Orchestrator] Query classified as: ${classification.complexity} (${classification.reason})`);

      yield { type: 'thought', content: `Analyzing: ${classification.reason}` };
      yield* this.transitionTo('PLANNING');

      // Select options based on complexity
      const options: ReActOptions = {
        model: classification.suggestedModel,
        maxIterations: classification.complexity === 'trade' ? 5 : 3,
        think: classification.complexity === 'trade', // Enable reasoning for trade queries
      };

      // Run ReAct loop (with conversation history)
      const response = yield* this.runReActLoop(input.userMessage, options, conversationId);

      const elapsed = Date.now() - startTime;
      console.log(`[Orchestrator] Complete in ${elapsed}ms`);

      // Save to memory
      this.memory.addMessage(conversationId, {
        role: 'assistant',
        content: response,
      });

      yield { type: 'response_chunk', content: response };
      yield { type: 'done', finalResponse: response, conversationId };
      yield* this.transitionTo('IDLE');

    } catch (error) {
      const agentError = classifyError(
        error instanceof Error ? error : new Error(String(error)),
        { userMessage: input.userMessage, conversationId }
      );

      console.error(`[Orchestrator] ${agentError.type}:`, agentError.message);

      this.memory.logAudit(conversationId, 'error', {
        type: agentError.type,
        message: agentError.message,
        recoverable: agentError.recoverable,
      });

      const userMessage = formatErrorForUser(agentError);

      yield {
        type: 'done',
        finalResponse: userMessage,
        conversationId,
      };
      yield* this.transitionTo('IDLE');
    }
  }

  /**
   * ReAct Loop: Reason → Act → Observe → Repeat
   * The LLM decides what tools to call and sees the results.
   */
  private async *runReActLoop(
    userMessage: string,
    options: ReActOptions,
    conversationId: string
  ): AsyncGenerator<AgentEvent, string> {
    // Load conversation history from memory (8000 token budget)
    const historyContext = this.memory.getContext(conversationId, 8000);

    // Build system prompt with history if available
    let systemContent = AGENT_SYSTEM_PROMPT;
    if (historyContext) {
      systemContent += `\n\n## Previous Conversation\n${historyContext}`;
    }

    const messages: (LLMMessage | LLMToolMessage | LLMAssistantMessage)[] = [
      { role: 'system', content: systemContent },
      { role: 'user', content: userMessage },
    ];

    yield* this.transitionTo('EXECUTING');

    for (let iteration = 0; iteration < (options.maxIterations || 3); iteration++) {
      console.log(`[Orchestrator] ReAct iteration ${iteration + 1}`);

      // Call LLM with tools
      const response = await chatWithTools({
        model: options.model,
        messages,
        tools: AGENT_TOOLS,
        think: options.think,
      });

      // Check if LLM wants to call tools
      if (response.message.tool_calls && response.message.tool_calls.length > 0) {
        // Add assistant message with tool calls to context
        messages.push({
          role: 'assistant',
          content: response.message.content || '',
          tool_calls: response.message.tool_calls,
        });

        // Execute each tool call with error recovery
        for (const toolCall of response.message.tool_calls) {
          const toolName = toolCall.function.name;
          const toolArgs = toolCall.function.arguments;

          console.log(`[Orchestrator] Tool call: ${toolName}`, toolArgs);
          yield { type: 'tool_start', tool: toolName };

          // Execute the tool with timing
          const toolStartTime = Date.now();
          const result = await this.executeTool(toolName, toolArgs);
          const durationMs = Date.now() - toolStartTime;

          console.log(`[Orchestrator] Tool result:`, result.success ? 'success' : result.error);
          yield { type: 'tool_done', tool: toolName, result: result.data || result.error, durationMs };

          // Check for critical tool failures
          if (!result.success && isCriticalTool(toolName)) {
            // Critical tools (like trade execution) must succeed
            const errorMsg = `Critical operation failed: ${result.error}`;
            console.error(`[Orchestrator] ${errorMsg}`);
            yield* this.transitionTo('RESPONDING');
            return errorMsg;
          }

          // Add tool result to context (LLM can work with partial data)
          messages.push({
            role: 'tool',
            tool_name: toolName,
            content: JSON.stringify(result),
          });
        }

        // Continue loop - LLM will see results and decide next action
      } else {
        // No tool calls - LLM is ready to respond
        yield* this.transitionTo('RESPONDING');
        return response.message.content || "I'm not sure how to answer that.";
      }
    }

    // Max iterations reached - return whatever we have
    yield* this.transitionTo('RESPONDING');
    return "I've gathered some information but couldn't complete the analysis. Please try asking in a different way.";
  }

  /**
   * Execute a tool by name with given arguments
   */
  private async executeTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    // Check if tool exists in registry
    const tool = toolRegistry[name];
    if (!tool) {
      return { success: false, error: `Unknown tool: ${name}` };
    }

    try {
      const result = await tool.execute(args as Record<string, any>);
      return result;
    } catch (error: any) {
      console.error(`[Orchestrator] Tool ${name} error:`, error);
      return { success: false, error: error.message || 'Tool execution failed' };
    }
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
export function createAgentOrchestrator(): AgentOrchestrator {
  return new AgentOrchestrator();
}
