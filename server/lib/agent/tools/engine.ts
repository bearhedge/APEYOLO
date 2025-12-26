// server/lib/agent/tools/engine.ts
import { ToolDefinition } from '../types';
import { toolRegistry } from '../../agent-tools';

interface EngineArgs {
  strategy?: 'strangle' | 'put-only' | 'call-only';
  symbol?: string;
  riskProfile?: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
}

export const engineTool: ToolDefinition = {
  name: 'runEngine',
  description: 'Run the 5-step trading engine to find opportunities',
  execute: async (args: unknown) => {
    const engineArgs = args as EngineArgs;
    const result = await toolRegistry.runEngine.execute({
      symbol: engineArgs?.symbol || 'SPY',
      strategy: engineArgs?.strategy,
      riskProfile: engineArgs?.riskProfile || 'BALANCED',
    });
    if (result.success) {
      return result.data;
    }
    throw new Error(result.error || 'Failed to run engine');
  },
};
