// server/lib/agent/tools/index.ts
import { ToolRegistry, getToolRegistry } from './registry';
import { marketTool } from './market';
import { positionsTool } from './positions';
import { engineTool } from './engine';

export function initializeTools(): ToolRegistry {
  const registry = getToolRegistry();

  registry.register(marketTool);
  registry.register(positionsTool);
  registry.register(engineTool);

  return registry;
}

export { ToolRegistry, getToolRegistry } from './registry';
export { marketTool } from './market';
export { positionsTool } from './positions';
export { engineTool } from './engine';

// LLM tool calling exports
export { thinkDeeply, type ThinkDeeplyArgs, type ThinkDeeplyResult } from './think-deeply';
export { AGENT_TOOLS, type ToolExecutors } from './definitions';
