// server/lib/agent/orchestrator.ts
import {
  OrchestratorState,
  SafetyLimits,
  DEFAULT_SAFETY_LIMITS,
  AgentEvent,
} from './types';
import { AgentPlanner, getAgentPlanner } from './planner';
import { AgentExecutor } from './executor';
import { ToolRegistry, getToolRegistry } from './tools/registry';
import { AgentMemory, getAgentMemory } from './memory';

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

      // Execute plan
      const executor = new AgentExecutor(this.registry);

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

        // Cache tool results
        if (event.type === 'tool_done') {
          if (event.tool === 'getMarketData') {
            this.memory.cacheSnapshot(conversationId, 'market', event.result);
          } else if (event.tool === 'getPositions') {
            this.memory.cacheSnapshot(conversationId, 'positions', event.result);
          }
        }
      }

      // EXECUTING -> RESPONDING -> IDLE
      yield* this.transitionTo('RESPONDING');
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
