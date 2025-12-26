// server/lib/agent/tools/registry.ts
import { ToolDefinition, ToolResult } from '../types';

interface ExecuteOptions {
  maxRetries?: number;
  timeoutMs?: number;
}

const DEFAULT_OPTIONS: ExecuteOptions = {
  maxRetries: 3,
  timeoutMs: 10000,
};

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async execute(
    name: string,
    args: unknown,
    options: ExecuteOptions = {}
  ): Promise<ToolResult> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const tool = this.tools.get(name);

    if (!tool) {
      return {
        success: false,
        error: `Tool not found: ${name}`,
        durationMs: 0,
      };
    }

    const startTime = Date.now();
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= opts.maxRetries!; attempt++) {
      try {
        const result = await Promise.race([
          tool.execute(args),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Tool timeout')), opts.timeoutMs)
          ),
        ]);

        return {
          success: true,
          data: result,
          durationMs: Date.now() - startTime,
        };
      } catch (error) {
        lastError = error as Error;

        if (attempt < opts.maxRetries!) {
          // Exponential backoff: 100ms, 200ms, 400ms...
          await this.sleep(100 * Math.pow(2, attempt - 1));
        }
      }
    }

    return {
      success: false,
      error: lastError?.message || 'Unknown error',
      durationMs: Date.now() - startTime,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance with pre-registered tools
let registryInstance: ToolRegistry | null = null;

export function getToolRegistry(): ToolRegistry {
  if (!registryInstance) {
    registryInstance = new ToolRegistry();
  }
  return registryInstance;
}
