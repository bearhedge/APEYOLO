// server/lib/agent/planner.ts
import { PlannerInput, ExecutionPlan, PlanStep, Intent } from './types';

// Intent detection patterns
const MARKET_PATTERNS = /\b(spy|vix|price|quote|market|trading at|what.*(is|at))\b/i;
const POSITION_PATTERNS = /\b(position|portfolio|holding|p&l|pnl|exposure)\b/i;
const TRADE_PATTERNS = /\b(trade|propose|find|opportunity|setup|engine|strangle|put|call)\b/i;

export class AgentPlanner {
  /**
   * Create an execution plan for a user message.
   * Uses fast heuristics first, falls back to LLM for ambiguous cases.
   */
  async createPlan(input: PlannerInput): Promise<ExecutionPlan> {
    const intent = this.detectIntent(input.userMessage);
    const steps = this.generateSteps(intent, input);
    const requiresValidation = intent === 'trade_proposal';

    return {
      intent,
      confidence: this.calculateConfidence(intent, input.userMessage),
      steps,
      requiresValidation,
      estimatedDurationMs: this.estimateDuration(steps),
    };
  }

  private detectIntent(message: string): Intent {
    const lowerMessage = message.toLowerCase();

    // Trade intent takes priority (safety-critical)
    if (TRADE_PATTERNS.test(lowerMessage)) {
      return 'trade_proposal';
    }

    // Position queries
    if (POSITION_PATTERNS.test(lowerMessage)) {
      return 'position_query';
    }

    // Market data queries
    if (MARKET_PATTERNS.test(lowerMessage)) {
      return 'market_check';
    }

    // Default to conversation for anything else
    return 'conversation';
  }

  private generateSteps(intent: Intent, input: PlannerInput): PlanStep[] {
    switch (intent) {
      case 'market_check':
        return this.marketCheckSteps(input);
      case 'position_query':
        return this.positionQuerySteps(input);
      case 'trade_proposal':
        return this.tradeProposalSteps(input);
      case 'conversation':
      default:
        return this.conversationSteps();
    }
  }

  private marketCheckSteps(input: PlannerInput): PlanStep[] {
    const steps: PlanStep[] = [];
    let stepId = 1;

    // Skip if we have fresh cached data
    if (!input.cachedMarketData) {
      steps.push({
        id: stepId++,
        action: 'getMarketData',
        reason: 'Fetch current SPY/VIX prices',
      });
    }

    steps.push({
      id: stepId,
      action: 'respond',
      reason: 'Report market data to user',
      dependsOn: steps.length > 0 ? [1] : undefined,
    });

    return steps;
  }

  private positionQuerySteps(input: PlannerInput): PlanStep[] {
    const steps: PlanStep[] = [];
    let stepId = 1;

    if (!input.cachedPositions) {
      steps.push({
        id: stepId++,
        action: 'getPositions',
        reason: 'Fetch current portfolio positions',
      });
    }

    steps.push({
      id: stepId,
      action: 'respond',
      reason: 'Report positions to user',
      dependsOn: steps.length > 0 ? [1] : undefined,
    });

    return steps;
  }

  private tradeProposalSteps(_input: PlannerInput): PlanStep[] {
    const steps: PlanStep[] = [];
    let stepId = 1;

    // Always fetch fresh market data for trades
    steps.push({
      id: stepId++,
      action: 'getMarketData',
      reason: 'Check current market conditions',
    });

    steps.push({
      id: stepId++,
      action: 'getPositions',
      reason: 'Check existing exposure',
    });

    // Run engine depends on market + positions
    steps.push({
      id: stepId++,
      action: 'runEngine',
      reason: 'Find trading opportunities',
      dependsOn: [1, 2],
    });

    // Validation is mandatory for trades
    steps.push({
      id: stepId,
      action: 'validate',
      reason: 'Critic must approve before presenting to user',
      dependsOn: [3],
    });

    return steps;
  }

  private conversationSteps(): PlanStep[] {
    return [
      {
        id: 1,
        action: 'respond',
        reason: 'Respond to general query',
      },
    ];
  }

  private calculateConfidence(intent: Intent, message: string): number {
    const lowerMessage = message.toLowerCase();

    // Count pattern matches for confidence
    let matches = 0;
    let total = 0;

    if (intent === 'trade_proposal') {
      const tradeWords = ['trade', 'propose', 'opportunity', 'engine', 'strangle', 'put', 'call'];
      tradeWords.forEach(word => {
        total++;
        if (lowerMessage.includes(word)) matches++;
      });
    } else if (intent === 'market_check') {
      const marketWords = ['spy', 'vix', 'price', 'market', 'quote'];
      marketWords.forEach(word => {
        total++;
        if (lowerMessage.includes(word)) matches++;
      });
    } else if (intent === 'position_query') {
      const posWords = ['position', 'portfolio', 'holding', 'pnl'];
      posWords.forEach(word => {
        total++;
        if (lowerMessage.includes(word)) matches++;
      });
    }

    if (total === 0) return 0.5; // Conversation fallback
    return Math.min(0.5 + (matches / total) * 0.5, 0.99);
  }

  private estimateDuration(steps: PlanStep[]): number {
    let duration = 0;

    for (const step of steps) {
      switch (step.action) {
        case 'getMarketData':
          duration += 500;
          break;
        case 'getPositions':
          duration += 500;
          break;
        case 'runEngine':
          duration += 3000;
          break;
        case 'validate':
          duration += 8000; // Dual-brain is slow
          break;
        case 'respond':
          duration += 500;
          break;
      }
    }

    return duration;
  }
}

// Singleton
let plannerInstance: AgentPlanner | null = null;

export function getAgentPlanner(): AgentPlanner {
  if (!plannerInstance) {
    plannerInstance = new AgentPlanner();
  }
  return plannerInstance;
}
