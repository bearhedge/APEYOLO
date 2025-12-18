/**
 * Agent API Routes
 *
 * Endpoints for AI agent communication:
 * - Chat with local LLM via Cloudflare Tunnel
 * - Status checks for LLM availability
 * - Streaming responses for real-time interaction
 * - Dual-Brain trade proposal workflow (Review & Critique pattern)
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from './auth';
import {
  checkLLMStatus,
  chatWithLLM,
  streamChatWithLLM,
  PROPOSER_MODEL,
  CRITIC_MODEL,
  type LLMMessage,
} from './lib/llm-client';
import {
  analyzeTradeOpportunity,
  quickAnalysis,
  type TradingContext,
  type DualBrainResult,
} from './lib/orchestrator';
import {
  parseToolCall,
  executeToolCall,
  getToolDefinitions,
  type ToolCall,
  type ToolResult,
} from './lib/agent-tools';
import { ensureIbkrReady } from './broker/ibkr';

// In-memory store for pending proposals (in production, use Redis or DB)
const pendingProposals = new Map<string, DualBrainResult>();

const router = Router();

/**
 * GET /api/agent/status
 *
 * Check if the LLM agent is online and available.
 * Returns model info when connected.
 */
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const status = await checkLLMStatus();
    res.json({
      success: true,
      ...status,
    });
  } catch (error: any) {
    console.error('[AgentRoutes] Error checking status:', error);
    res.json({
      success: true,
      online: false,
      error: error.message || 'Failed to check status',
    });
  }
});

/**
 * POST /api/agent/chat
 *
 * Send a chat message to the LLM and get a response.
 * Requires authentication.
 *
 * Body:
 * - messages: Array of { role: 'system'|'user'|'assistant', content: string }
 * - model?: Optional model override
 */
router.post('/chat', requireAuth, async (req: Request, res: Response) => {
  try {
    const { messages, model } = req.body as {
      messages: LLMMessage[];
      model?: string;
    };

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'messages is required and must be a non-empty array',
      });
    }

    // Validate message format
    for (const msg of messages) {
      if (!msg.role || !['system', 'user', 'assistant'].includes(msg.role)) {
        return res.status(400).json({
          success: false,
          error: 'Each message must have a valid role (system, user, or assistant)',
        });
      }
      if (typeof msg.content !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Each message must have a content string',
        });
      }
    }

    const response = await chatWithLLM({ messages, model, stream: false });

    res.json({
      success: true,
      message: response.message,
      stats: {
        totalDuration: response.total_duration,
        evalCount: response.eval_count,
      },
    });
  } catch (error: any) {
    console.error('[AgentRoutes] Error in chat:', error);

    // Handle specific errors
    if (error.message?.includes('not configured')) {
      return res.status(503).json({
        success: false,
        error: 'Agent is offline - LLM not configured',
        offline: true,
      });
    }

    if (error.message?.includes('timeout')) {
      return res.status(504).json({
        success: false,
        error: 'Agent request timed out',
      });
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Failed to process chat request',
    });
  }
});

/**
 * Parse DeepSeek-R1's <think> blocks from streaming content
 * Returns thinking content separately from response content
 */
function parseThinkingFromStream(fullContent: string): {
  thinking: string | null;
  response: string;
  isThinkingComplete: boolean;
} {
  // Check if we have a complete <think>...</think> block
  const thinkMatch = fullContent.match(/<think>([\s\S]*?)<\/think>/);

  if (thinkMatch) {
    // Complete thinking block found
    const thinking = thinkMatch[1].trim();
    const response = fullContent.replace(/<think>[\s\S]*?<\/think>/, '').trim();
    return { thinking, response, isThinkingComplete: true };
  }

  // Check if we're in the middle of a thinking block
  const openThinkMatch = fullContent.match(/<think>([\s\S]*)$/);
  if (openThinkMatch) {
    // Still inside thinking block
    return { thinking: openThinkMatch[1], response: '', isThinkingComplete: false };
  }

  // No thinking block, just regular content
  return { thinking: null, response: fullContent, isThinkingComplete: true };
}

/**
 * POST /api/agent/chat/stream
 *
 * Send a chat message and receive streaming response.
 * Uses Server-Sent Events (SSE) for real-time streaming.
 * Parses DeepSeek-R1's <think> blocks and emits them as separate 'reasoning' events.
 * Requires authentication.
 */
router.post('/chat/stream', requireAuth, async (req: Request, res: Response) => {
  try {
    const { messages, model } = req.body as {
      messages: LLMMessage[];
      model?: string;
    };

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'messages is required and must be a non-empty array',
      });
    }

    // FAIL FAST: Ensure IBKR is connected before processing any agent chat
    // This prevents the agent from operating with mock/stale data
    try {
      await ensureIbkrReady();
      console.log('[AgentRoutes] IBKR connection verified');
    } catch (ibkrError: any) {
      console.error('[AgentRoutes] IBKR connection failed:', ibkrError.message);
      return res.status(503).json({
        success: false,
        error: 'IBKR broker not connected. Please check broker configuration.',
        ibkrError: ibkrError.message,
        offline: true,
      });
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Emit status event - agent is now thinking
    res.write(`data: ${JSON.stringify({
      type: 'status',
      phase: 'thinking',
    })}\n\n`);

    // Stream response chunks with thinking detection
    let fullContent = '';
    let lastParsed = { thinking: null as string | null, response: '', isThinkingComplete: false };
    let thinkingEmitted = false;
    let inThinkingMode = false;

    for await (const chunk of streamChatWithLLM({ messages, model, stream: true })) {
      if (chunk.message?.content) {
        fullContent += chunk.message.content;

        // Parse for thinking blocks
        const parsed = parseThinkingFromStream(fullContent);

        // Detect when we enter thinking mode
        if (!inThinkingMode && fullContent.includes('<think>')) {
          inThinkingMode = true;
        }

        // Stream reasoning content while inside thinking block
        if (inThinkingMode && !parsed.isThinkingComplete && parsed.thinking) {
          // Only emit new thinking content
          const newThinking = parsed.thinking.slice(lastParsed.thinking?.length || 0);
          if (newThinking) {
            res.write(`data: ${JSON.stringify({
              type: 'reasoning',
              content: newThinking,
              isComplete: false,
            })}\n\n`);
          }
        }

        // Emit complete thinking when block closes
        if (parsed.isThinkingComplete && parsed.thinking && !thinkingEmitted) {
          res.write(`data: ${JSON.stringify({
            type: 'reasoning',
            content: parsed.thinking,
            isComplete: true,
          })}\n\n`);
          thinkingEmitted = true;
          inThinkingMode = false;

          // Update status - moving from thinking to responding
          res.write(`data: ${JSON.stringify({
            type: 'status',
            phase: 'responding',
          })}\n\n`);
        }

        // Stream response content (non-thinking)
        if (parsed.isThinkingComplete && parsed.response) {
          const newResponse = parsed.response.slice(lastParsed.response?.length || 0);
          if (newResponse) {
            res.write(`data: ${JSON.stringify({
              type: 'chunk',
              content: newResponse,
            })}\n\n`);
          }
        }

        lastParsed = parsed;
      }

      if (chunk.done) {
        // Final parse
        const finalParsed = parseThinkingFromStream(fullContent);
        const responseContent = finalParsed.response || fullContent;

        // Check for tool call in response
        const toolCall = parseToolCall(responseContent);

        if (toolCall) {
          // Emit action start event
          res.write(`data: ${JSON.stringify({
            type: 'status',
            phase: 'executing',
          })}\n\n`);

          res.write(`data: ${JSON.stringify({
            type: 'action',
            tool: toolCall.tool,
            args: toolCall.args,
            status: 'running',
          })}\n\n`);

          // Execute the tool
          const toolResult = await executeToolCall(toolCall);

          // Emit action complete event
          res.write(`data: ${JSON.stringify({
            type: 'action',
            tool: toolCall.tool,
            args: toolCall.args,
            status: toolResult.success ? 'done' : 'error',
            result: toolResult.data,
            error: toolResult.error,
          })}\n\n`);

          // Emit done with tool result context
          res.write(`data: ${JSON.stringify({
            type: 'done',
            fullContent: responseContent,
            reasoning: finalParsed.thinking,
            toolCall: {
              tool: toolCall.tool,
              result: toolResult,
            },
          })}\n\n`);
        } else {
          // No tool call - normal done
          res.write(`data: ${JSON.stringify({
            type: 'done',
            fullContent: responseContent,
            reasoning: finalParsed.thinking,
          })}\n\n`);
        }

        // Update status - idle
        res.write(`data: ${JSON.stringify({
          type: 'status',
          phase: 'idle',
        })}\n\n`);
      }
    }

    res.end();
  } catch (error: any) {
    console.error('[AgentRoutes] Error in stream chat:', error);

    // If headers already sent, send error via SSE
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({
        type: 'error',
        error: error.message || 'Stream error',
      })}\n\n`);
      res.write(`data: ${JSON.stringify({
        type: 'status',
        phase: 'error',
      })}\n\n`);
      res.end();
    } else {
      // Handle specific errors before stream starts
      if (error.message?.includes('not configured')) {
        return res.status(503).json({
          success: false,
          error: 'Agent is offline - LLM not configured',
          offline: true,
        });
      }

      res.status(500).json({
        success: false,
        error: error.message || 'Failed to process stream request',
      });
    }
  }
});

// ============================================
// Dual-Brain Trading Agent Endpoints
// ============================================

/**
 * POST /api/agent/propose
 *
 * Execute the full Dual-Brain trade analysis workflow.
 * 1. Proposer analyzes and suggests a trade
 * 2. Critic validates the proposal
 * 3. Returns result with consensus status
 *
 * Body:
 * - context: TradingContext object with market data, positions, mandate
 * - request?: Optional user request/question
 */
router.post('/propose', requireAuth, async (req: Request, res: Response) => {
  try {
    const { context, request } = req.body as {
      context: TradingContext;
      request?: string;
    };

    if (!context) {
      return res.status(400).json({
        success: false,
        error: 'Trading context is required',
      });
    }

    // Validate required context fields
    if (typeof context.spyPrice !== 'number' || !context.mandate) {
      return res.status(400).json({
        success: false,
        error: 'Invalid context: spyPrice and mandate are required',
      });
    }

    console.log('[AgentRoutes] Starting Dual-Brain analysis...');
    const result = await analyzeTradeOpportunity(context, request);

    // Store proposal if awaiting approval
    if (result.awaitingHumanApproval && result.proposal) {
      const proposalId = `prop_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      pendingProposals.set(proposalId, result);

      // Clean up old proposals after 1 hour
      setTimeout(() => pendingProposals.delete(proposalId), 60 * 60 * 1000);

      return res.json({
        success: true,
        proposalId,
        ...result,
      });
    }

    res.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error('[AgentRoutes] Error in propose:', error);

    if (error.message?.includes('not configured')) {
      return res.status(503).json({
        success: false,
        error: 'Agent is offline - LLM not configured',
        offline: true,
      });
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Failed to process trade proposal',
    });
  }
});

/**
 * POST /api/agent/approve/:proposalId
 *
 * Human approves a trade proposal.
 * This triggers actual trade execution via IBKR.
 */
router.post('/approve/:proposalId', requireAuth, async (req: Request, res: Response) => {
  try {
    const { proposalId } = req.params;

    const proposal = pendingProposals.get(proposalId);
    if (!proposal) {
      return res.status(404).json({
        success: false,
        error: 'Proposal not found or expired',
      });
    }

    // Remove from pending
    pendingProposals.delete(proposalId);

    // TODO: Execute trade via IBKR
    // For now, just log and return success
    console.log('[AgentRoutes] Trade approved:', proposal.proposal);

    res.json({
      success: true,
      message: 'Trade approved',
      proposal: proposal.proposal,
      // executionResult: await executeTrade(proposal.proposal)
    });
  } catch (error: any) {
    console.error('[AgentRoutes] Error in approve:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to approve trade',
    });
  }
});

/**
 * POST /api/agent/reject/:proposalId
 *
 * Human rejects a trade proposal with optional feedback.
 * This logs the rejection for learning purposes.
 */
router.post('/reject/:proposalId', requireAuth, async (req: Request, res: Response) => {
  try {
    const { proposalId } = req.params;
    const { reason } = req.body as { reason?: string };

    const proposal = pendingProposals.get(proposalId);
    if (!proposal) {
      return res.status(404).json({
        success: false,
        error: 'Proposal not found or expired',
      });
    }

    // Remove from pending
    pendingProposals.delete(proposalId);

    // Log rejection for future learning
    console.log('[AgentRoutes] Trade rejected:', {
      proposal: proposal.proposal,
      reason: reason || 'No reason provided',
    });

    res.json({
      success: true,
      message: 'Trade rejected',
      reason: reason || 'No reason provided',
    });
  } catch (error: any) {
    console.error('[AgentRoutes] Error in reject:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to reject trade',
    });
  }
});

/**
 * GET /api/agent/pending
 *
 * Get all pending trade proposals awaiting approval.
 */
router.get('/pending', requireAuth, async (_req: Request, res: Response) => {
  try {
    const pending = Array.from(pendingProposals.entries()).map(([id, result]) => ({
      proposalId: id,
      proposal: result.proposal,
      critique: result.critique,
      timestamp: result.timestamp,
    }));

    res.json({
      success: true,
      pending,
      count: pending.length,
    });
  } catch (error: any) {
    console.error('[AgentRoutes] Error getting pending:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get pending proposals',
    });
  }
});

/**
 * POST /api/agent/quick
 *
 * Quick analysis for simple questions (no full dual-brain workflow).
 * Uses only the Proposer model for fast responses.
 */
router.post('/quick', requireAuth, async (req: Request, res: Response) => {
  try {
    const { context, question } = req.body as {
      context: TradingContext;
      question: string;
    };

    if (!context || !question) {
      return res.status(400).json({
        success: false,
        error: 'Both context and question are required',
      });
    }

    const result = await quickAnalysis(context, question);

    res.json({
      success: true,
      response: result.response,
      durationMs: result.durationMs,
    });
  } catch (error: any) {
    console.error('[AgentRoutes] Error in quick analysis:', error);

    if (error.message?.includes('not configured')) {
      return res.status(503).json({
        success: false,
        error: 'Agent is offline - LLM not configured',
        offline: true,
      });
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Failed to process quick analysis',
    });
  }
});

export default router;
