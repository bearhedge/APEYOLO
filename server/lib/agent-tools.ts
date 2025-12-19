/**
 * Agent Tool System
 *
 * Defines tools that the AI agent can execute via the ReAct pattern.
 * Each tool integrates with existing system components (broker, engine, etc.)
 */

import { getBroker } from '../broker';
import { analyzeMarketRegime } from '../engine/step1';

// =============================================================================
// Tool Types
// =============================================================================

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  description: string;
  enum?: string[];
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  execute: (args: Record<string, any>) => Promise<ToolResult>;
}

export interface ToolCall {
  tool: string;
  args: Record<string, any>;
}

// =============================================================================
// Tool Implementations
// =============================================================================

/**
 * Get current market data (VIX, SPY price, market status)
 */
const getMarketDataTool: Tool = {
  name: 'getMarketData',
  description: 'Fetch current market conditions including VIX level, SPY price, and market open/close status',
  parameters: {},
  execute: async (): Promise<ToolResult> => {
    try {
      // Get broker for market data
      const { api } = getBroker();
      if (!api) {
        return { success: false, error: 'Broker not connected' };
      }

      // Fetch SPY and VIX data
      const [spyData, vixData] = await Promise.all([
        api.getMarketData('SPY').catch(() => null),
        api.getMarketData('VIX').catch(() => null),
      ]);

      // Analyze market regime for additional context
      const regime = await analyzeMarketRegime(true, 'SPY');

      return {
        success: true,
        data: {
          spy: spyData ? {
            price: spyData.price,
            change: spyData.change,
            changePercent: spyData.changePercent,
          } : null,
          vix: vixData ? {
            level: vixData.price,
            regime: regime.volatilityRegime,
          } : null,
          market: {
            isOpen: regime.withinTradingWindow,
            canTrade: regime.canExecute,
            currentTime: regime.metadata?.currentTime,
          },
          regime: {
            shouldTrade: regime.shouldTrade,
            reason: regime.reason,
          },
        },
      };
    } catch (error: any) {
      console.error('[AgentTools] getMarketData error:', error);
      return { success: false, error: error.message || 'Failed to get market data' };
    }
  },
};

/**
 * Get current portfolio positions from IBKR
 */
const getPositionsTool: Tool = {
  name: 'getPositions',
  description: 'Get current portfolio positions including options and stocks with P/L data',
  parameters: {},
  execute: async (): Promise<ToolResult> => {
    try {
      const { api, status } = getBroker();
      if (!api) {
        return { success: false, error: 'Broker not connected' };
      }

      const [positions, account] = await Promise.all([
        api.getPositions(),
        api.getAccount(),
      ]);

      // Summarize positions
      const optionPositions = positions.filter((p: any) =>
        p.contract?.secType === 'OPT' || p.assetClass === 'OPT'
      );
      const stockPositions = positions.filter((p: any) =>
        p.contract?.secType === 'STK' || p.assetClass === 'STK'
      );

      const totalUnrealizedPnL = positions.reduce(
        (sum: number, p: any) => sum + (p.unrealizedPnL || 0),
        0
      );

      return {
        success: true,
        data: {
          summary: {
            totalPositions: positions.length,
            optionCount: optionPositions.length,
            stockCount: stockPositions.length,
            totalUnrealizedPnL: totalUnrealizedPnL,
          },
          account: account ? {
            portfolioValue: account.portfolioValue,
            buyingPower: account.buyingPower,
            dayPnL: account.dayPnL,
          } : null,
          positions: positions.map((p: any) => ({
            symbol: p.contract?.symbol || p.ticker || p.symbol,
            quantity: p.quantity || p.position,
            avgCost: p.averageCost || p.avgCost,
            marketValue: p.marketValue || p.mktValue,
            unrealizedPnL: p.unrealizedPnL || p.unrealizedPnl,
            type: p.contract?.secType || p.assetClass,
            strike: p.contract?.strike,
            right: p.contract?.right,
            expiry: p.contract?.expiry,
          })),
          brokerStatus: {
            provider: status.provider,
            connected: status.connected,
          },
        },
      };
    } catch (error: any) {
      console.error('[AgentTools] getPositions error:', error);
      return { success: false, error: error.message || 'Failed to get positions' };
    }
  },
};

/**
 * Run the 5-step trading engine to find optimal strikes
 */
const runEngineTool: Tool = {
  name: 'runEngine',
  description: 'Run the 5-step trading engine to analyze market and find optimal option strikes for trading',
  parameters: {
    symbol: {
      type: 'string',
      required: false,
      description: 'Underlying symbol (default: SPY)',
    },
    riskProfile: {
      type: 'string',
      required: false,
      description: 'Risk profile for position sizing',
      enum: ['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE'],
    },
  },
  execute: async (args): Promise<ToolResult> => {
    try {
      // Dynamic import to avoid circular dependencies
      const { TradingEngine } = await import('../engine');
      const { api } = getBroker();

      const symbol = args.symbol || 'SPY';
      const riskProfile = args.riskProfile || 'BALANCED';

      // Get current underlying price
      let underlyingPrice = 600; // Default fallback
      if (api) {
        try {
          const marketData = await api.getMarketData(symbol);
          underlyingPrice = marketData.price;
        } catch (e) {
          console.warn('[AgentTools] Could not get real price, using fallback');
        }
      }

      // Get account info for position sizing
      let accountInfo = {
        cashBalance: 150000,
        buyingPower: 500000,
        netLiquidation: 150000,
        currentPositions: 0,
      };

      if (api) {
        try {
          const account = await api.getAccount();
          accountInfo = {
            cashBalance: account.totalCash || 150000,
            buyingPower: account.buyingPower || 500000,
            netLiquidation: account.portfolioValue || 150000,
            currentPositions: 0,
          };
        } catch (e) {
          console.warn('[AgentTools] Could not get account info, using defaults');
        }
      }

      // Create and run engine
      const engine = new TradingEngine({
        riskProfile,
        underlyingSymbol: symbol,
        underlyingPrice,
        mockMode: !api, // Use mock if no broker
      });

      const result = await engine.executeTradingDecision(accountInfo);

      return {
        success: true,
        data: {
          canTrade: result.canTrade,
          executionReady: result.executionReady,
          withinTradingWindow: result.withinTradingWindow,
          direction: result.direction?.direction,
          confidence: result.direction?.confidence,
          strikes: result.strikes && typeof result.strikes === 'object' && !Array.isArray(result.strikes) ? {
            // Put strike details
            put: result.strikes.putStrike?.strike,
            putDelta: result.strikes.putStrike?.delta,
            putBid: result.strikes.putStrike?.bid,
            putAsk: result.strikes.putStrike?.ask,
            // Call strike details
            call: result.strikes.callStrike?.strike,
            callDelta: result.strikes.callStrike?.delta,
            callBid: result.strikes.callStrike?.bid,
            callAsk: result.strikes.callStrike?.ask,
            // Summary
            premium: result.strikes.expectedPremium,
            reasoning: result.strikes.reasoning,
          } : null,
          positionSize: result.positionSize ? {
            contracts: result.positionSize.contracts,
            maxLoss: result.positionSize.maxLossTotal,
            margin: result.positionSize.totalMarginRequired,
          } : null,
          exitRules: result.exitRules ? {
            stopLossPrice: result.exitRules.stopLossPrice,
            takeProfitPrice: result.exitRules.takeProfitPrice,
            maxHoldingTime: result.exitRules.maxHoldingTime,
          } : null,
          reason: result.reason,
        },
      };
    } catch (error: any) {
      console.error('[AgentTools] runEngine error:', error);
      return { success: false, error: error.message || 'Failed to run trading engine' };
    }
  },
};

/**
 * Execute a trade via IBKR (NOT YET IMPLEMENTED - placeholder for safety)
 */
const executeTradeTool: Tool = {
  name: 'executeTrade',
  description: 'Execute a trade via IBKR. Requires human approval via UI.',
  parameters: {
    symbol: {
      type: 'string',
      required: true,
      description: 'Underlying symbol (e.g., SPY)',
    },
    side: {
      type: 'string',
      required: true,
      description: 'PUT or CALL',
      enum: ['PUT', 'CALL'],
    },
    strike: {
      type: 'number',
      required: true,
      description: 'Strike price',
    },
    contracts: {
      type: 'number',
      required: true,
      description: 'Number of contracts (max 2)',
    },
  },
  execute: async (args): Promise<ToolResult> => {
    // Safety check: max 2 contracts
    if (args.contracts > 2) {
      return {
        success: false,
        error: 'Safety limit: Maximum 2 contracts allowed per trade'
      };
    }

    // Check for human approval flag from Operator Console
    if (!args._approved) {
      return {
        success: false,
        error: 'Trade execution requires human approval. Click EXECUTE in the Operator Console.',
        data: {
          proposedTrade: {
            symbol: args.symbol,
            side: args.side,
            strike: args.strike,
            contracts: args.contracts,
          },
          requiresApproval: true,
        },
      };
    }

    // Human approved - log the trade (actual execution goes through Engine page)
    // TODO: Integrate with the full engineRoutes.execute-paper endpoint
    console.log('[AgentTools] Trade approved:', {
      symbol: args.symbol,
      side: args.side,
      strike: args.strike,
      contracts: args.contracts,
      premium: args.premium,
    });

    // For now, return success with a note that execution is pending
    // Full IBKR integration will be added in Phase 2
    return {
      success: true,
      data: {
        message: 'Trade approved - execution pending IBKR integration',
        tradeId: `trade_${Date.now()}`,
        trade: {
          symbol: args.symbol || 'SPY',
          side: args.side,
          strike: args.strike,
          contracts: args.contracts || 2,
        },
        note: 'Full IBKR execution available on Engine page',
      },
    };
  },
};

/**
 * Close an existing position
 */
const closeTradeTool: Tool = {
  name: 'closeTrade',
  description: 'Close an existing option or stock position',
  parameters: {
    positionId: {
      type: 'string',
      required: true,
      description: 'Contract ID or position identifier to close',
    },
  },
  execute: async (args): Promise<ToolResult> => {
    // TODO: Implement position closing
    return {
      success: false,
      error: 'Position closing requires human approval.',
      data: {
        positionId: args.positionId,
        requiresApproval: true,
      },
    };
  },
};

// =============================================================================
// Tool Registry
// =============================================================================

export const toolRegistry: Record<string, Tool> = {
  getMarketData: getMarketDataTool,
  getPositions: getPositionsTool,
  runEngine: runEngineTool,
  executeTrade: executeTradeTool,
  closeTrade: closeTradeTool,
};

/**
 * Get all tool definitions for inclusion in system prompt
 */
export function getToolDefinitions(): string {
  return Object.values(toolRegistry)
    .map((tool) => {
      const params = Object.entries(tool.parameters)
        .map(([name, param]) => {
          const required = param.required ? 'required' : 'optional';
          const enumStr = param.enum ? ` (options: ${param.enum.join(', ')})` : '';
          return `    - ${name} (${param.type}, ${required}): ${param.description}${enumStr}`;
        })
        .join('\n');

      return `- ${tool.name}: ${tool.description}${params ? '\n' + params : ''}`;
    })
    .join('\n\n');
}

// =============================================================================
// ReAct Pattern Parser
// =============================================================================

/**
 * Parse tool arguments from string format
 * Supports: tool_name(arg1=value1, arg2=value2) or tool_name()
 */
function parseToolArgs(argsString: string): Record<string, any> {
  if (!argsString.trim()) return {};

  const args: Record<string, any> = {};

  // Split by comma, but respect quoted strings
  const parts = argsString.match(/([^,]+(?:=(?:[^,]*?(?:"[^"]*"|'[^']*'|[^,]*))*)?)/g) || [];

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value: any = trimmed.slice(eqIndex + 1).trim();

    // Remove quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Try to parse as number
    else if (!isNaN(Number(value))) {
      value = Number(value);
    }
    // Boolean
    else if (value === 'true') value = true;
    else if (value === 'false') value = false;

    args[key] = value;
  }

  return args;
}

/**
 * Parse ReAct ACTION pattern from LLM output
 * Pattern: ACTION: tool_name(arg1=value1, arg2=value2)
 */
export function parseToolCall(content: string): ToolCall | null {
  // Match ACTION: tool_name(args) pattern
  const match = content.match(/ACTION:\s*(\w+)\(([^)]*)\)/i);
  if (!match) return null;

  const toolName = match[1];
  const argsString = match[2];

  // Validate tool exists
  if (!toolRegistry[toolName]) {
    console.warn(`[AgentTools] Unknown tool: ${toolName}`);
    return null;
  }

  return {
    tool: toolName,
    args: parseToolArgs(argsString),
  };
}

/**
 * Execute a tool call and return the result
 */
export async function executeToolCall(toolCall: ToolCall): Promise<ToolResult> {
  const tool = toolRegistry[toolCall.tool];
  if (!tool) {
    return { success: false, error: `Unknown tool: ${toolCall.tool}` };
  }

  console.log(`[AgentTools] Executing ${toolCall.tool} with args:`, toolCall.args);

  try {
    const result = await tool.execute(toolCall.args);
    console.log(`[AgentTools] ${toolCall.tool} result:`, result.success ? 'success' : result.error);
    return result;
  } catch (error: any) {
    console.error(`[AgentTools] ${toolCall.tool} error:`, error);
    return { success: false, error: error.message || 'Tool execution failed' };
  }
}
