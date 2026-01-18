/**
 * APE Agent Tools
 *
 * Wraps existing agent-tools with APE-specific logging and provides
 * function definitions in OpenAI format for Kimi API.
 */

import { toolRegistry, Tool, ToolResult } from '../lib/agent-tools';
import { logger, LogType } from './logger';
import { AgentContext } from './types';

// =============================================================================
// Tool Definitions (OpenAI Function Calling Format)
// =============================================================================

export interface FunctionDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, {
        type: string;
        description: string;
        enum?: string[];
      }>;
      required?: string[];
    };
  };
}

/**
 * Tools available to the APE Agent via function calling
 */
export const APE_TOOLS: FunctionDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'get_market_data',
      description: 'Get current SPY price, VIX level, market status, and volatility regime. Use to assess current market conditions.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_positions',
      description: 'Get current portfolio positions, account value, and P&L. Use to check existing positions before trading.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_option_chain',
      description: 'Get SPY option chain with available strikes, bids, asks, and deltas. Use to find specific strike candidates.',
      parameters: {
        type: 'object',
        properties: {
          direction: {
            type: 'string',
            description: 'Option type to focus on',
            enum: ['PUT', 'CALL', 'BOTH'],
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_engine',
      description: 'Run the 5-step trading engine to analyze market and get trade recommendation. Returns canTrade status, direction, optimal strikes, and exit rules.',
      parameters: {
        type: 'object',
        properties: {
          strategy: {
            type: 'string',
            description: 'Force a specific strategy instead of auto-detecting',
            enum: ['strangle', 'put-only', 'call-only'],
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'execute_trade',
      description: 'Execute a trade (SELL to open). ONLY call this after getting explicit approval via run_engine analysis.',
      parameters: {
        type: 'object',
        properties: {
          direction: {
            type: 'string',
            description: 'PUT or CALL',
            enum: ['PUT', 'CALL'],
          },
          strike: {
            type: 'number',
            description: 'Strike price to sell',
          },
          contracts: {
            type: 'number',
            description: 'Number of contracts (max 5)',
          },
        },
        required: ['direction', 'strike', 'contracts'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'close_position',
      description: 'Close an existing open position. Use when position hits profit target or stop loss.',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: 'Why closing: profit_target, stop_loss, time_exit, or manual',
          },
        },
        required: ['reason'],
      },
    },
  },
];

// =============================================================================
// Tool Executor
// =============================================================================

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface ToolExecutionResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

/**
 * Execute a tool call and log it
 */
export async function executeTool(
  toolCall: ToolCall,
  sessionId: string,
  context: AgentContext
): Promise<ToolExecutionResult> {
  const toolName = toolCall.function.name;
  let args: Record<string, unknown> = {};

  try {
    args = JSON.parse(toolCall.function.arguments || '{}');
  } catch {
    return { success: false, error: 'Invalid tool arguments' };
  }

  // Log tool invocation
  const argsStr = Object.entries(args).map(([k, v]) => `${k}=${v}`).join(' ');
  logger.log({
    sessionId,
    type: 'TOOL',
    message: `${toolName}${argsStr ? ' | ' + argsStr : ''}`,
  });

  try {
    let result: ToolResult;

    switch (toolName) {
      case 'get_market_data':
        result = await toolRegistry.get_market_data.execute({});
        break;

      case 'get_positions':
        result = await toolRegistry.get_positions.execute({});
        break;

      case 'get_option_chain':
        result = await executeGetOptionChain(args, context);
        break;

      case 'run_engine':
        result = await toolRegistry.run_engine.execute({
          symbol: 'SPY',
          strategy: args.strategy as string | undefined,
          riskProfile: 'BALANCED',
        });
        break;

      case 'execute_trade':
        result = await executeTradeWithGuardrails(args, sessionId, context);
        break;

      case 'close_position':
        result = await executeClosePosition(args, sessionId, context);
        break;

      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }

    if (!result.success) {
      logger.log({
        sessionId,
        type: 'ERROR',
        message: `${toolName} failed: ${result.error}`,
      });
      return { success: false, error: result.error };
    }

    return { success: true, result: result.data };

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.log({
      sessionId,
      type: 'ERROR',
      message: `${toolName} exception: ${message}`,
    });
    return { success: false, error: message };
  }
}

// =============================================================================
// Custom Tool Implementations
// =============================================================================

/**
 * Get option chain with smart strike candidates
 */
async function executeGetOptionChain(
  args: Record<string, unknown>,
  context: AgentContext
): Promise<ToolResult> {
  try {
    const { getBroker } = await import('../broker');
    const broker = getBroker();

    if (!broker.api) {
      return { success: false, error: 'Broker not connected' };
    }

    const chain = await broker.api.getOptionChain('SPY');
    const direction = (args.direction as string) || 'BOTH';

    // Filter by direction
    let options = chain.options;
    if (direction === 'PUT') {
      options = options.filter((o: { type: string }) => o.type === 'put');
    } else if (direction === 'CALL') {
      options = options.filter((o: { type: string }) => o.type === 'call');
    }

    // Get strikes near the money (within 5% of current price)
    const nearMoneyRange = context.spyPrice * 0.05;
    const nearMoney = options.filter((o: { strike: number }) =>
      Math.abs(o.strike - context.spyPrice) <= nearMoneyRange
    );

    // Sort by distance from underlying
    nearMoney.sort((a: { strike: number }, b: { strike: number }) =>
      Math.abs(a.strike - context.spyPrice) - Math.abs(b.strike - context.spyPrice)
    );

    return {
      success: true,
      data: {
        underlyingPrice: context.spyPrice,
        expiration: chain.expirations?.[0],
        candidates: nearMoney.slice(0, 10).map((o: {
          strike: number;
          type: string;
          bid: number;
          ask: number;
          delta?: number;
        }) => ({
          strike: o.strike,
          type: o.type,
          bid: o.bid,
          ask: o.ask,
          delta: o.delta,
          midpoint: (o.bid + o.ask) / 2,
          spread: o.ask - o.bid,
        })),
      },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: message };
  }
}

/**
 * Execute trade with guardrail enforcement
 */
async function executeTradeWithGuardrails(
  args: Record<string, unknown>,
  sessionId: string,
  context: AgentContext
): Promise<ToolResult> {
  const direction = args.direction as 'PUT' | 'CALL';
  const strike = args.strike as number;
  let contracts = args.contracts as number;

  // Enforce guardrails
  if (context.tradesToday >= 1) {
    return {
      success: false,
      error: 'Max trades per day (1) already reached',
    };
  }

  if (context.dailyPnl < -context.maxDailyLoss) {
    return {
      success: false,
      error: `Daily loss limit ($${context.maxDailyLoss}) reached`,
    };
  }

  contracts = Math.min(contracts, context.maxContracts);

  try {
    const { getBroker } = await import('../broker');
    const broker = getBroker();

    if (!broker.api) {
      return { success: false, error: 'Broker not connected' };
    }

    // Get option chain to find the option
    const chain = await broker.api.getOptionChain('SPY');
    const targetType = direction.toLowerCase() as 'put' | 'call';
    const options = chain.options.filter((o: { type: string }) => o.type === targetType);
    const targetOption = options.find((o: { strike: number }) => o.strike === strike);

    if (!targetOption) {
      return { success: false, error: `No option found at strike ${strike}` };
    }

    // Log the action
    const premium = targetOption.bid * contracts * 100;
    logger.log({
      sessionId,
      type: 'ACTION',
      message: `SELL ${contracts}x SPY ${strike}${direction[0]} @ $${targetOption.bid.toFixed(2)} | premium=$${premium.toFixed(0)}`,
    });

    // In production, would call broker.api.placeOrder() here
    // For now, return success with trade details

    return {
      success: true,
      data: {
        executed: true,
        direction,
        strike,
        contracts,
        premium: targetOption.bid,
        totalPremium: premium,
        stopLossPrice: targetOption.bid * context.stopLossMultiplier,
      },
    };

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: message };
  }
}

/**
 * Close an existing position
 */
async function executeClosePosition(
  args: Record<string, unknown>,
  sessionId: string,
  context: AgentContext
): Promise<ToolResult> {
  const reason = args.reason as string;

  if (!context.hasPosition) {
    return { success: false, error: 'No position to close' };
  }

  const position = context.currentPosition!;

  // Log the action
  logger.log({
    sessionId,
    type: 'ACTION',
    message: `CLOSE ${position.contracts}x SPY ${position.strike}${position.type[0]} | reason=${reason} | pnl=$${position.unrealizedPnl.toFixed(0)}`,
  });

  // In production, would call broker.api to close position
  return {
    success: true,
    data: {
      closed: true,
      reason,
      pnl: position.unrealizedPnl,
    },
  };
}

// =============================================================================
// Exports
// =============================================================================

export { APE_TOOLS as tools };
