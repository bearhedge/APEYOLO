// server/lib/agent/tools/market.ts
import { ToolDefinition } from '../types';
import { toolRegistry } from '../../agent-tools';

export const marketTool: ToolDefinition = {
  name: 'getMarketData',
  description: 'Fetch current SPY price, VIX level, and market status',
  execute: async () => {
    const result = await toolRegistry.getMarketData.execute({});
    if (result.success) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to get market data');
  },
};
