// server/lib/agent/tools/positions.ts
import { ToolDefinition } from '../types';
import { toolRegistry } from '../../agent-tools';

export const positionsTool: ToolDefinition = {
  name: 'getPositions',
  description: 'Fetch current portfolio positions and P&L',
  execute: async () => {
    const result = await toolRegistry.getPositions.execute({});
    if (result.success) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to get positions');
  },
};
