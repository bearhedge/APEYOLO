# LLM-Orchestrated Agent Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace regex-based intent detection with LLM-native tool calling, where the model decides what tools to call (like Manus AI).

**Architecture:**
- Orchestrator model (qwen2.5:32b) receives all queries and decides what tools to call
- Tools include: get_market_data, get_positions, run_engine, think_deeply
- think_deeply tool calls DeepSeek-R1:70b for complex reasoning
- Standard Ollama tool calling loop: query → model → tool_calls → execute → results → final response

**Tech Stack:** Ollama tool calling API, TypeScript, existing IBKR tools

---

## Pre-requisite: Pull Models

On Mac terminal:
```bash
ollama pull qwen2.5:32b
```

Verify models:
```bash
ollama list
# Should show: qwen2.5:32b, deepseek-r1:70b
```

---

## Task 1: Add Tool Calling Types

**Files:**
- Modify: `server/lib/llm-client.ts`

**Step 1: Add tool calling types to llm-client.ts**

Add after the existing interfaces (around line 50):

```typescript
// Tool calling types (Ollama native format)
export interface ToolFunction {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
    }>;
    required?: string[];
  };
}

export interface Tool {
  type: 'function';
  function: ToolFunction;
}

export interface ToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface LLMToolMessage {
  role: 'tool';
  tool_name: string;
  content: string;
}

export interface LLMAssistantMessage {
  role: 'assistant';
  content: string;
  thinking?: string;
  tool_calls?: ToolCall[];
}

export interface ChatWithToolsRequest {
  model: string;
  messages: (LLMMessage | LLMToolMessage | LLMAssistantMessage)[];
  tools?: Tool[];
  stream?: boolean;
  think?: boolean;
}

export interface ChatWithToolsResponse {
  message: LLMAssistantMessage;
  done: boolean;
}
```

**Step 2: Verify types compile**

Run: `cd /home/info/Projects/APEYOLO && npm run check`
Expected: No type errors

**Step 3: Commit**

```bash
git add server/lib/llm-client.ts
git commit -m "feat(agent): add Ollama tool calling types"
```

---

## Task 2: Add chatWithTools Function

**Files:**
- Modify: `server/lib/llm-client.ts`

**Step 1: Add non-streaming chatWithTools function**

Add after the existing chat functions:

```typescript
/**
 * Chat with LLM using native tool calling.
 * The model decides what tools to call based on the query.
 */
export async function chatWithTools(request: ChatWithToolsRequest): Promise<ChatWithToolsResponse> {
  const tunnelUrl = getTunnelUrl();

  if (!tunnelUrl) {
    throw new Error('LLM_TUNNEL_URL not configured');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const response = await fetch(`${tunnelUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        tools: request.tools,
        stream: false,
        think: request.think ?? false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM request failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return {
      message: {
        role: 'assistant',
        content: data.message?.content || '',
        thinking: data.message?.thinking,
        tool_calls: data.message?.tool_calls,
      },
      done: data.done ?? true,
    };
  } catch (error: any) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') {
      throw new Error('LLM request timeout');
    }
    throw error;
  }
}
```

**Step 2: Add streaming version**

```typescript
/**
 * Stream chat with LLM using native tool calling.
 */
export async function* streamChatWithTools(
  request: ChatWithToolsRequest
): AsyncGenerator<{ content?: string; thinking?: string; tool_calls?: ToolCall[]; done: boolean }> {
  const tunnelUrl = getTunnelUrl();

  if (!tunnelUrl) {
    throw new Error('LLM_TUNNEL_URL not configured');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const response = await fetch(`${tunnelUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        tools: request.tools,
        stream: true,
        think: request.think ?? false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM request failed: ${response.status} - ${errorText}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim()) {
          try {
            const chunk = JSON.parse(line);
            yield {
              content: chunk.message?.content,
              thinking: chunk.message?.thinking,
              tool_calls: chunk.message?.tool_calls,
              done: chunk.done ?? false,
            };
            if (chunk.done) return;
          } catch {
            // Skip non-JSON lines
          }
        }
      }
    }
  } catch (error: any) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') {
      throw new Error('LLM request timeout');
    }
    throw error;
  }
}
```

**Step 3: Export new functions**

Add to exports at bottom of file:
```typescript
export { chatWithTools, streamChatWithTools };
```

**Step 4: Verify compilation**

Run: `npm run check`
Expected: No errors

**Step 5: Commit**

```bash
git add server/lib/llm-client.ts
git commit -m "feat(agent): add chatWithTools functions for native tool calling"
```

---

## Task 3: Define Agent Tools in Ollama Format

**Files:**
- Create: `server/lib/agent/tools/definitions.ts`

**Step 1: Create tool definitions file**

```typescript
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
```

**Step 2: Verify compilation**

Run: `npm run check`
Expected: No errors

**Step 3: Commit**

```bash
git add server/lib/agent/tools/definitions.ts
git commit -m "feat(agent): add Ollama-format tool definitions"
```

---

## Task 4: Implement think_deeply Tool

**Files:**
- Create: `server/lib/agent/tools/think-deeply.ts`

**Step 1: Create think_deeply tool that calls DeepSeek-R1**

```typescript
// server/lib/agent/tools/think-deeply.ts
import { chatWithLLM, PROPOSER_MODEL, LLMMessage } from '../../llm-client';

export interface ThinkDeeplyArgs {
  query: string;
  context?: string;
}

export interface ThinkDeeplyResult {
  reasoning: string;
  conclusion: string;
}

/**
 * Think deeply about a question using DeepSeek-R1:70b.
 * This is called when the orchestrator needs complex reasoning.
 */
export async function thinkDeeply(args: ThinkDeeplyArgs): Promise<ThinkDeeplyResult> {
  const systemPrompt = `You are a deep reasoning expert for 0DTE SPY options trading.
Analyze the question thoroughly. Consider risks, market conditions, and trading rules.
Provide your reasoning step by step, then give a clear conclusion.

Format your response as:
REASONING:
[Your step-by-step analysis]

CONCLUSION:
[Your final answer or recommendation]`;

  const userContent = args.context
    ? `Question: ${args.query}\n\nContext:\n${args.context}`
    : args.query;

  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];

  const response = await chatWithLLM({
    messages,
    model: PROPOSER_MODEL, // DeepSeek-R1:70b
    stream: false,
  });

  const content = response.message.content;

  // Parse reasoning and conclusion
  const reasoningMatch = content.match(/REASONING:\s*([\s\S]*?)(?=CONCLUSION:|$)/i);
  const conclusionMatch = content.match(/CONCLUSION:\s*([\s\S]*?)$/i);

  return {
    reasoning: reasoningMatch?.[1]?.trim() || content,
    conclusion: conclusionMatch?.[1]?.trim() || content,
  };
}
```

**Step 2: Export from tools index**

Add to `server/lib/agent/tools/index.ts`:
```typescript
export { thinkDeeply, type ThinkDeeplyArgs, type ThinkDeeplyResult } from './think-deeply';
export { AGENT_TOOLS, type ToolExecutors } from './definitions';
```

**Step 3: Verify compilation**

Run: `npm run check`
Expected: No errors

**Step 4: Commit**

```bash
git add server/lib/agent/tools/think-deeply.ts server/lib/agent/tools/index.ts
git commit -m "feat(agent): add think_deeply tool using DeepSeek-R1"
```

---

## Task 5: Rewrite Orchestrator with Tool Calling Loop

**Files:**
- Modify: `server/lib/agent/orchestrator.ts`

**Step 1: Replace the orchestrator with tool calling implementation**

Replace the entire file with:

```typescript
// server/lib/agent/orchestrator.ts
import {
  OrchestratorState,
  SafetyLimits,
  DEFAULT_SAFETY_LIMITS,
  AgentEvent,
} from './types';
import { AgentMemory, getAgentMemory } from './memory';
import {
  chatWithTools,
  streamChatWithTools,
  LLMMessage,
  LLMToolMessage,
  LLMAssistantMessage,
  ToolCall,
} from '../llm-client';
import { AGENT_TOOLS } from './tools/definitions';
import { thinkDeeply } from './tools/think-deeply';
import { toolRegistry } from '../agent-tools';

// Orchestrator model - fast and capable
const ORCHESTRATOR_MODEL = process.env.LLM_ORCHESTRATOR_MODEL || 'qwen2.5:32b';

export interface RunInput {
  userMessage: string;
  userId: string;
  conversationId?: string;
}

export class AgentOrchestrator {
  private state: OrchestratorState = 'IDLE';
  private memory: AgentMemory;
  private limits: SafetyLimits;
  private toolCallCount: number = 0;
  private startTime: number = 0;

  constructor(limits?: Partial<SafetyLimits>) {
    this.memory = getAgentMemory();
    this.limits = { ...DEFAULT_SAFETY_LIMITS, ...limits };
  }

  /**
   * Run the agent for a user message.
   * Uses native Ollama tool calling - the model decides what tools to use.
   */
  async *run(input: RunInput): AsyncGenerator<AgentEvent> {
    this.startTime = Date.now();
    this.toolCallCount = 0;

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
      yield* this.transitionTo('PLANNING');

      // Build conversation history
      const history = this.memory.getMessages(conversationId, 10);
      const messages: (LLMMessage | LLMToolMessage | LLMAssistantMessage)[] = [
        {
          role: 'system',
          content: this.getSystemPrompt(),
        },
        ...history.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      ];

      yield* this.transitionTo('EXECUTING');

      // Tool calling loop
      let iteration = 0;
      const maxIterations = this.limits.maxLoopIterations;

      while (iteration < maxIterations) {
        iteration++;

        // Check timeout
        if (Date.now() - this.startTime > this.limits.requestTimeoutMs) {
          yield { type: 'error', error: 'Request timeout', recoverable: false };
          yield* this.transitionTo('ERROR');
          yield* this.transitionTo('IDLE');
          return;
        }

        yield { type: 'thought', content: `Iteration ${iteration}: Asking model what to do...` };

        // Call model with tools
        const response = await chatWithTools({
          model: ORCHESTRATOR_MODEL,
          messages,
          tools: AGENT_TOOLS,
          think: false, // Orchestrator doesn't need deep thinking
        });

        // Add assistant message to history
        messages.push(response.message);

        // Check for tool calls
        if (response.message.tool_calls && response.message.tool_calls.length > 0) {
          yield* this.transitionTo('EXECUTING');

          // Execute each tool call
          for (const toolCall of response.message.tool_calls) {
            this.toolCallCount++;
            if (this.toolCallCount > this.limits.maxToolCalls) {
              yield { type: 'error', error: 'Max tool calls exceeded', recoverable: false };
              yield* this.transitionTo('ERROR');
              yield* this.transitionTo('IDLE');
              return;
            }

            yield { type: 'tool_start', tool: toolCall.function.name };

            try {
              const result = await this.executeTool(toolCall);
              const resultStr = typeof result === 'string' ? result : JSON.stringify(result);

              yield {
                type: 'tool_done',
                tool: toolCall.function.name,
                result,
                durationMs: Date.now() - this.startTime,
              };

              // Add tool result to messages
              messages.push({
                role: 'tool',
                tool_name: toolCall.function.name,
                content: resultStr,
              });
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : 'Tool error';
              yield { type: 'tool_error', tool: toolCall.function.name, error: errorMsg };

              messages.push({
                role: 'tool',
                tool_name: toolCall.function.name,
                content: `Error: ${errorMsg}`,
              });
            }
          }
        } else {
          // No tool calls - model is ready to respond
          yield* this.transitionTo('RESPONDING');

          const content = response.message.content || '';

          // Stream the response
          yield { type: 'response_chunk', content };

          // Save to memory
          this.memory.addMessage(conversationId, {
            role: 'assistant',
            content,
          });

          yield { type: 'done', finalResponse: content };
          yield* this.transitionTo('IDLE');
          return;
        }
      }

      // Max iterations reached
      yield { type: 'error', error: 'Max iterations reached', recoverable: false };
      yield* this.transitionTo('ERROR');
      yield* this.transitionTo('IDLE');

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      yield { type: 'error', error: errorMessage, recoverable: false };
      this.memory.logAudit(conversationId, 'error', { error: errorMessage });
      yield* this.transitionTo('ERROR');
      yield* this.transitionTo('IDLE');
    }
  }

  /**
   * Execute a tool call and return the result.
   */
  private async executeTool(toolCall: ToolCall): Promise<unknown> {
    const { name, arguments: args } = toolCall.function;

    switch (name) {
      case 'get_market_data': {
        const result = await toolRegistry.getMarketData.execute({});
        if (!result.success) throw new Error(result.error || 'Failed to get market data');
        return result.data;
      }

      case 'get_positions': {
        const result = await toolRegistry.getPositions.execute({});
        if (!result.success) throw new Error(result.error || 'Failed to get positions');
        return result.data;
      }

      case 'run_engine': {
        const result = await toolRegistry.runEngine.execute(args);
        if (!result.success) throw new Error(result.error || 'Failed to run engine');
        return result.data;
      }

      case 'think_deeply': {
        const { query, context } = args as { query: string; context?: string };
        return await thinkDeeply({ query, context });
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private getSystemPrompt(): string {
    return `You are a 0DTE SPY options trading assistant. You help users with market analysis, portfolio management, and finding trading opportunities.

You have these tools available:
- get_market_data: Get current SPY price, VIX, and market status
- get_positions: Get the user's current positions and P&L
- run_engine: Find 0DTE strangle trade opportunities
- think_deeply: Use deep analysis for complex questions

Guidelines:
- For simple greetings, respond directly without tools
- For market questions, use get_market_data
- For portfolio questions, use get_positions
- For trade requests, use run_engine
- For complex analysis or risk assessment, use think_deeply
- Be concise and helpful
- Always use real data from tools, never make up numbers`;
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
  return new AgentOrchestrator(limits);
}
```

**Step 2: Verify compilation**

Run: `npm run check`
Expected: No errors (may need to fix imports)

**Step 3: Commit**

```bash
git add server/lib/agent/orchestrator.ts
git commit -m "feat(agent): rewrite orchestrator with native tool calling loop"
```

---

## Task 6: Delete Unused Planner and Simplify Executor

**Files:**
- Modify: `server/lib/agent/executor.ts`
- Modify: `server/lib/agent/index.ts`

**Step 1: Simplify executor.ts**

The executor is no longer needed for step-by-step execution. Simplify to just export types:

```typescript
// server/lib/agent/executor.ts
// Legacy executor - kept for reference but no longer used
// The orchestrator now handles tool execution directly via Ollama tool calling

export { AgentOrchestrator, createAgentOrchestrator } from './orchestrator';
```

**Step 2: Update index.ts exports**

```typescript
// server/lib/agent/index.ts
export { AgentOrchestrator, createAgentOrchestrator } from './orchestrator';
export { getAgentMemory } from './memory';
export { AGENT_TOOLS, thinkDeeply } from './tools';
export * from './types';
```

**Step 3: Verify compilation**

Run: `npm run check`
Expected: No errors

**Step 4: Commit**

```bash
git add server/lib/agent/executor.ts server/lib/agent/index.ts
git commit -m "refactor(agent): simplify executor, orchestrator now handles tool execution"
```

---

## Task 7: Test and Deploy

**Step 1: Build the project**

Run: `npm run build`
Expected: Build succeeds

**Step 2: Test locally (if possible)**

Check that the server starts without errors.

**Step 3: Deploy to production**

```bash
npm run deploy:prod
```

**Step 4: Test in browser**

1. Go to https://apeyolo.com/agent
2. Type "hello" - should respond in <10 seconds with a greeting
3. Type "what's spy at" - should call get_market_data and report real numbers
4. Type "find me a trade" - should call run_engine
5. Type "should I trade today given current conditions?" - should call think_deeply

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(agent): deployment fixes for tool calling orchestrator"
```

---

## Verification Checklist

- [ ] qwen2.5:32b pulled on Mac
- [ ] "hello" responds in <10 seconds with no tool calls
- [ ] "what's spy" calls get_market_data and shows real data
- [ ] "show positions" calls get_positions
- [ ] "find trade" calls run_engine
- [ ] "should I trade?" calls think_deeply (uses DeepSeek-R1)
- [ ] No hallucinated data - all numbers come from tools
- [ ] Tool failures show error message, not fake data

---

## Architecture Summary

```
User Query
    ↓
┌─────────────────────────────────────────┐
│  ORCHESTRATOR (qwen2.5:32b)             │
│  - Receives query                        │
│  - Decides: respond directly OR call tools│
│  - Synthesizes final response            │
└─────────────────┬───────────────────────┘
                  │
    ┌─────────────┼─────────────┬─────────────┐
    ▼             ▼             ▼             ▼
┌────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐
│ market │  │ positions│  │  engine  │  │ think_deeply│
│  data  │  │          │  │          │  │ (DeepSeek)  │
└────────┘  └──────────┘  └──────────┘  └─────────────┘
   IBKR        IBKR        Step 4/5      DeepSeek-R1
```

The model is the brain. Tools are its hands.
