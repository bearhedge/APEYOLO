/**
 * LLM Client - Multi-Provider Support
 *
 * Supports:
 * - Ollama (local via Cloudflare tunnel) - for development
 * - MLX (Apple Silicon via Cloudflare tunnel) - for Kimi-Dev-72B
 * - Vertex AI (Google Cloud) - for production at scale
 *
 * Set LLM_PROVIDER=ollama, LLM_PROVIDER=mlx, or LLM_PROVIDER=vertex
 */

import { VertexAI, FunctionDeclarationSchemaType } from '@google-cloud/vertexai';

// Provider configuration
export type LLMProvider = 'ollama' | 'mlx' | 'vertex';
export const LLM_PROVIDER: LLMProvider = (process.env.LLM_PROVIDER as LLMProvider) || 'ollama';

// MLX model configuration
const MLX_MODEL = process.env.MLX_MODEL || 'mlx-community/Kimi-Dev-72B-4bit-DWQ';

// Vertex AI configuration
const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID || 'fabled-cocoa-443004-n3';
const GCP_LOCATION = process.env.GCP_LOCATION || 'asia-east1';
const VERTEX_MODEL = process.env.VERTEX_MODEL || 'gemini-2.0-flash-exp'; // Fast and cheap

// Initialize Vertex AI client (lazy)
let vertexAI: VertexAI | null = null;
function getVertexAI(): VertexAI {
  if (!vertexAI) {
    vertexAI = new VertexAI({ project: GCP_PROJECT_ID, location: GCP_LOCATION });
  }
  return vertexAI;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMChatRequest {
  messages: LLMMessage[];
  stream?: boolean;
  model?: string;
}

export interface LLMChatResponse {
  message: {
    role: 'assistant';
    content: string;
  };
  done: boolean;
  total_duration?: number;
  eval_count?: number;
}

export interface LLMStreamChunk {
  message?: {
    role: 'assistant';
    content: string;
    // DeepSeek-R1 reasoning tokens (when think: true is enabled)
    thinking?: string;
  };
  done: boolean;
}

export interface LLMStatusResponse {
  online: boolean;
  proposerModel?: string;
  criticModel?: string;
  proposerOnline?: boolean;
  criticOnline?: boolean;
  error?: string;
}

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

// Three-Brain Model Configuration
// - THINKER (DeepSeek-R1): Deep analysis, strategy, reasoning
// - PROCESSOR (Qwen 32B): Validation, critique, processing
// - EXECUTOR (Qwen 7B): Quick checks, monitoring, execution
export const PROPOSER_MODEL = process.env.LLM_PROPOSER_MODEL || 'deepseek-r1:70b';  // THINKER
export const CRITIC_MODEL = process.env.LLM_CRITIC_MODEL || 'qwen2.5:72b';          // PROCESSOR
export const EXECUTOR_MODEL = process.env.LLM_EXECUTOR_MODEL || 'qwen2.5:7b';       // EXECUTOR (fast)

// Aliases for clarity in new code
export const THINKER_MODEL = PROPOSER_MODEL;
export const PROCESSOR_MODEL = CRITIC_MODEL;

// Legacy default (for backwards compatibility)
const DEFAULT_MODEL = process.env.LLM_MODEL || PROPOSER_MODEL;

// Timeout for LLM requests (inference can be slow on local hardware)
const LLM_TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS || '300000', 10); // 5 min for 70B models (DeepSeek reasoning is slow)

// Get tunnel URL from environment
function getTunnelUrl(): string | null {
  return process.env.LLM_TUNNEL_URL || null;
}

/**
 * Check if the LLM service is online and which models are available
 */
export async function checkLLMStatus(): Promise<LLMStatusResponse> {
  const tunnelUrl = getTunnelUrl();

  if (!tunnelUrl) {
    return { online: false, error: 'LLM_TUNNEL_URL not configured' };
  }

  // MLX uses OpenAI-compatible API
  if (LLM_PROVIDER === 'mlx') {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const r = await fetch(`${tunnelUrl}/v1/models`, { method: 'GET', signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) return { online: false, error: `HTTP ${r.status}` };
      return { online: true, proposerOnline: true, criticOnline: true, proposerModel: MLX_MODEL, criticModel: MLX_MODEL };
    } catch (e: any) {
      return { online: false, error: e.name === 'AbortError' ? 'Connection timeout' : e.message };
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${tunnelUrl}/api/tags`, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return { online: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json() as { models?: Array<{ name: string }> };
    const models = data.models || [];
    const modelNames = models.map((m: { name: string }) => m.name);

    // Check for Proposer model (DeepSeek-R1)
    const proposerOnline = modelNames.some(name =>
      name.includes('deepseek-r1') || name.includes(PROPOSER_MODEL)
    );
    const proposerModel = modelNames.find(name =>
      name.includes('deepseek-r1') || name.includes(PROPOSER_MODEL)
    );

    // Check for Critic model (Qwen)
    const criticOnline = modelNames.some(name =>
      name.includes('qwen') || name.includes(CRITIC_MODEL)
    );
    const criticModel = modelNames.find(name =>
      name.includes('qwen') || name.includes(CRITIC_MODEL)
    );

    // Both models must be available for full Dual-Brain operation
    const online = proposerOnline && criticOnline;

    return {
      online,
      proposerOnline,
      criticOnline,
      proposerModel: proposerModel || PROPOSER_MODEL,
      criticModel: criticModel || CRITIC_MODEL,
      error: !online
        ? `Missing models: ${!proposerOnline ? 'Proposer' : ''} ${!criticOnline ? 'Critic' : ''}`.trim()
        : undefined,
    };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return { online: false, error: 'Connection timeout' };
    }
    return { online: false, error: error.message || 'Connection failed' };
  }
}

/**
 * Send a chat request to the LLM (non-streaming)
 * Automatically uses the configured provider.
 */
export async function chatWithLLM(request: LLMChatRequest): Promise<LLMChatResponse> {
  if (LLM_PROVIDER === 'vertex') {
    return chatWithLLMVertex(request);
  }
  if (LLM_PROVIDER === 'mlx') {
    return chatWithLLMMLX(request);
  }
  return chatWithLLMOllama(request);
}

/**
 * MLX (Kimi-Dev) implementation - OpenAI-compatible API
 */
async function chatWithLLMMLX(request: LLMChatRequest): Promise<LLMChatResponse> {
  const tunnelUrl = getTunnelUrl();
  if (!tunnelUrl) throw new Error('LLM_TUNNEL_URL not configured');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const response = await fetch(`${tunnelUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MLX_MODEL,
        messages: request.messages.map(m => ({ role: m.role, content: m.content })),
        stream: false,
        max_tokens: 4096,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    if (!response.ok) throw new Error(`MLX: ${response.status} - ${await response.text()}`);

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    return { message: { role: 'assistant', content: data.choices[0]?.message?.content || '' }, done: true };
  } catch (error: any) {
    clearTimeout(timeout);
    throw error.name === 'AbortError' ? new Error('MLX request timeout') : error;
  }
}

/**
 * Ollama implementation
 */
async function chatWithLLMOllama(request: LLMChatRequest): Promise<LLMChatResponse> {
  const tunnelUrl = getTunnelUrl();

  if (!tunnelUrl) {
    throw new Error('LLM_TUNNEL_URL not configured');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    // Only enable think mode for DeepSeek models
    const modelName = request.model || DEFAULT_MODEL;
    const isDeepSeek = modelName.toLowerCase().includes('deepseek');

    const response = await fetch(`${tunnelUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelName,
        messages: request.messages,
        stream: false,
        ...(isDeepSeek && { think: true }), // Only for DeepSeek-R1
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM request failed: ${response.status} - ${errorText}`);
    }

    return await response.json() as LLMChatResponse;
  } catch (error: any) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') {
      throw new Error('LLM request timeout');
    }
    throw error;
  }
}

/**
 * Vertex AI (Gemini) implementation
 */
async function chatWithLLMVertex(request: LLMChatRequest): Promise<LLMChatResponse> {
  const vertex = getVertexAI();
  const model = vertex.getGenerativeModel({
    model: VERTEX_MODEL,
  });

  const systemInstruction = request.messages.find(m => m.role === 'system')?.content;
  const contents = request.messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' as const : 'user' as const,
      parts: [{ text: m.content }],
    }));

  try {
    const result = await model.generateContent({
      contents,
      systemInstruction: systemInstruction || undefined,
    });

    const response = result.response;
    const content = response.candidates?.[0]?.content?.parts
      ?.filter(p => 'text' in p)
      .map(p => (p as any).text)
      .join('') || '';

    return {
      message: { role: 'assistant', content },
      done: true,
    };
  } catch (error: any) {
    console.error('[Vertex AI] Error:', error);
    throw new Error(`Vertex AI error: ${error.message}`);
  }
}

/**
 * Send a chat request to the LLM with streaming response
 * Returns an async generator that yields response chunks
 */
export async function* streamChatWithLLM(
  request: LLMChatRequest
): AsyncGenerator<LLMStreamChunk, void, unknown> {
  const tunnelUrl = getTunnelUrl();

  if (!tunnelUrl) {
    throw new Error('LLM_TUNNEL_URL not configured');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    // Only enable think mode for DeepSeek models
    const modelName = request.model || DEFAULT_MODEL;
    const isDeepSeek = modelName.toLowerCase().includes('deepseek');

    const response = await fetch(`${tunnelUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelName,
        messages: request.messages,
        stream: true,
        ...(isDeepSeek && { think: true }), // Only for DeepSeek-R1
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
            const chunk = JSON.parse(line) as LLMStreamChunk;
            yield chunk;
            if (chunk.done) return;
          } catch {
            // Skip non-JSON lines
          }
        }
      }
    }

    // Process remaining buffer
    if (buffer.trim()) {
      try {
        const chunk = JSON.parse(buffer) as LLMStreamChunk;
        yield chunk;
      } catch {
        // Skip non-JSON content
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

/**
 * Generate a simple text completion (for quick tasks)
 */
export async function generateText(prompt: string): Promise<string> {
  const response = await chatWithLLM({
    messages: [{ role: 'user', content: prompt }],
    stream: false,
  });
  return response.message.content;
}

// ============================================
// Dual-Brain Trading Agent Functions
// ============================================

/**
 * Chat with the PROPOSER model (DeepSeek-R1:70b)
 * Used for: Market analysis, trade reasoning, action proposals
 */
export async function chatWithProposer(messages: LLMMessage[]): Promise<LLMChatResponse> {
  return chatWithLLM({
    messages,
    model: PROPOSER_MODEL,
    stream: false,
  });
}

/**
 * Chat with the CRITIC model (Qwen2.5:72b)
 * Used for: Validation, risk assessment, mandate compliance checking
 */
export async function chatWithCritic(messages: LLMMessage[]): Promise<LLMChatResponse> {
  return chatWithLLM({
    messages,
    model: CRITIC_MODEL,
    stream: false,
  });
}

/**
 * Stream chat with the PROPOSER model
 */
export function streamWithProposer(messages: LLMMessage[]) {
  return streamChatWithLLM({
    messages,
    model: PROPOSER_MODEL,
    stream: true,
  });
}

/**
 * Stream chat with the CRITIC model
 */
export function streamWithCritic(messages: LLMMessage[]) {
  return streamChatWithLLM({
    messages,
    model: CRITIC_MODEL,
    stream: true,
  });
}

// ============================================
// Tool Calling Functions (Multi-Provider)
// ============================================

/**
 * Chat with LLM using native tool calling.
 * Automatically uses the configured provider (Ollama or Vertex AI).
 */
export async function chatWithTools(request: ChatWithToolsRequest): Promise<ChatWithToolsResponse> {
  if (LLM_PROVIDER === 'vertex') {
    return chatWithToolsVertex(request);
  }
  return chatWithToolsOllama(request);
}

/**
 * Ollama implementation of chatWithTools
 */
async function chatWithToolsOllama(request: ChatWithToolsRequest): Promise<ChatWithToolsResponse> {
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

/**
 * Vertex AI (Gemini) implementation of chatWithTools
 */
async function chatWithToolsVertex(request: ChatWithToolsRequest): Promise<ChatWithToolsResponse> {
  const vertex = getVertexAI();
  const model = vertex.getGenerativeModel({
    model: VERTEX_MODEL,
  });

  // Convert messages to Gemini format
  const systemInstruction = request.messages.find(m => m.role === 'system')?.content;
  const contents = request.messages
    .filter(m => m.role !== 'system')
    .map(m => {
      if (m.role === 'tool') {
        const toolMsg = m as LLMToolMessage;
        return {
          role: 'function' as const,
          parts: [{
            functionResponse: {
              name: toolMsg.tool_name,
              response: { result: toolMsg.content },
            },
          }],
        };
      }
      if (m.role === 'assistant' && (m as LLMAssistantMessage).tool_calls) {
        const assistantMsg = m as LLMAssistantMessage;
        return {
          role: 'model' as const,
          parts: assistantMsg.tool_calls!.map(tc => ({
            functionCall: {
              name: tc.function.name,
              args: tc.function.arguments,
            },
          })),
        };
      }
      return {
        role: m.role === 'assistant' ? 'model' as const : 'user' as const,
        parts: [{ text: m.content }],
      };
    });

  // Convert tools to Gemini format
  const tools = request.tools ? [{
    functionDeclarations: request.tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      parameters: {
        type: FunctionDeclarationSchemaType.OBJECT,
        properties: Object.fromEntries(
          Object.entries(t.function.parameters.properties).map(([key, val]) => [
            key,
            { type: FunctionDeclarationSchemaType.STRING, description: val.description },
          ])
        ),
        required: t.function.parameters.required || [],
      },
    })),
  }] : undefined;

  try {
    const result = await model.generateContent({
      contents,
      systemInstruction: systemInstruction || undefined,
      tools,
    });

    const response = result.response;
    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    // Check for function calls
    const functionCalls = parts.filter(p => 'functionCall' in p);
    if (functionCalls.length > 0) {
      return {
        message: {
          role: 'assistant',
          content: '',
          tool_calls: functionCalls.map(p => ({
            function: {
              name: (p as any).functionCall.name,
              arguments: (p as any).functionCall.args || {},
            },
          })),
        },
        done: true,
      };
    }

    // Text response
    const textParts = parts.filter(p => 'text' in p);
    const content = textParts.map(p => (p as any).text).join('');

    return {
      message: {
        role: 'assistant',
        content,
      },
      done: true,
    };
  } catch (error: any) {
    console.error('[Vertex AI] Error:', error);
    throw new Error(`Vertex AI error: ${error.message}`);
  }
}

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
