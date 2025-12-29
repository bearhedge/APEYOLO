// server/lib/agent/orchestrator.ts
// Simplified 3-step linear flow: Intent → Data → Answer

import { AgentEvent, OrchestratorState } from './types';
import { AgentMemory, getAgentMemory } from './memory';
import { extractIntent } from './intent-extractor';
import { fetchData } from './data-fetcher';
import { synthesizeAnswer } from './answer-synthesizer';

export interface RunInput {
  userMessage: string;
  userId: string;
  conversationId?: string;
}

export class AgentOrchestrator {
  private state: OrchestratorState = 'IDLE';
  private memory: AgentMemory;

  constructor() {
    this.memory = getAgentMemory();
  }

  /**
   * Run the agent using a simple 3-step flow:
   * 1. Extract intent (what data do we need?)
   * 2. Fetch data (parallel execution with timeouts)
   * 3. Synthesize answer (generate response from data only)
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
      console.log(`[Orchestrator] Starting 3-step flow for: "${input.userMessage.slice(0, 50)}..."`);

      // Step 1: Extract intent
      yield* this.transitionTo('PLANNING');
      console.log(`[Orchestrator] Step 1: Extracting intent...`);

      const intent = await extractIntent(input.userMessage);
      console.log(`[Orchestrator] Intent extracted:`, intent.needs);

      yield { type: 'thought', content: `Understanding request: ${intent.reasoning}` };

      // Step 2: Fetch data
      yield* this.transitionTo('EXECUTING');
      console.log(`[Orchestrator] Step 2: Fetching data...`);

      // Emit tool starts for UI
      if (intent.needs.market_status || intent.needs.spy_price || intent.needs.vix) {
        yield { type: 'tool_start', tool: 'get_market_data' };
      }
      if (intent.needs.positions) {
        yield { type: 'tool_start', tool: 'get_positions' };
      }
      if (intent.needs.web_search) {
        yield { type: 'tool_start', tool: 'web_browse' };
        yield { type: 'thought', content: `Searching: "${intent.needs.web_search}"` };
      }

      const data = await fetchData(intent.needs);

      // Emit tool completions
      if (intent.needs.market_status || intent.needs.spy_price || intent.needs.vix) {
        yield { type: 'tool_done', tool: 'get_market_data', result: data.market_status || data.spy_price || data.vix };
      }
      if (intent.needs.positions) {
        yield { type: 'tool_done', tool: 'get_positions', result: data.positions?.summary };
      }
      if (intent.needs.web_search) {
        yield { type: 'tool_done', tool: 'web_browse', result: data.web_content?.url };
      }

      // Emit screenshot if web browse returned one
      if (data.web_content?.screenshot) {
        yield {
          type: 'browser_screenshot',
          data: {
            base64: data.web_content.screenshot,
            url: data.web_content.url,
            timestamp: Date.now(),
          },
        };
      }

      // Step 3: Synthesize answer
      yield* this.transitionTo('RESPONDING');
      console.log(`[Orchestrator] Step 3: Synthesizing answer...`);

      const answer = await synthesizeAnswer(input.userMessage, data);

      const elapsed = Date.now() - startTime;
      console.log(`[Orchestrator] Complete in ${elapsed}ms`);

      // Save to memory
      this.memory.addMessage(conversationId, {
        role: 'assistant',
        content: answer,
      });

      yield { type: 'response_chunk', content: answer };
      yield { type: 'done', finalResponse: answer };
      yield* this.transitionTo('IDLE');

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Orchestrator] Fatal error:`, errorMessage);

      this.memory.logAudit(conversationId, 'error', { error: errorMessage });

      yield {
        type: 'done',
        finalResponse: "I'm sorry, something went wrong while processing your request. Please try again.",
      };
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
export function createAgentOrchestrator(): AgentOrchestrator {
  return new AgentOrchestrator();
}
