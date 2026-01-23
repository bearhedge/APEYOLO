// server/agent/codeact/orchestrator.ts
// CodeAct Orchestrator - Reason, Code, Observe loop
// DeepSeek writes Python code as actions, executed in sandbox

import { v4 as uuidv4 } from 'uuid';
import { deepseekClient } from '../models/deepseek';
import { memoryService } from '../memory/service';
import { executePython, extractPythonCode, extractProposal } from '../sandbox/executor';
import { logger } from '../logger';

type Mode = 'market_hours' | 'off_hours';

interface OrchestratorConfig {
  sessionId?: string;
  mode: Mode;
}

// System prompt for the CodeAct agent
// Note: Using template literal but escaping Python f-strings to prevent JS interpretation
const SYSTEM_PROMPT = `You are APE, an AI trading assistant for 0DTE SPY options.

You can write Python code to perform actions. The code will be executed and you'll see the output.

Available in your Python environment:
- broker.get_price(symbol) -> float
- broker.get_account() -> dict
- broker.get_positions() -> list
- broker.get_option_chain(symbol) -> dict
- print() for output

Your workflow:
1. OBSERVE - Check market conditions (SPY price, VIX, positions)
2. ANALYZE - Reason about what you see
3. DECIDE - What's the ONE next action?

When you want to execute code, wrap it in <python> tags:
<python>
spy = broker.get_price("SPY")
vix = broker.get_price("VIX")
print(f"SPY: {spy}, VIX: {vix}")
</python>

After seeing results, VERIFY they make sense before continuing.

=== ANALYSIS REQUIREMENTS ===
When analyzing market conditions, provide DETAILED, INTELLIGENT analysis:

1. PRICES: Show current prices WITH context
   - SPY: $XXX.XX (+/-X.X% from yesterday's close of $XXX.XX)
   - VIX: XX.XX (interpret: low <15 / normal 15-20 / elevated 20-25 / high >25)

2. MARKET REGIME: Classify the current environment
   - CALM: VIX <20, price range-bound
   - TRENDING: Clear directional move with momentum
   - VOLATILE: VIX >25 or large intraday swings
   - CHOPPY: No clear direction, frequent reversals

3. PRICE CONTEXT: Where is SPY in recent range?
   - Yesterday's high/low range
   - Current position (e.g., "75th percentile of yesterday's range")
   - Key round numbers nearby ($685, $690, etc.)

4. SUPPORT/RESISTANCE:
   - Recent pivot points
   - Yesterday's VWAP area
   - Round numbers that may act as magnets

5. OPTIONS INSIGHT: If relevant
   - Notable 0DTE premium levels
   - Unusual strike activity
   - Theta decay status (accelerating after 2pm ET)

6. INTERPRETATION: Don't just state facts - explain what they MEAN for trading:
   - "VIX at 14.5 suggests calm conditions favorable for premium selling"
   - "Price near session highs with weakening momentum suggests possible pullback"

Be specific with numbers. Show your reasoning.
=== END ANALYSIS REQUIREMENTS ===

IMPORTANT: You CANNOT execute trades directly. If you want to propose a trade, output a PROPOSAL in this format:
<proposal>
{
  "action": "SELL_PUT_SPREAD",
  "strikes": {"sell": 580, "buy": 575},
  "contracts": 1,
  "reasoning": "Your reasoning here"
}
</proposal>

The human must approve all proposals before execution.`;

const MARKET_HOURS_CONTEXT = `
Current mode: MARKET HOURS (11am-4pm ET)
You may: Observe, analyze, and PROPOSE trades.
You may NOT: Execute trades directly. All proposals require human approval.`;

const OFF_HOURS_CONTEXT = `
Current mode: OFF HOURS
You may: Observe market data only.
You may NOT: Propose or execute any trades.
Focus on: Logging observations for tomorrow's analysis.`;

export class CodeActOrchestrator {
  private sessionId: string;
  private mode: Mode;
  private messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];

  constructor(config: OrchestratorConfig) {
    this.sessionId = config.sessionId ?? uuidv4();
    this.mode = config.mode;

    // Set session ID on logger
    logger.setSessionId(this.sessionId);

    // Initialize conversation with system prompt
    const modeContext = this.mode === 'market_hours' ? MARKET_HOURS_CONTEXT : OFF_HOURS_CONTEXT;
    this.messages.push({
      role: 'system',
      content: SYSTEM_PROMPT + '\n\n' + modeContext
    });
  }

  /**
   * Run the CodeAct loop: Reason -> Code -> Observe -> Repeat
   */
  async run(trigger: { type: 'scheduled' | 'user'; message: string }): Promise<void> {
    logger.start('BANANA_TIME', `Session started (${this.mode})`);

    // Add trigger message
    this.messages.push({ role: 'user', content: trigger.message });
    await memoryService.logEvent(this.sessionId, 'trigger', trigger.message, { type: trigger.type });

    // Agent loop - max 10 iterations to prevent runaway
    for (let i = 0; i < 10; i++) {
      // Get DeepSeek response
      logger.start('APE_BRAIN', '');

      const response = await this.callDeepSeekStreaming();

      if (!response) {
        logger.start('BAD_BANANA', 'DeepSeek call failed');
        break;
      }

      this.messages.push({ role: 'assistant', content: response });
      await memoryService.logEvent(this.sessionId, 'reasoning', response);

      // Check for Python code to execute
      const code = extractPythonCode(response);
      if (code) {
        logger.start('GRABBING_DATA', 'Executing code...\n' + code);

        const result = await executePython(code);
        await memoryService.logEvent(this.sessionId, 'code_execution', code, result);

        if (result.success) {
          logger.start('FOUND_BANANA', result.stdout || '(no output)');
        } else {
          logger.start('BAD_BANANA', result.error || result.stderr);
        }

        // Feed result back to DeepSeek
        this.messages.push({
          role: 'user',
          content: `Code output:\n${result.stdout}\n${result.stderr ? 'Errors: ' + result.stderr : ''}\n\nDoes this look correct? Continue your analysis.`
        });
        continue;
      }

      // Check for trade proposal
      const proposal = extractProposal(response);
      if (proposal) {
        if (this.mode === 'market_hours') {
          logger.start('SWING_TIME', `Proposing: ${proposal.action}`);
        } else {
          logger.start('NO_SWING', 'Off hours - just observing, no trade proposal');
        }
        await memoryService.logEvent(this.sessionId, 'proposal', JSON.stringify(proposal));
        // Proposal will be picked up by UI via SSE
        // Agent waits for human approval (handled by separate endpoint)
        break; // Wait for human after proposal
      }

      // Check if agent is done (no code, no proposal)
      if (this.mode === 'off_hours') {
        logger.start('NO_SWING', 'Off hours - just observing');
      }
      break;
    }

    logger.start('BACK_TO_TREE', 'Session complete');
  }

  /**
   * Call DeepSeek with streaming and emit tokens via logger.append
   */
  private async callDeepSeekStreaming(): Promise<string | null> {
    try {
      let fullResponse = '';

      // Check if deepseekClient supports streaming
      if (typeof deepseekClient.chatStream === 'function') {
        for await (const chunk of deepseekClient.chatStream(this.messages)) {
          fullResponse += chunk;
          logger.append(chunk);
        }
      } else {
        // Fallback to non-streaming
        const response = await deepseekClient.chat(this.messages);
        if (response) {
          fullResponse = response;
          logger.append(response);
        }
      }

      return fullResponse || null;
    } catch (error: any) {
      console.error('[CodeAct] DeepSeek error:', error.message);
      return null;
    }
  }

  getSessionId(): string {
    return this.sessionId;
  }
}

/**
 * Determine the current trading mode based on Eastern Time.
 */
export function getCurrentMode(): Mode {
  const now = new Date();
  const hour = parseInt(now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    hour12: false,
    timeZone: 'America/New_York'
  }));

  // Market hours: 11am-4pm ET
  return (hour >= 11 && hour < 16) ? 'market_hours' : 'off_hours';
}

/**
 * Factory function to create an orchestrator with the current mode.
 */
export function createCodeActOrchestrator(sessionId?: string): CodeActOrchestrator {
  return new CodeActOrchestrator({
    sessionId,
    mode: getCurrentMode(),
  });
}
