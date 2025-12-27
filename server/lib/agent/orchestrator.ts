// server/lib/agent/orchestrator.ts
import {
  OrchestratorState,
  SafetyLimits,
  DEFAULT_SAFETY_LIMITS,
  AgentEvent,
  ExecutionPlan,
} from './types';
import { AgentPlanner, getAgentPlanner } from './planner';
import { AgentExecutor } from './executor';
import { ToolRegistry, getToolRegistry } from './tools/registry';
import { AgentMemory, getAgentMemory } from './memory';
import { streamWithProposer, type LLMMessage } from '../llm-client';

export interface RunInput {
  userMessage: string;
  userId: string;
  conversationId?: string;
}

export class AgentOrchestrator {
  private state: OrchestratorState = 'IDLE';
  private planner: AgentPlanner;
  private registry: ToolRegistry;
  private memory: AgentMemory;
  private limits: SafetyLimits;
  private toolCallCount: number = 0;
  private startTime: number = 0;

  constructor(
    registry?: ToolRegistry,
    limits?: Partial<SafetyLimits>
  ) {
    this.registry = registry || getToolRegistry();
    this.planner = getAgentPlanner();
    this.memory = getAgentMemory();
    this.limits = { ...DEFAULT_SAFETY_LIMITS, ...limits };
  }

  /**
   * Run the agent for a user message.
   * Yields events for streaming to the frontend.
   */
  async *run(input: RunInput): AsyncGenerator<AgentEvent> {
    this.startTime = Date.now();
    this.toolCallCount = 0;

    // Get or create conversation
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
      // IDLE -> PLANNING
      yield* this.transitionTo('PLANNING');

      // Create execution plan
      const context = this.memory.getMessages(conversationId, 5);
      const cachedMarket = this.memory.getCachedSnapshot(conversationId, 'market');
      const cachedPositions = this.memory.getCachedSnapshot(conversationId, 'positions');

      const plan = await this.planner.createPlan({
        userMessage: input.userMessage,
        conversationContext: context,
        cachedMarketData: cachedMarket,
        cachedPositions: cachedPositions,
      });

      yield { type: 'plan_ready', plan };

      // Log plan to audit
      this.memory.logAudit(conversationId, 'plan', plan);

      // PLANNING -> EXECUTING
      yield* this.transitionTo('EXECUTING');

      // Execute plan and collect observations
      const executor = new AgentExecutor(this.registry);
      const toolResults: Array<{ tool: string; result: unknown }> = [];

      for await (const event of executor.execute(plan.steps, conversationId)) {
        // Check timeout
        if (Date.now() - this.startTime > this.limits.requestTimeoutMs) {
          yield { type: 'error', error: 'Request timeout', recoverable: false };
          yield* this.transitionTo('ERROR');
          yield* this.transitionTo('IDLE');
          return;
        }

        // Track tool calls
        if (event.type === 'tool_done' || event.type === 'tool_error') {
          this.toolCallCount++;
          if (this.toolCallCount > this.limits.maxToolCalls) {
            yield { type: 'error', error: 'Max tool calls exceeded', recoverable: false };
            yield* this.transitionTo('ERROR');
            yield* this.transitionTo('IDLE');
            return;
          }
        }

        // Handle validation step
        if (event.type === 'validation_start' && plan.requiresValidation) {
          yield* this.transitionTo('VALIDATING');
        }

        yield event;

        // Collect tool results for LLM context
        if (event.type === 'tool_done') {
          toolResults.push({ tool: event.tool as string, result: event.result });

          // Cache tool results
          if (event.tool === 'getMarketData') {
            this.memory.cacheSnapshot(conversationId, 'market', event.result);
          } else if (event.tool === 'getPositions') {
            this.memory.cacheSnapshot(conversationId, 'positions', event.result);
          }
        }
      }

      // EXECUTING -> RESPONDING
      yield* this.transitionTo('RESPONDING');

      // Generate LLM response with tool context
      yield* this.generateResponse(input.userMessage, plan, toolResults, conversationId);

      // RESPONDING -> IDLE
      yield* this.transitionTo('IDLE');

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      yield { type: 'error', error: errorMessage, recoverable: false };

      this.memory.logAudit(conversationId, 'error', { error: errorMessage });

      yield* this.transitionTo('ERROR');
      yield* this.transitionTo('IDLE');
    }
  }

  private async *transitionTo(newState: OrchestratorState): AsyncGenerator<AgentEvent> {
    const from = this.state;
    this.state = newState;
    yield { type: 'state_change', from, to: newState };
  }

  /**
   * Generate a natural language response using the LLM.
   * Takes the user's question and tool results as context.
   */
  private async *generateResponse(
    userMessage: string,
    plan: ExecutionPlan,
    toolResults: Array<{ tool: string; result: unknown }>,
    conversationId: string
  ): AsyncGenerator<AgentEvent> {
    // Build context from tool results
    const toolContext = toolResults.map(({ tool, result }) => {
      return `[${tool}]: ${JSON.stringify(result, null, 2)}`;
    }).join('\n\n');

    // System prompt for the trading agent
    const systemPrompt = `You are an expert options trading assistant for a 0DTE SPY strangle strategy.
Your role is to help the user understand market conditions, positions, and trading opportunities.

Based on the tool data provided, give a clear, concise response to the user's question.
Be specific with numbers and data from the tools. If suggesting trades, explain the reasoning.

Keep responses focused and actionable. Avoid unnecessary preambles.`;

    // Build messages
    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Question: ${userMessage}\n\nData from tools:\n${toolContext}` },
    ];

    let fullResponse = '';

    try {
      // Stream response from LLM
      for await (const chunk of streamWithProposer(messages)) {
        if (chunk.message?.content) {
          fullResponse += chunk.message.content;
          yield { type: 'response_chunk', content: chunk.message.content };
        }

        // Also emit thinking tokens if available (DeepSeek-R1)
        if (chunk.message?.thinking) {
          yield { type: 'thought', content: chunk.message.thinking };
        }
      }

      // Save assistant response to memory
      this.memory.addMessage(conversationId, {
        role: 'assistant',
        content: fullResponse,
      });

      // Final done event with complete response
      yield { type: 'done', finalResponse: fullResponse };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'LLM error';
      console.error('[Orchestrator] LLM error:', errorMessage);

      // Fallback: return a basic response from tool data
      const fallbackResponse = this.formatFallbackResponse(toolResults);
      yield { type: 'response_chunk', content: fallbackResponse };
      yield { type: 'done', finalResponse: fallbackResponse };
    }
  }

  /**
   * Format a basic response when LLM is unavailable
   */
  private formatFallbackResponse(toolResults: Array<{ tool: string; result: unknown }>): string {
    const parts: string[] = [];

    for (const { tool, result } of toolResults) {
      if (tool === 'getMarketData' && result) {
        const data = result as { spy?: { price?: number }; vix?: { level?: number }; market?: { isOpen?: boolean } };
        if (data.spy?.price) parts.push(`SPY: $${data.spy.price.toFixed(2)}`);
        if (data.vix?.level) parts.push(`VIX: ${data.vix.level.toFixed(2)}`);
        if (data.market) parts.push(`Market: ${data.market.isOpen ? 'Open' : 'Closed'}`);
      } else if (tool === 'getPositions' && result) {
        const data = result as { summary?: { openPositionCount?: number; totalPnl?: number } };
        if (data.summary) {
          parts.push(`Positions: ${data.summary.openPositionCount || 0}`);
          if (data.summary.totalPnl !== undefined) {
            parts.push(`P&L: $${data.summary.totalPnl.toFixed(2)}`);
          }
        }
      }
    }

    return parts.length > 0
      ? parts.join(' | ') + '\n\n(LLM unavailable - showing raw data)'
      : 'Data retrieved. LLM unavailable for analysis.';
  }

  getState(): OrchestratorState {
    return this.state;
  }
}

// Factory function
export function createAgentOrchestrator(
  limits?: Partial<SafetyLimits>
): AgentOrchestrator {
  return new AgentOrchestrator(getToolRegistry(), limits);
}
