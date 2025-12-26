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
