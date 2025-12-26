// server/lib/agent/executor.ts
import { PlanStep, AgentEvent, Observation } from './types';
import { ToolRegistry } from './tools/registry';
import { getAgentMemory } from './memory';

export class AgentExecutor {
  private registry: ToolRegistry;
  private observations: Map<number, Observation> = new Map();

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  /**
   * Execute a plan step by step, yielding events for streaming.
   */
  async *execute(
    plan: PlanStep[],
    conversationId: string
  ): AsyncGenerator<AgentEvent> {
    this.observations.clear();
    const completed = new Set<number>();

    // Execute steps respecting dependencies
    while (completed.size < plan.length) {
      const readySteps = plan.filter(step => {
        if (completed.has(step.id)) return false;
        if (!step.dependsOn) return true;
        return step.dependsOn.every(depId => completed.has(depId));
      });

      if (readySteps.length === 0) {
        yield { type: 'error', error: 'Circular dependency in plan', recoverable: false };
        return;
      }

      // Execute ready steps (could parallelize independent steps)
      for (const step of readySteps) {
        yield* this.executeStep(step, conversationId);
        completed.add(step.id);
      }
    }

    yield { type: 'done' };
  }

  private async *executeStep(
    step: PlanStep,
    conversationId: string
  ): AsyncGenerator<AgentEvent> {
    yield { type: 'step_start', stepId: step.id, action: step.action };

    // Generate thought about this step
    const thought = this.generateThought(step);
    yield { type: 'thought', content: thought };

    if (step.action === 'respond') {
      // Generate response based on collected observations
      yield* this.generateResponse(conversationId);
    } else if (step.action === 'validate') {
      // Delegate to critic (will be implemented in Task 7)
      yield { type: 'validation_start' };
      // For now, auto-approve (critic integration comes later)
      yield { type: 'validation_result', approved: true, reason: 'Validation pending' };
    } else {
      // Execute tool
      yield* this.executeTool(step);
    }

    yield { type: 'step_complete', stepId: step.id };
  }

  private async *executeTool(step: PlanStep): AsyncGenerator<AgentEvent> {
    yield { type: 'tool_start', tool: step.action };

    const result = await this.registry.execute(step.action, step.args || {});

    if (result.success) {
      this.observations.set(step.id, {
        tool: step.action,
        input: step.args,
        output: result.data,
        durationMs: result.durationMs,
        success: true,
      });

      yield {
        type: 'tool_done',
        tool: step.action,
        result: result.data,
        durationMs: result.durationMs,
      };
    } else {
      this.observations.set(step.id, {
        tool: step.action,
        input: step.args,
        output: null,
        durationMs: result.durationMs,
        success: false,
        error: result.error,
      });

      yield {
        type: 'tool_error',
        tool: step.action,
        error: result.error || 'Unknown error',
      };
    }
  }

  private generateThought(step: PlanStep): string {
    const previousObs = Array.from(this.observations.values());

    if (previousObs.length === 0) {
      return `Starting with ${step.action}: ${step.reason}`;
    }

    const context = previousObs
      .filter(o => o.success)
      .map(o => `${o.tool} returned data`)
      .join(', ');

    return `Based on ${context}, now executing ${step.action}: ${step.reason}`;
  }

  private async *generateResponse(conversationId: string): AsyncGenerator<AgentEvent> {
    // Collect all successful observations
    const successfulObs = Array.from(this.observations.values())
      .filter(o => o.success);

    if (successfulObs.length === 0) {
      yield { type: 'response_chunk', content: 'Unable to fetch required data.' };
      return;
    }

    // Format response based on observations
    const response = this.formatObservationsAsResponse(successfulObs);

    // Stream response in chunks (simulating LLM streaming)
    const words = response.split(' ');
    for (let i = 0; i < words.length; i += 3) {
      const chunk = words.slice(i, i + 3).join(' ') + ' ';
      yield { type: 'response_chunk', content: chunk };
      await this.sleep(50); // Simulate streaming delay
    }

    // Save response to memory
    const memory = getAgentMemory();
    memory.addMessage(conversationId, {
      role: 'assistant',
      content: response,
      metadata: {
        tool: 'multi',
        toolResult: successfulObs.map(o => ({ tool: o.tool, success: o.success })),
      },
    });
  }

  private formatObservationsAsResponse(observations: Observation[]): string {
    const parts: string[] = [];

    for (const obs of observations) {
      if (obs.tool === 'getMarketData' && obs.output) {
        const data = obs.output as {
          spy?: { price?: number };
          vix?: { level?: number };
          market?: { isOpen?: boolean };
        };
        parts.push(`SPY is trading at $${data.spy?.price?.toFixed(2) || 'N/A'}. VIX is at ${data.vix?.level?.toFixed(1) || 'N/A'}. Market is ${data.market?.isOpen ? 'open' : 'closed'}.`);
      } else if (obs.tool === 'getPositions' && obs.output) {
        const data = obs.output as {
          summary?: { totalPositions?: number };
          account?: { portfolioValue?: number };
        };
        const posCount = data.summary?.totalPositions || 0;
        parts.push(`You have ${posCount} open position${posCount !== 1 ? 's' : ''}. Portfolio value: $${data.account?.portfolioValue?.toLocaleString() || 'N/A'}.`);
      } else if (obs.tool === 'runEngine' && obs.output) {
        const data = obs.output as {
          canTrade?: boolean;
          direction?: string;
          strikes?: {
            put?: number;
            call?: number;
            premium?: number;
          };
          reason?: string;
        };
        if (data.canTrade && data.strikes) {
          parts.push(`Found opportunity: ${data.direction || 'neutral'} bias. Put strike: ${data.strikes.put || 'N/A'}, Call strike: ${data.strikes.call || 'N/A'}. Expected premium: $${data.strikes.premium?.toFixed(2) || 'N/A'}.`);
        } else {
          parts.push(`No trading opportunities found: ${data.reason || 'Market conditions not favorable'}.`);
        }
      }
    }

    return parts.join(' ') || 'Data retrieved successfully.';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get all observations collected during execution.
   */
  getObservations(): Map<number, Observation> {
    return new Map(this.observations);
  }
}
