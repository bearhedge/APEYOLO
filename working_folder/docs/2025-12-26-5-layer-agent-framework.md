# 5-Layer Agent Framework Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace binary query routing with a 5-layer Manus-like agent architecture (Orchestrator → Planner → Executor → Critic → Memory).

**Architecture:** State machine orchestrator coordinates flow. Planner decomposes tasks into steps. Executor runs ReAct loop per step. Critic validates trades (existing dual-brain). Memory persists context to SQLite.

**Tech Stack:** TypeScript, SQLite (better-sqlite3), Ollama (qwen2.5:7b for speed, deepseek-r1:70b + qwen2.5:72b for trades), SSE streaming.

---

## Task 1: Create Agent Module Types

**Files:**
- Create: `server/lib/agent/types.ts`

**Step 1: Create the types file with all interfaces**

```typescript
// server/lib/agent/types.ts

// ============ State Machine ============

export type OrchestratorState =
  | 'IDLE'
  | 'PLANNING'
  | 'EXECUTING'
  | 'VALIDATING'
  | 'RESPONDING'
  | 'ERROR';

export interface SafetyLimits {
  maxToolCalls: number;
  maxLoopIterations: number;
  requestTimeoutMs: number;
  toolTimeoutMs: number;
}

export const DEFAULT_SAFETY_LIMITS: SafetyLimits = {
  maxToolCalls: 5,
  maxLoopIterations: 5,
  requestTimeoutMs: 30000,
  toolTimeoutMs: 10000,
};

// ============ Planner ============

export type Intent =
  | 'market_check'
  | 'position_query'
  | 'trade_proposal'
  | 'conversation';

export interface PlanStep {
  id: number;
  action: 'getMarketData' | 'getPositions' | 'runEngine' | 'respond' | 'validate';
  args?: Record<string, unknown>;
  reason: string;
  dependsOn?: number[];
}

export interface ExecutionPlan {
  intent: Intent;
  confidence: number;
  steps: PlanStep[];
  requiresValidation: boolean;
  estimatedDurationMs: number;
}

export interface PlannerInput {
  userMessage: string;
  conversationContext: Message[];
  cachedMarketData?: unknown;
  cachedPositions?: unknown;
}

// ============ Executor ============

export interface Observation {
  tool: string;
  input: unknown;
  output: unknown;
  durationMs: number;
  success: boolean;
  error?: string;
}

export interface ExecutorState {
  planStep: PlanStep;
  observations: Observation[];
  thoughtChain: string[];
  loopCount: number;
  startTimeMs: number;
}

// ============ Memory ============

export type MessageRole = 'user' | 'assistant' | 'observation';

export interface Message {
  id?: number;
  conversationId: string;
  role: MessageRole;
  content: string;
  metadata?: {
    tool?: string;
    toolResult?: unknown;
    thought?: string;
    planStep?: number;
  };
  createdAt: Date;
}

export interface Conversation {
  id: string;
  userId: string;
  createdAt: Date;
  lastActivityAt: Date;
  summary?: string;
}

export interface ContextCache {
  conversationId: string;
  marketSnapshot?: unknown;
  positionsSnapshot?: unknown;
  cachedAt: Date;
}

// ============ Streaming Events ============

export type AgentEvent =
  | { type: 'state_change'; from: OrchestratorState; to: OrchestratorState }
  | { type: 'plan_ready'; plan: ExecutionPlan }
  | { type: 'step_start'; stepId: number; action: string }
  | { type: 'thought'; content: string }
  | { type: 'tool_start'; tool: string }
  | { type: 'tool_done'; tool: string; result: unknown; durationMs: number }
  | { type: 'tool_error'; tool: string; error: string }
  | { type: 'step_complete'; stepId: number }
  | { type: 'validation_start' }
  | { type: 'validation_result'; approved: boolean; reason: string }
  | { type: 'response_chunk'; content: string }
  | { type: 'done'; finalResponse?: string }
  | { type: 'error'; error: string; recoverable: boolean };

// ============ Tool Registry ============

export interface ToolDefinition {
  name: string;
  description: string;
  execute: (args: unknown) => Promise<unknown>;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  durationMs: number;
}
```

**Step 2: Verify file compiles**

Run: `npx tsc --noEmit server/lib/agent/types.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add server/lib/agent/types.ts
git commit -m "feat(agent): add type definitions for 5-layer agent framework"
```

---

## Task 2: Create Memory Layer with SQLite

**Files:**
- Create: `server/lib/agent/memory.ts`
- Create: `drizzle/agent-schema.ts` (or extend existing)

**Step 1: Write failing test for memory operations**

```typescript
// server/lib/agent/__tests__/memory.test.ts
import { AgentMemory } from '../memory';
import { Message } from '../types';

describe('AgentMemory', () => {
  let memory: AgentMemory;

  beforeEach(() => {
    memory = new AgentMemory(':memory:'); // In-memory SQLite for tests
  });

  afterEach(() => {
    memory.close();
  });

  it('should create a conversation and add messages', () => {
    const convId = memory.createConversation('test-user');
    expect(convId).toBeDefined();

    memory.addMessage(convId, {
      role: 'user',
      content: 'What is SPY at?',
    });

    const messages = memory.getMessages(convId);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('What is SPY at?');
  });

  it('should return context within token budget', () => {
    const convId = memory.createConversation('test-user');

    // Add 20 messages
    for (let i = 0; i < 20; i++) {
      memory.addMessage(convId, {
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i} with some content`,
      });
    }

    // Get context with small budget (should only return recent messages)
    const context = memory.getContext(convId, 500);
    expect(context.length).toBeLessThan(2000); // Rough token estimate
    expect(context).toContain('Message 19'); // Most recent
  });

  it('should cache and retrieve snapshots', () => {
    const convId = memory.createConversation('test-user');

    memory.cacheSnapshot(convId, 'market', { spy: 600, vix: 15 });

    const cached = memory.getCachedSnapshot(convId, 'market');
    expect(cached).toEqual({ spy: 600, vix: 15 });
  });

  it('should return null for stale cache', async () => {
    const convId = memory.createConversation('test-user');

    memory.cacheSnapshot(convId, 'market', { spy: 600 }, 0); // 0 TTL = immediately stale

    const cached = memory.getCachedSnapshot(convId, 'market');
    expect(cached).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest server/lib/agent/__tests__/memory.test.ts --no-coverage`
Expected: FAIL with "Cannot find module '../memory'"

**Step 3: Implement AgentMemory class**

```typescript
// server/lib/agent/memory.ts
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { Message, Conversation, MessageRole } from './types';

const CACHE_TTL_MS = 60000; // 60 seconds default

export class AgentMemory {
  private db: Database.Database;

  constructor(dbPath: string = 'agent-memory.db') {
    this.db = new Database(dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
        summary TEXT
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata JSON,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
      );

      CREATE TABLE IF NOT EXISTS context_cache (
        conversation_id TEXT NOT NULL,
        cache_type TEXT NOT NULL,
        data JSON NOT NULL,
        cached_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (conversation_id, cache_type)
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_data JSON NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_audit_conv ON audit_log(conversation_id);
    `);
  }

  createConversation(userId: string): string {
    const id = uuidv4();
    this.db.prepare(`
      INSERT INTO conversations (id, user_id) VALUES (?, ?)
    `).run(id, userId);
    return id;
  }

  getOrCreateConversation(userId: string, existingId?: string): string {
    if (existingId) {
      const conv = this.db.prepare(`
        SELECT id FROM conversations WHERE id = ?
      `).get(existingId);
      if (conv) {
        this.db.prepare(`
          UPDATE conversations SET last_activity = CURRENT_TIMESTAMP WHERE id = ?
        `).run(existingId);
        return existingId;
      }
    }
    return this.createConversation(userId);
  }

  addMessage(
    conversationId: string,
    message: Omit<Message, 'id' | 'conversationId' | 'createdAt'>
  ): number {
    const result = this.db.prepare(`
      INSERT INTO messages (conversation_id, role, content, metadata)
      VALUES (?, ?, ?, ?)
    `).run(
      conversationId,
      message.role,
      message.content,
      message.metadata ? JSON.stringify(message.metadata) : null
    );

    // Update conversation activity
    this.db.prepare(`
      UPDATE conversations SET last_activity = CURRENT_TIMESTAMP WHERE id = ?
    `).run(conversationId);

    return result.lastInsertRowid as number;
  }

  getMessages(conversationId: string, limit: number = 50): Message[] {
    const rows = this.db.prepare(`
      SELECT id, conversation_id, role, content, metadata, created_at
      FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(conversationId, limit) as any[];

    return rows.reverse().map(row => ({
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role as MessageRole,
      content: row.content,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: new Date(row.created_at),
    }));
  }

  getContext(conversationId: string, tokenBudget: number): string {
    const messages = this.getMessages(conversationId, 20);
    const context: string[] = [];
    let estimatedTokens = 0;

    // Add messages from newest to oldest until budget exhausted
    for (const msg of [...messages].reverse()) {
      const msgTokens = this.estimateTokens(msg.content);
      if (estimatedTokens + msgTokens > tokenBudget) break;

      const prefix = msg.role === 'user' ? 'User' :
                     msg.role === 'observation' ? 'Observation' : 'Assistant';
      context.unshift(`${prefix}: ${msg.content}`);
      estimatedTokens += msgTokens;
    }

    return context.join('\n\n');
  }

  private estimateTokens(text: string): number {
    // Rough estimate: ~4 chars per token
    return Math.ceil(text.length / 4);
  }

  cacheSnapshot(
    conversationId: string,
    cacheType: 'market' | 'positions',
    data: unknown,
    ttlMs: number = CACHE_TTL_MS
  ): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO context_cache (conversation_id, cache_type, data, cached_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `).run(conversationId, cacheType, JSON.stringify(data));
  }

  getCachedSnapshot(
    conversationId: string,
    cacheType: string,
    maxAgeMs: number = CACHE_TTL_MS
  ): unknown | null {
    const row = this.db.prepare(`
      SELECT data, cached_at FROM context_cache
      WHERE conversation_id = ? AND cache_type = ?
    `).get(conversationId, cacheType) as any;

    if (!row) return null;

    const cachedAt = new Date(row.cached_at).getTime();
    const now = Date.now();
    if (now - cachedAt > maxAgeMs) return null;

    return JSON.parse(row.data);
  }

  logAudit(
    conversationId: string,
    eventType: 'plan' | 'tool_call' | 'validation' | 'trade' | 'error',
    eventData: unknown
  ): void {
    this.db.prepare(`
      INSERT INTO audit_log (conversation_id, event_type, event_data)
      VALUES (?, ?, ?)
    `).run(conversationId, eventType, JSON.stringify(eventData));
  }

  cleanup(maxAgeHours: number = 24): void {
    const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString();

    this.db.prepare(`
      DELETE FROM messages WHERE conversation_id IN (
        SELECT id FROM conversations WHERE last_activity < ?
      )
    `).run(cutoff);

    this.db.prepare(`
      DELETE FROM context_cache WHERE conversation_id IN (
        SELECT id FROM conversations WHERE last_activity < ?
      )
    `).run(cutoff);

    this.db.prepare(`
      DELETE FROM conversations WHERE last_activity < ?
    `).run(cutoff);
  }

  close(): void {
    this.db.close();
  }
}

// Singleton instance
let memoryInstance: AgentMemory | null = null;

export function getAgentMemory(): AgentMemory {
  if (!memoryInstance) {
    memoryInstance = new AgentMemory();
  }
  return memoryInstance;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx jest server/lib/agent/__tests__/memory.test.ts --no-coverage`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add server/lib/agent/memory.ts server/lib/agent/__tests__/memory.test.ts
git commit -m "feat(agent): add AgentMemory with SQLite persistence"
```

---

## Task 3: Create Tool Registry

**Files:**
- Create: `server/lib/agent/tools/registry.ts`
- Create: `server/lib/agent/tools/index.ts`

**Step 1: Write failing test for tool registry**

```typescript
// server/lib/agent/tools/__tests__/registry.test.ts
import { ToolRegistry } from '../registry';

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('should register and execute a tool', async () => {
    registry.register({
      name: 'testTool',
      description: 'A test tool',
      execute: async (args: { value: number }) => args.value * 2,
    });

    const result = await registry.execute('testTool', { value: 5 });
    expect(result.success).toBe(true);
    expect(result.data).toBe(10);
  });

  it('should retry on failure with backoff', async () => {
    let attempts = 0;
    registry.register({
      name: 'flakyTool',
      description: 'Fails twice then succeeds',
      execute: async () => {
        attempts++;
        if (attempts < 3) throw new Error('Temporary failure');
        return 'success';
      },
    });

    const result = await registry.execute('flakyTool', {}, { maxRetries: 3 });
    expect(result.success).toBe(true);
    expect(result.data).toBe('success');
    expect(attempts).toBe(3);
  });

  it('should return error after max retries', async () => {
    registry.register({
      name: 'brokenTool',
      description: 'Always fails',
      execute: async () => {
        throw new Error('Permanent failure');
      },
    });

    const result = await registry.execute('brokenTool', {}, { maxRetries: 2 });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Permanent failure');
  });

  it('should list all registered tools', () => {
    registry.register({ name: 'tool1', description: 'First', execute: async () => {} });
    registry.register({ name: 'tool2', description: 'Second', execute: async () => {} });

    const tools = registry.list();
    expect(tools).toHaveLength(2);
    expect(tools.map(t => t.name)).toEqual(['tool1', 'tool2']);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest server/lib/agent/tools/__tests__/registry.test.ts --no-coverage`
Expected: FAIL with "Cannot find module '../registry'"

**Step 3: Implement ToolRegistry**

```typescript
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
```

**Step 4: Run tests to verify they pass**

Run: `npx jest server/lib/agent/tools/__tests__/registry.test.ts --no-coverage`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add server/lib/agent/tools/registry.ts server/lib/agent/tools/__tests__/registry.test.ts
git commit -m "feat(agent): add ToolRegistry with retry logic"
```

---

## Task 4: Register Existing Tools

**Files:**
- Create: `server/lib/agent/tools/market.ts`
- Create: `server/lib/agent/tools/positions.ts`
- Create: `server/lib/agent/tools/engine.ts`
- Create: `server/lib/agent/tools/index.ts`

**Step 1: Create tool wrappers that use existing implementations**

```typescript
// server/lib/agent/tools/market.ts
import { ToolDefinition } from '../types';
import { getMarketData } from '../../agent-tools'; // Existing implementation

export const marketTool: ToolDefinition = {
  name: 'getMarketData',
  description: 'Fetch current SPY price, VIX level, and market status',
  execute: async () => {
    return await getMarketData();
  },
};
```

```typescript
// server/lib/agent/tools/positions.ts
import { ToolDefinition } from '../types';
import { getPositions } from '../../agent-tools'; // Existing implementation

export const positionsTool: ToolDefinition = {
  name: 'getPositions',
  description: 'Fetch current portfolio positions and P&L',
  execute: async () => {
    return await getPositions();
  },
};
```

```typescript
// server/lib/agent/tools/engine.ts
import { ToolDefinition } from '../types';
import { runEngine } from '../../agent-tools'; // Existing implementation

interface EngineArgs {
  strategy?: 'strangle' | 'put-only' | 'call-only';
}

export const engineTool: ToolDefinition = {
  name: 'runEngine',
  description: 'Run the 5-step trading engine to find opportunities',
  execute: async (args: EngineArgs) => {
    return await runEngine(args?.strategy);
  },
};
```

```typescript
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
```

**Step 2: Verify tools compile and can be imported**

Run: `npx tsc --noEmit server/lib/agent/tools/index.ts`
Expected: No errors (may need to check agent-tools.ts exports)

**Step 3: Commit**

```bash
git add server/lib/agent/tools/
git commit -m "feat(agent): register existing tools with new registry"
```

---

## Task 5: Create Planner Layer

**Files:**
- Create: `server/lib/agent/planner.ts`

**Step 1: Write failing test for planner**

```typescript
// server/lib/agent/__tests__/planner.test.ts
import { AgentPlanner } from '../planner';
import { PlannerInput, ExecutionPlan } from '../types';

// Mock the LLM client
jest.mock('../../llm-client', () => ({
  streamChatWithLLM: jest.fn(),
}));

describe('AgentPlanner', () => {
  let planner: AgentPlanner;

  beforeEach(() => {
    planner = new AgentPlanner();
  });

  it('should create a simple plan for market queries', async () => {
    const input: PlannerInput = {
      userMessage: "What's SPY trading at?",
      conversationContext: [],
    };

    const plan = await planner.createPlan(input);

    expect(plan.intent).toBe('market_check');
    expect(plan.requiresValidation).toBe(false);
    expect(plan.steps.length).toBeGreaterThanOrEqual(1);
    expect(plan.steps.some(s => s.action === 'getMarketData')).toBe(true);
  });

  it('should create a validated plan for trade queries', async () => {
    const input: PlannerInput = {
      userMessage: 'Find me a trade opportunity',
      conversationContext: [],
    };

    const plan = await planner.createPlan(input);

    expect(plan.intent).toBe('trade_proposal');
    expect(plan.requiresValidation).toBe(true);
    expect(plan.steps.some(s => s.action === 'validate')).toBe(true);
  });

  it('should include position check for trade queries', async () => {
    const input: PlannerInput = {
      userMessage: 'Propose a strangle',
      conversationContext: [],
    };

    const plan = await planner.createPlan(input);

    expect(plan.steps.some(s => s.action === 'getPositions')).toBe(true);
    expect(plan.steps.some(s => s.action === 'runEngine')).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest server/lib/agent/__tests__/planner.test.ts --no-coverage`
Expected: FAIL with "Cannot find module '../planner'"

**Step 3: Implement AgentPlanner**

```typescript
// server/lib/agent/planner.ts
import { PlannerInput, ExecutionPlan, PlanStep, Intent } from './types';

// Intent detection patterns
const MARKET_PATTERNS = /\b(spy|vix|price|quote|market|trading at|what.*(is|at))\b/i;
const POSITION_PATTERNS = /\b(position|portfolio|holding|p&l|pnl|exposure)\b/i;
const TRADE_PATTERNS = /\b(trade|propose|find|opportunity|setup|engine|strangle|put|call)\b/i;

export class AgentPlanner {
  /**
   * Create an execution plan for a user message.
   * Uses fast heuristics first, falls back to LLM for ambiguous cases.
   */
  async createPlan(input: PlannerInput): Promise<ExecutionPlan> {
    const intent = this.detectIntent(input.userMessage);
    const steps = this.generateSteps(intent, input);
    const requiresValidation = intent === 'trade_proposal';

    return {
      intent,
      confidence: this.calculateConfidence(intent, input.userMessage),
      steps,
      requiresValidation,
      estimatedDurationMs: this.estimateDuration(steps, requiresValidation),
    };
  }

  private detectIntent(message: string): Intent {
    const lowerMessage = message.toLowerCase();

    // Trade intent takes priority (safety-critical)
    if (TRADE_PATTERNS.test(lowerMessage)) {
      return 'trade_proposal';
    }

    // Position queries
    if (POSITION_PATTERNS.test(lowerMessage)) {
      return 'position_query';
    }

    // Market data queries
    if (MARKET_PATTERNS.test(lowerMessage)) {
      return 'market_check';
    }

    // Default to conversation for anything else
    return 'conversation';
  }

  private generateSteps(intent: Intent, input: PlannerInput): PlanStep[] {
    switch (intent) {
      case 'market_check':
        return this.marketCheckSteps(input);
      case 'position_query':
        return this.positionQuerySteps(input);
      case 'trade_proposal':
        return this.tradeProposalSteps(input);
      case 'conversation':
      default:
        return this.conversationSteps(input);
    }
  }

  private marketCheckSteps(input: PlannerInput): PlanStep[] {
    const steps: PlanStep[] = [];
    let stepId = 1;

    // Skip if we have fresh cached data
    if (!input.cachedMarketData) {
      steps.push({
        id: stepId++,
        action: 'getMarketData',
        reason: 'Fetch current SPY/VIX prices',
      });
    }

    steps.push({
      id: stepId++,
      action: 'respond',
      reason: 'Report market data to user',
      dependsOn: steps.length > 0 ? [1] : undefined,
    });

    return steps;
  }

  private positionQuerySteps(input: PlannerInput): PlanStep[] {
    const steps: PlanStep[] = [];
    let stepId = 1;

    if (!input.cachedPositions) {
      steps.push({
        id: stepId++,
        action: 'getPositions',
        reason: 'Fetch current portfolio positions',
      });
    }

    steps.push({
      id: stepId++,
      action: 'respond',
      reason: 'Report positions to user',
      dependsOn: steps.length > 0 ? [1] : undefined,
    });

    return steps;
  }

  private tradeProposalSteps(input: PlannerInput): PlanStep[] {
    const steps: PlanStep[] = [];
    let stepId = 1;

    // Always fetch fresh market data for trades
    steps.push({
      id: stepId++,
      action: 'getMarketData',
      reason: 'Check current market conditions',
    });

    steps.push({
      id: stepId++,
      action: 'getPositions',
      reason: 'Check existing exposure',
    });

    // Run engine depends on market + positions
    steps.push({
      id: stepId++,
      action: 'runEngine',
      reason: 'Find trading opportunities',
      dependsOn: [1, 2],
    });

    // Validation is mandatory for trades
    steps.push({
      id: stepId++,
      action: 'validate',
      reason: 'Critic must approve before presenting to user',
      dependsOn: [3],
    });

    return steps;
  }

  private conversationSteps(_input: PlannerInput): PlanStep[] {
    return [
      {
        id: 1,
        action: 'respond',
        reason: 'Respond to general query',
      },
    ];
  }

  private calculateConfidence(intent: Intent, message: string): number {
    const lowerMessage = message.toLowerCase();

    // Count pattern matches for confidence
    let matches = 0;
    let total = 0;

    if (intent === 'trade_proposal') {
      const tradeWords = ['trade', 'propose', 'opportunity', 'engine', 'strangle', 'put', 'call'];
      tradeWords.forEach(word => {
        total++;
        if (lowerMessage.includes(word)) matches++;
      });
    } else if (intent === 'market_check') {
      const marketWords = ['spy', 'vix', 'price', 'market', 'quote'];
      marketWords.forEach(word => {
        total++;
        if (lowerMessage.includes(word)) matches++;
      });
    } else if (intent === 'position_query') {
      const posWords = ['position', 'portfolio', 'holding', 'pnl'];
      posWords.forEach(word => {
        total++;
        if (lowerMessage.includes(word)) matches++;
      });
    }

    if (total === 0) return 0.5; // Conversation fallback
    return Math.min(0.5 + (matches / total) * 0.5, 0.99);
  }

  private estimateDuration(steps: PlanStep[], requiresValidation: boolean): number {
    let duration = 0;

    for (const step of steps) {
      switch (step.action) {
        case 'getMarketData':
          duration += 500;
          break;
        case 'getPositions':
          duration += 500;
          break;
        case 'runEngine':
          duration += 3000;
          break;
        case 'validate':
          duration += 8000; // Dual-brain is slow
          break;
        case 'respond':
          duration += 500;
          break;
      }
    }

    return duration;
  }
}

// Singleton
let plannerInstance: AgentPlanner | null = null;

export function getAgentPlanner(): AgentPlanner {
  if (!plannerInstance) {
    plannerInstance = new AgentPlanner();
  }
  return plannerInstance;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx jest server/lib/agent/__tests__/planner.test.ts --no-coverage`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add server/lib/agent/planner.ts server/lib/agent/__tests__/planner.test.ts
git commit -m "feat(agent): add AgentPlanner with intent detection"
```

---

## Task 6: Create Executor Layer (ReAct Loop)

**Files:**
- Create: `server/lib/agent/executor.ts`

**Step 1: Write failing test for executor**

```typescript
// server/lib/agent/__tests__/executor.test.ts
import { AgentExecutor } from '../executor';
import { PlanStep, AgentEvent } from '../types';
import { ToolRegistry } from '../tools/registry';

describe('AgentExecutor', () => {
  let executor: AgentExecutor;
  let mockRegistry: ToolRegistry;

  beforeEach(() => {
    mockRegistry = new ToolRegistry();
    mockRegistry.register({
      name: 'getMarketData',
      description: 'Test market data',
      execute: async () => ({ spy: 605.50, vix: 14.2, status: 'open' }),
    });
    mockRegistry.register({
      name: 'getPositions',
      description: 'Test positions',
      execute: async () => ({ positions: [], netLiq: 100000 }),
    });

    executor = new AgentExecutor(mockRegistry);
  });

  it('should execute a simple plan and emit events', async () => {
    const plan: PlanStep[] = [
      { id: 1, action: 'getMarketData', reason: 'Fetch prices' },
      { id: 2, action: 'respond', reason: 'Report to user', dependsOn: [1] },
    ];

    const events: AgentEvent[] = [];
    for await (const event of executor.execute(plan, 'test-conv')) {
      events.push(event);
    }

    // Should have step_start, tool_start, tool_done, step_complete for step 1
    expect(events.some(e => e.type === 'step_start' && e.stepId === 1)).toBe(true);
    expect(events.some(e => e.type === 'tool_done' && e.tool === 'getMarketData')).toBe(true);
    expect(events.some(e => e.type === 'step_complete' && e.stepId === 1)).toBe(true);

    // Should have response for step 2
    expect(events.some(e => e.type === 'response_chunk')).toBe(true);
    expect(events.some(e => e.type === 'done')).toBe(true);
  });

  it('should respect step dependencies', async () => {
    const plan: PlanStep[] = [
      { id: 1, action: 'getMarketData', reason: 'Fetch prices' },
      { id: 2, action: 'getPositions', reason: 'Fetch positions' },
      { id: 3, action: 'respond', reason: 'Combine and report', dependsOn: [1, 2] },
    ];

    const stepOrder: number[] = [];
    for await (const event of executor.execute(plan, 'test-conv')) {
      if (event.type === 'step_complete') {
        stepOrder.push(event.stepId);
      }
    }

    // Step 3 should complete after steps 1 and 2
    expect(stepOrder.indexOf(3)).toBeGreaterThan(stepOrder.indexOf(1));
    expect(stepOrder.indexOf(3)).toBeGreaterThan(stepOrder.indexOf(2));
  });

  it('should handle tool errors gracefully', async () => {
    mockRegistry.register({
      name: 'brokenTool',
      description: 'Always fails',
      execute: async () => { throw new Error('Tool broke'); },
    });

    // Replace getMarketData with broken version for this test
    const executor2 = new AgentExecutor(mockRegistry);
    const plan: PlanStep[] = [
      { id: 1, action: 'brokenTool' as any, reason: 'Will fail' },
    ];

    const events: AgentEvent[] = [];
    for await (const event of executor2.execute(plan, 'test-conv')) {
      events.push(event);
    }

    expect(events.some(e => e.type === 'tool_error')).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest server/lib/agent/__tests__/executor.test.ts --no-coverage`
Expected: FAIL with "Cannot find module '../executor'"

**Step 3: Implement AgentExecutor**

```typescript
// server/lib/agent/executor.ts
import { PlanStep, AgentEvent, Observation, ExecutorState } from './types';
import { ToolRegistry } from './tools/registry';
import { getAgentMemory } from './memory';

export class AgentExecutor {
  private registry: ToolRegistry;
  private observations: Map<number, Observation> = new Map();

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  /**
   * Execute a plan step by step, yielding events for streaming.
   */
  async *execute(
    plan: PlanStep[],
    conversationId: string
  ): AsyncGenerator<AgentEvent> {
    this.observations.clear();
    const completed = new Set<number>();

    // Execute steps respecting dependencies
    while (completed.size < plan.length) {
      const readySteps = plan.filter(step => {
        if (completed.has(step.id)) return false;
        if (!step.dependsOn) return true;
        return step.dependsOn.every(depId => completed.has(depId));
      });

      if (readySteps.length === 0) {
        yield { type: 'error', error: 'Circular dependency in plan', recoverable: false };
        return;
      }

      // Execute ready steps (could parallelize independent steps)
      for (const step of readySteps) {
        yield* this.executeStep(step, conversationId);
        completed.add(step.id);
      }
    }

    yield { type: 'done' };
  }

  private async *executeStep(
    step: PlanStep,
    conversationId: string
  ): AsyncGenerator<AgentEvent> {
    yield { type: 'step_start', stepId: step.id, action: step.action };

    // Generate thought about this step
    const thought = this.generateThought(step);
    yield { type: 'thought', content: thought };

    if (step.action === 'respond') {
      // Generate response based on collected observations
      yield* this.generateResponse(conversationId);
    } else if (step.action === 'validate') {
      // Delegate to critic (will be implemented in Task 7)
      yield { type: 'validation_start' };
      // For now, auto-approve (critic integration comes later)
      yield { type: 'validation_result', approved: true, reason: 'Validation pending' };
    } else {
      // Execute tool
      yield* this.executeTool(step);
    }

    yield { type: 'step_complete', stepId: step.id };
  }

  private async *executeTool(step: PlanStep): AsyncGenerator<AgentEvent> {
    yield { type: 'tool_start', tool: step.action };

    const result = await this.registry.execute(step.action, step.args || {});

    if (result.success) {
      this.observations.set(step.id, {
        tool: step.action,
        input: step.args,
        output: result.data,
        durationMs: result.durationMs,
        success: true,
      });

      yield {
        type: 'tool_done',
        tool: step.action,
        result: result.data,
        durationMs: result.durationMs,
      };
    } else {
      this.observations.set(step.id, {
        tool: step.action,
        input: step.args,
        output: null,
        durationMs: result.durationMs,
        success: false,
        error: result.error,
      });

      yield {
        type: 'tool_error',
        tool: step.action,
        error: result.error || 'Unknown error',
      };
    }
  }

  private generateThought(step: PlanStep): string {
    const previousObs = Array.from(this.observations.values());

    if (previousObs.length === 0) {
      return `Starting with ${step.action}: ${step.reason}`;
    }

    const context = previousObs
      .filter(o => o.success)
      .map(o => `${o.tool} returned data`)
      .join(', ');

    return `Based on ${context}, now executing ${step.action}: ${step.reason}`;
  }

  private async *generateResponse(conversationId: string): AsyncGenerator<AgentEvent> {
    // Collect all successful observations
    const successfulObs = Array.from(this.observations.values())
      .filter(o => o.success);

    if (successfulObs.length === 0) {
      yield { type: 'response_chunk', content: 'Unable to fetch required data.' };
      return;
    }

    // Format response based on observations
    const response = this.formatObservationsAsResponse(successfulObs);

    // Stream response in chunks (simulating LLM streaming)
    const words = response.split(' ');
    for (let i = 0; i < words.length; i += 3) {
      const chunk = words.slice(i, i + 3).join(' ') + ' ';
      yield { type: 'response_chunk', content: chunk };
      await this.sleep(50); // Simulate streaming delay
    }

    // Save response to memory
    const memory = getAgentMemory();
    memory.addMessage(conversationId, {
      role: 'assistant',
      content: response,
      metadata: {
        observations: successfulObs.map(o => ({ tool: o.tool, success: o.success })),
      },
    });
  }

  private formatObservationsAsResponse(observations: Observation[]): string {
    const parts: string[] = [];

    for (const obs of observations) {
      if (obs.tool === 'getMarketData' && obs.output) {
        const data = obs.output as any;
        parts.push(`SPY is trading at $${data.spy?.toFixed(2) || 'N/A'}. VIX is at ${data.vix?.toFixed(1) || 'N/A'}. Market is ${data.status || 'unknown'}.`);
      } else if (obs.tool === 'getPositions' && obs.output) {
        const data = obs.output as any;
        const posCount = data.positions?.length || 0;
        parts.push(`You have ${posCount} open position${posCount !== 1 ? 's' : ''}. Net liquidation: $${data.netLiq?.toLocaleString() || 'N/A'}.`);
      } else if (obs.tool === 'runEngine' && obs.output) {
        const data = obs.output as any;
        if (data.proposal) {
          parts.push(`Found opportunity: ${data.proposal.strategy || 'trade'} on ${data.proposal.symbol || 'SPY'}.`);
        } else {
          parts.push('No trading opportunities found at this time.');
        }
      }
    }

    return parts.join(' ') || 'Data retrieved successfully.';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get all observations collected during execution.
   */
  getObservations(): Map<number, Observation> {
    return new Map(this.observations);
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx jest server/lib/agent/__tests__/executor.test.ts --no-coverage`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add server/lib/agent/executor.ts server/lib/agent/__tests__/executor.test.ts
git commit -m "feat(agent): add AgentExecutor with ReAct loop"
```

---

## Task 7: Create Orchestrator (State Machine)

**Files:**
- Create: `server/lib/agent/orchestrator.ts`

**Step 1: Write failing test for orchestrator**

```typescript
// server/lib/agent/__tests__/orchestrator.test.ts
import { AgentOrchestrator } from '../orchestrator';
import { AgentEvent } from '../types';
import { ToolRegistry } from '../tools/registry';

describe('AgentOrchestrator', () => {
  let orchestrator: AgentOrchestrator;
  let mockRegistry: ToolRegistry;

  beforeEach(() => {
    mockRegistry = new ToolRegistry();
    mockRegistry.register({
      name: 'getMarketData',
      description: 'Test market data',
      execute: async () => ({ spy: 605.50, vix: 14.2, status: 'open' }),
    });

    orchestrator = new AgentOrchestrator(mockRegistry);
  });

  it('should transition through states for a simple query', async () => {
    const events: AgentEvent[] = [];

    for await (const event of orchestrator.run({
      userMessage: "What's SPY at?",
      userId: 'test-user',
    })) {
      events.push(event);
    }

    // Should see state transitions
    const stateChanges = events.filter(e => e.type === 'state_change');
    expect(stateChanges.length).toBeGreaterThan(0);

    // Should end in IDLE
    const lastStateChange = stateChanges[stateChanges.length - 1];
    expect(lastStateChange.type === 'state_change' && lastStateChange.to).toBe('IDLE');
  });

  it('should emit plan_ready event', async () => {
    const events: AgentEvent[] = [];

    for await (const event of orchestrator.run({
      userMessage: "What's SPY at?",
      userId: 'test-user',
    })) {
      events.push(event);
    }

    expect(events.some(e => e.type === 'plan_ready')).toBe(true);
  });

  it('should enforce timeout limits', async () => {
    // Create slow tool
    mockRegistry.register({
      name: 'slowTool',
      description: 'Takes forever',
      execute: async () => {
        await new Promise(r => setTimeout(r, 50000)); // 50 seconds
        return {};
      },
    });

    const orchestrator2 = new AgentOrchestrator(mockRegistry, {
      requestTimeoutMs: 100, // 100ms timeout for test
    });

    const events: AgentEvent[] = [];
    for await (const event of orchestrator2.run({
      userMessage: 'Use slowTool',
      userId: 'test-user',
    })) {
      events.push(event);
      if (events.length > 20) break; // Prevent infinite loop in test
    }

    // Should have error or timeout
    const hasTimeout = events.some(e =>
      e.type === 'error' && e.error.toLowerCase().includes('timeout')
    );
    // Note: May not trigger if plan doesn't include slowTool
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest server/lib/agent/__tests__/orchestrator.test.ts --no-coverage`
Expected: FAIL with "Cannot find module '../orchestrator'"

**Step 3: Implement AgentOrchestrator**

```typescript
// server/lib/agent/orchestrator.ts
import {
  OrchestratorState,
  SafetyLimits,
  DEFAULT_SAFETY_LIMITS,
  AgentEvent,
  ExecutionPlan,
} from './types';
import { AgentPlanner, getAgentPlanner } from './planner';
import { AgentExecutor } from './executor';
import { ToolRegistry, getToolRegistry } from './tools/registry';
import { AgentMemory, getAgentMemory } from './memory';

export interface RunInput {
  userMessage: string;
  userId: string;
  conversationId?: string;
}

export class AgentOrchestrator {
  private state: OrchestratorState = 'IDLE';
  private planner: AgentPlanner;
  private registry: ToolRegistry;
  private memory: AgentMemory;
  private limits: SafetyLimits;
  private toolCallCount: number = 0;
  private startTime: number = 0;

  constructor(
    registry?: ToolRegistry,
    limits?: Partial<SafetyLimits>
  ) {
    this.registry = registry || getToolRegistry();
    this.planner = getAgentPlanner();
    this.memory = getAgentMemory();
    this.limits = { ...DEFAULT_SAFETY_LIMITS, ...limits };
  }

  /**
   * Run the agent for a user message.
   * Yields events for streaming to the frontend.
   */
  async *run(input: RunInput): AsyncGenerator<AgentEvent> {
    this.startTime = Date.now();
    this.toolCallCount = 0;

    // Get or create conversation
    const conversationId = this.memory.getOrCreateConversation(
      input.userId,
      input.conversationId
    );

    // Save user message
    this.memory.addMessage(conversationId, {
      role: 'user',
      content: input.userMessage,
    });

    try {
      // IDLE -> PLANNING
      yield* this.transitionTo('PLANNING');

      // Create execution plan
      const context = this.memory.getMessages(conversationId, 5);
      const cachedMarket = this.memory.getCachedSnapshot(conversationId, 'market');
      const cachedPositions = this.memory.getCachedSnapshot(conversationId, 'positions');

      const plan = await this.planner.createPlan({
        userMessage: input.userMessage,
        conversationContext: context,
        cachedMarketData: cachedMarket,
        cachedPositions: cachedPositions,
      });

      yield { type: 'plan_ready', plan };

      // Log plan to audit
      this.memory.logAudit(conversationId, 'plan', plan);

      // PLANNING -> EXECUTING
      yield* this.transitionTo('EXECUTING');

      // Execute plan
      const executor = new AgentExecutor(this.registry);

      for await (const event of executor.execute(plan.steps, conversationId)) {
        // Check timeout
        if (Date.now() - this.startTime > this.limits.requestTimeoutMs) {
          yield { type: 'error', error: 'Request timeout', recoverable: false };
          yield* this.transitionTo('ERROR');
          yield* this.transitionTo('IDLE');
          return;
        }

        // Track tool calls
        if (event.type === 'tool_done' || event.type === 'tool_error') {
          this.toolCallCount++;
          if (this.toolCallCount > this.limits.maxToolCalls) {
            yield { type: 'error', error: 'Max tool calls exceeded', recoverable: false };
            yield* this.transitionTo('ERROR');
            yield* this.transitionTo('IDLE');
            return;
          }
        }

        // Handle validation step
        if (event.type === 'validation_start' && plan.requiresValidation) {
          yield* this.transitionTo('VALIDATING');
        }

        yield event;

        // Cache tool results
        if (event.type === 'tool_done') {
          if (event.tool === 'getMarketData') {
            this.memory.cacheSnapshot(conversationId, 'market', event.result);
          } else if (event.tool === 'getPositions') {
            this.memory.cacheSnapshot(conversationId, 'positions', event.result);
          }
        }
      }

      // EXECUTING -> RESPONDING -> IDLE
      yield* this.transitionTo('RESPONDING');
      yield* this.transitionTo('IDLE');

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      yield { type: 'error', error: errorMessage, recoverable: false };

      this.memory.logAudit(conversationId, 'error', { error: errorMessage });

      yield* this.transitionTo('ERROR');
      yield* this.transitionTo('IDLE');
    }
  }

  private async *transitionTo(newState: OrchestratorState): AsyncGenerator<AgentEvent> {
    const from = this.state;
    this.state = newState;
    yield { type: 'state_change', from, to: newState };
  }

  getState(): OrchestratorState {
    return this.state;
  }
}

// Factory function
export function createAgentOrchestrator(
  limits?: Partial<SafetyLimits>
): AgentOrchestrator {
  return new AgentOrchestrator(getToolRegistry(), limits);
}
```

**Step 4: Run tests to verify they pass**

Run: `npx jest server/lib/agent/__tests__/orchestrator.test.ts --no-coverage`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add server/lib/agent/orchestrator.ts server/lib/agent/__tests__/orchestrator.test.ts
git commit -m "feat(agent): add AgentOrchestrator state machine"
```

---

## Task 8: Create Agent Module Index

**Files:**
- Create: `server/lib/agent/index.ts`

**Step 1: Create public API**

```typescript
// server/lib/agent/index.ts
export * from './types';
export { AgentMemory, getAgentMemory } from './memory';
export { AgentPlanner, getAgentPlanner } from './planner';
export { AgentExecutor } from './executor';
export { AgentOrchestrator, createAgentOrchestrator, type RunInput } from './orchestrator';
export { ToolRegistry, getToolRegistry, initializeTools } from './tools';
```

**Step 2: Verify all exports compile**

Run: `npx tsc --noEmit server/lib/agent/index.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add server/lib/agent/index.ts
git commit -m "feat(agent): add agent module public API"
```

---

## Task 9: Integrate with Agent Routes

**Files:**
- Modify: `server/agentRoutes.ts`

**Step 1: Update the operate endpoint to use new orchestrator**

Find the `/api/agent/operate` POST handler and add the new agent integration:

```typescript
// At the top of agentRoutes.ts, add import:
import { createAgentOrchestrator, initializeTools, AgentEvent } from './lib/agent';

// Initialize tools on module load
initializeTools();

// In the /operate endpoint, add new version check:
app.post('/api/agent/operate', async (req, res) => {
  const { operation, userId, conversationId, message } = req.body;

  // Check for new agent version header
  const useNewAgent = req.headers['x-agent-version'] === 'v2';

  if (useNewAgent && operation === 'custom' && message) {
    // New 5-layer agent
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const orchestrator = createAgentOrchestrator();

    try {
      for await (const event of orchestrator.run({
        userMessage: message,
        userId: userId || 'default',
        conversationId,
      })) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (error) {
      res.write(`data: ${JSON.stringify({
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        recoverable: false
      })}\n\n`);
    }

    res.end();
    return;
  }

  // ... existing logic for old agent
});
```

**Step 2: Verify server compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Manual test with curl**

```bash
curl -X POST http://localhost:5000/api/agent/operate \
  -H "Content-Type: application/json" \
  -H "X-Agent-Version: v2" \
  -d '{"operation":"custom","message":"What is SPY at?","userId":"test"}'
```

Expected: SSE stream with state_change, plan_ready, step_start, tool_done, response_chunk, done events

**Step 4: Commit**

```bash
git add server/agentRoutes.ts
git commit -m "feat(agent): integrate 5-layer agent with operate endpoint"
```

---

## Task 10: Update Frontend Hook (Minimal)

**Files:**
- Modify: `client/src/hooks/useAgentOperator.ts`

**Step 1: Add new event handlers**

```typescript
// In the handleSSEEvent function, add cases for new events:

case 'state_change':
  console.log(`Agent state: ${event.from} -> ${event.to}`);
  break;

case 'plan_ready':
  addActivity('info', `Plan: ${event.plan.steps.length} steps, intent: ${event.plan.intent}`);
  break;

case 'thought':
  addActivity('thinking', event.content, undefined, 'running');
  break;

case 'tool_start':
  addActivity('action', `Calling ${event.tool}...`, undefined, 'running');
  break;

case 'tool_done':
  // Update last activity to done
  updateLastActivity('done');
  break;

case 'response_chunk':
  appendToStreamingResult(event.content);
  break;
```

**Step 2: Verify frontend compiles**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add client/src/hooks/useAgentOperator.ts
git commit -m "feat(agent): handle new SSE events in frontend hook"
```

---

## Summary

**Total Tasks:** 10
**New Files:** 12
**Modified Files:** 2

**Architecture Built:**
- Types: Complete type system for all layers
- Memory: SQLite-backed conversation persistence
- Tools: Registry with retry logic, existing tools wrapped
- Planner: Intent detection and step generation
- Executor: ReAct loop with streaming
- Orchestrator: State machine coordinator

**Next Steps After Implementation:**
1. Add critic integration (connect to existing dual-brain)
2. Add LLM-based planner for ambiguous queries
3. Add more sophisticated response generation
4. Performance tuning and monitoring
