/**
 * LLM Client for Cloudflare Tunnel to local Ollama
 *
 * Dual-Brain Trading Agent Architecture:
 * - PROPOSER (DeepSeek-R1:70b): Analyzes market, reasons about trades, proposes actions
 * - CRITIC (Qwen2.5:72b): Validates proposals, checks mandate compliance, assesses risk
 *
 * Both models must agree before a trade can be executed (Review & Critique pattern).
 */

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

// Dual-Brain Model Configuration
export const PROPOSER_MODEL = process.env.LLM_PROPOSER_MODEL || 'deepseek-r1:70b';
export const CRITIC_MODEL = process.env.LLM_CRITIC_MODEL || 'qwen2.5:72b';

// Legacy default (for backwards compatibility)
const DEFAULT_MODEL = process.env.LLM_MODEL || PROPOSER_MODEL;

// Timeout for LLM requests (inference can be slow on local hardware)
const LLM_TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS || '120000', 10); // 2 min for 70B models

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
 */
export async function chatWithLLM(request: LLMChatRequest): Promise<LLMChatResponse> {
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
        model: request.model || DEFAULT_MODEL,
        messages: request.messages,
        stream: false,
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
    const response = await fetch(`${tunnelUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.model || DEFAULT_MODEL,
        messages: request.messages,
        stream: true,
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
