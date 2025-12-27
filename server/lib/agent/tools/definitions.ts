// server/lib/agent/tools/definitions.ts
import { Tool } from '../../llm-client';

/**
 * Tool definitions in Ollama format.
 * These are passed to the orchestrator model so it knows what tools are available.
 */

export const AGENT_TOOLS: Tool[] = [
  {
    type: 'function',
    function: {
      name: 'get_market_data',
      description: 'Get current SPY price, VIX level, and market open/close status. Use this when the user asks about market conditions, prices, or wants to know current trading conditions.',
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
      description: 'Get current portfolio positions, P&L, and account value. Use this when the user asks about their holdings, positions, or portfolio status.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_engine',
      description: 'Run the 0DTE SPY strangle trading engine to find trade opportunities. Use this when the user wants to find trades, get trade proposals, or asks what trades are available.',
      parameters: {
        type: 'object',
        properties: {
          strategy: {
            type: 'string',
            description: 'Strategy type: "strangle", "put-only", or "call-only"',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'think_deeply',
      description: 'Use deep reasoning to analyze complex questions, evaluate trade decisions, or provide thorough analysis. Use this for questions that need careful thinking, risk assessment, or detailed explanations.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The question or topic to analyze deeply',
          },
          context: {
            type: 'string',
            description: 'Additional context like market data or positions to consider',
          },
        },
        required: ['query'],
      },
    },
  },
];

/**
 * Map tool names to their execution functions.
 * This is used by the orchestrator to actually run the tools.
 */
export type ToolExecutor = (args: Record<string, unknown>) => Promise<unknown>;

export interface ToolExecutors {
  get_market_data: ToolExecutor;
  get_positions: ToolExecutor;
  run_engine: ToolExecutor;
  think_deeply: ToolExecutor;
}
