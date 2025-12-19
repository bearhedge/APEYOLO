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
import {
  calculateModificationImpact,
  generateNegotiationResponse,
  validateModification,
  type StrikeModification,
  type ModificationImpact,
} from './services/negotiationService';

/**
 * Format tool execution result into a human-readable response for the chat.
 * This replaces the raw "ACTION: toolName()" text with actual data.
 */
function formatToolResponse(tool: string, data: any): string {
  if (tool === 'getMarketData' && data) {
    const { spy, vix, market, regime } = data;
    const parts: string[] = [];

    if (spy?.price) {
      const changeStr = spy.changePercent
        ? ` (${spy.changePercent >= 0 ? '+' : ''}${spy.changePercent.toFixed(2)}%)`
        : '';
      parts.push(`SPY is at $${spy.price.toFixed(2)}${changeStr}`);
    }

    if (vix?.level) {
      const regimeStr = vix.regime ? ` (${vix.regime})` : '';
      parts.push(`VIX is at ${vix.level.toFixed(2)}${regimeStr}`);
    }

    if (market) {
      parts.push(market.isOpen ? 'Market is open' : 'Market is closed (pre-market/after-hours)');
    }

    if (regime?.reason) {
      parts.push(regime.reason);
    }

    return parts.length > 0
      ? parts.join('. ') + '.'
      : 'Market data retrieved successfully.';
  }

  if (tool === 'getPositions' && data) {
    if (Array.isArray(data) && data.length > 0) {
      return `Found ${data.length} open position(s).`;
    }
    return 'No open positions.';
  }

  // Default: return JSON for other tools
  return typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data);
}

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
 * POST /api/agent/tick
 *
 * Autonomous agent tick - called every 5 minutes by Cloud Scheduler.
 * Runs the full tick workflow: context -> analysis -> decision.
 *
 * Authorization: Bearer token from Cloud Scheduler (AGENT_SECRET env var)
 * For dev/testing: Also accepts authenticated users
 */
router.post('/tick', async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    // Verify authorization (Cloud Scheduler or authenticated user)
    const authHeader = req.headers.authorization;
    const agentSecret = process.env.AGENT_SECRET;

    // Check for Cloud Scheduler bearer token
    const isSchedulerAuth = authHeader &&
      agentSecret &&
      authHeader === `Bearer ${agentSecret}`;

    // Check for user session (for dev/testing)
    const isUserAuth = !!(req as any).user;

    if (!isSchedulerAuth && !isUserAuth) {
      console.log('[AgentRoutes] Tick unauthorized - no valid auth');
      return res.status(401).json({
        success: false,
        error: 'Unauthorized - requires Cloud Scheduler token or user session',
      });
    }

    console.log(`[AgentRoutes] Tick started (auth: ${isSchedulerAuth ? 'scheduler' : 'user'})`);

    // Import command center dynamically to avoid circular deps
    const { handleTick } = await import('./lib/command-center');

    // Run the tick workflow
    const result = await handleTick();

    console.log(`[AgentRoutes] Tick completed in ${result.durationMs}ms: ${result.decision}`);

    res.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    console.error('[AgentRoutes] Tick error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Tick failed',
      durationMs: Date.now() - startTime,
    });
  }
});

/**
 * GET /api/agent/tick/stream
 *
 * SSE endpoint for streaming tick updates to the UI.
 * Runs tick with real-time progress updates.
 */
router.get('/tick/stream', requireAuth, async (req: Request, res: Response) => {
  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const { handleTickWithStreaming } = await import('./lib/command-center');

    for await (const event of handleTickWithStreaming()) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    res.write('data: {"type":"done"}\n\n');
    res.end();
  } catch (error: any) {
    res.write(`data: ${JSON.stringify({ type: 'error', content: error.message })}\n\n`);
    res.end();
  }
});

/**
 * GET /api/agent/tick/history
 *
 * Get recent tick history for the UI.
 */
router.get('/tick/history', requireAuth, async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const { getTickHistory } = await import('./lib/command-center');
    const ticks = await getTickHistory(limit);

    res.json({
      success: true,
      ticks,
    });
  } catch (error: any) {
    console.error('[AgentRoutes] Tick history error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
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
    let fullReasoning = ''; // Accumulate reasoning from reasoning_content field
    let lastParsed = { thinking: null as string | null, response: '', isThinkingComplete: false };
    let thinkingEmitted = false;
    let inThinkingMode = false;
    let reasoningFromField = false; // Track if we're getting reasoning from separate field

    for await (const chunk of streamChatWithLLM({ messages, model, stream: true })) {
      // Handle thinking field (DeepSeek-R1 via Ollama with think: true)
      if (chunk.message?.thinking) {
        reasoningFromField = true;
        fullReasoning += chunk.message.thinking;
        // Stream each reasoning chunk as it arrives
        res.write(`data: ${JSON.stringify({
          type: 'reasoning',
          content: chunk.message.thinking,
          isComplete: false,
        })}\n\n`);
      }

      if (chunk.message?.content) {
        fullContent += chunk.message.content;

        // Parse for thinking blocks (fallback if no reasoning_content field)
        const parsed = parseThinkingFromStream(fullContent);

        // Detect when we enter thinking mode (only if not getting reasoning from field)
        if (!reasoningFromField && !inThinkingMode && fullContent.includes('<think>')) {
          inThinkingMode = true;
        }

        // Stream reasoning content while inside thinking block (only if no reasoning_content field)
        if (!reasoningFromField && inThinkingMode && !parsed.isThinkingComplete && parsed.thinking) {
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

        // Emit complete thinking when block closes (only if using <think> tags)
        if (!reasoningFromField && parsed.isThinkingComplete && parsed.thinking && !thinkingEmitted) {
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
        // If using reasoning_content field, all content is response
        // If using <think> tags, only content after thinking is response
        const responseContent = reasoningFromField ? fullContent : parsed.response;
        const lastResponseContent = reasoningFromField ? (lastParsed.response || '') : (lastParsed.response || '');

        if (responseContent) {
          const newResponse = responseContent.slice(lastResponseContent.length);
          if (newResponse) {
            res.write(`data: ${JSON.stringify({
              type: 'chunk',
              content: newResponse,
            })}\n\n`);
          }
        }

        // Update lastParsed - handle both modes
        if (reasoningFromField) {
          lastParsed = { thinking: fullReasoning, response: fullContent, isThinkingComplete: true };
        } else {
          lastParsed = parsed;
        }
      }

      if (chunk.done) {
        // Final parse - use reasoning from field if available, otherwise from <think> tags
        const finalParsed = parseThinkingFromStream(fullContent);
        const finalReasoning = reasoningFromField ? fullReasoning : finalParsed.thinking;
        // IMPORTANT: Don't fallback to fullContent - it contains <think> tags!
        // Strip any remaining <think> tags as safety net
        const rawResponse = reasoningFromField ? fullContent : finalParsed.response;
        const responseContent = rawResponse.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

        // If we got reasoning from the field, emit final complete event
        if (reasoningFromField && fullReasoning) {
          res.write(`data: ${JSON.stringify({
            type: 'reasoning',
            content: fullReasoning,
            isComplete: true,
          })}\n\n`);

          // Update status - moving from thinking to responding
          res.write(`data: ${JSON.stringify({
            type: 'status',
            phase: 'responding',
          })}\n\n`);
        }

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

          // If getMarketData tool succeeded, emit context event for UI update
          if (toolCall.tool === 'getMarketData' && toolResult.success && toolResult.data) {
            const { spy, vix, market } = toolResult.data;
            res.write(`data: ${JSON.stringify({
              type: 'context',
              context: {
                spyPrice: spy?.price || 0,
                vix: vix?.level || 0,
                marketOpen: market?.isOpen || false,
                lastUpdate: Date.now(),
              },
            })}\n\n`);
          }

          // Emit done with formatted tool result (not raw "ACTION: getMarketData()" text)
          const formattedContent = toolResult.success
            ? formatToolResponse(toolCall.tool, toolResult.data)
            : `Error: ${toolResult.error || 'Tool execution failed'}`;

          res.write(`data: ${JSON.stringify({
            type: 'done',
            fullContent: formattedContent,
            reasoning: finalReasoning,
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
            reasoning: finalReasoning,
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
 * POST /api/agent/negotiate
 *
 * Calculate the impact of a trade modification and get agent pushback.
 * Used for interactive strike adjustment in the negotiation flow.
 *
 * Body:
 * - proposalId: ID of the proposal being modified
 * - legIndex: Which leg to modify (0 for PUT in strangle, 1 for CALL)
 * - newStrike: New strike price
 */
router.post('/negotiate', requireAuth, async (req: Request, res: Response) => {
  try {
    const { proposalId, legIndex, newStrike } = req.body as {
      proposalId: string;
      legIndex: number;
      newStrike: number;
    };

    if (!proposalId || typeof legIndex !== 'number' || typeof newStrike !== 'number') {
      return res.status(400).json({
        success: false,
        error: 'proposalId, legIndex, and newStrike are required',
      });
    }

    const storedResult = pendingProposals.get(proposalId);
    if (!storedResult) {
      return res.status(404).json({
        success: false,
        error: 'Proposal not found or expired',
      });
    }

    const proposal = storedResult.proposal;
    if (!proposal) {
      return res.status(400).json({
        success: false,
        error: 'Proposal data not found',
      });
    }

    // The server-side TradeProposal has a single strike/optionType
    // legIndex 0 = the main option (PUT or CALL)
    // For strangles, we'd need to store additional data, but for now support single-leg
    if (legIndex !== 0) {
      return res.status(400).json({
        success: false,
        error: 'Currently only single-leg proposals supported for negotiation (legIndex must be 0)',
      });
    }

    const currentStrike = proposal.strike || 0;
    const optionType = proposal.optionType || 'PUT';
    const symbol = proposal.symbol || 'SPY';
    const currentPremium = (proposal.price || 0) * 100; // Convert to per-contract
    const currentDelta = 0.10; // Default delta estimate if not stored

    // Get underlying price from market data
    const { executeToolCall } = await import('./lib/agent-tools');
    const marketResult = await executeToolCall({ tool: 'getMarketData', args: {} });
    const underlyingPrice = marketResult.data?.spy?.price || 600;

    // Validate the modification
    const modification: StrikeModification = {
      proposalId,
      legIndex,
      currentStrike,
      newStrike,
      optionType: optionType as 'PUT' | 'CALL',
      symbol,
    };

    const validation = validateModification(modification, underlyingPrice);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.error,
      });
    }

    // Calculate impact
    const impact = await calculateModificationImpact(
      modification,
      currentPremium,
      currentDelta,
      underlyingPrice
    );

    // Generate enhanced response with context
    const vix = marketResult.data?.vix?.level || 20;
    const response = await generateNegotiationResponse(modification, impact, {
      vix,
      underlyingPrice,
      totalContracts: proposal.quantity || 2,
      riskProfile: 'BALANCED', // Could be pulled from user settings
    });

    // Update the proposal with new strike if agent approves or cautions
    if (impact.agentOpinion !== 'reject') {
      // Update the stored proposal's strike and price
      const newPricePerShare = impact.newPremium / 100; // Convert back to per-share

      pendingProposals.set(proposalId, {
        ...storedResult,
        proposal: {
          ...proposal,
          strike: newStrike,
          price: newPricePerShare,
        },
      });
    }

    res.json({
      success: true,
      impact: {
        ...impact,
        reasoning: response, // Use enhanced response with VIX context
      },
      currentStrike: modification.currentStrike,
      newStrike,
      legIndex,
      underlyingPrice,
    });
  } catch (error: any) {
    console.error('[AgentRoutes] Error in negotiate:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to process negotiation',
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

// ============================================
// Operator Console Endpoint
// ============================================

/**
 * POST /api/agent/operate
 *
 * Unified operation endpoint for the Operator Console.
 * Handles: analyze, propose, positions, execute, custom
 * Uses SSE for streaming responses.
 */
router.post('/operate', requireAuth, async (req: Request, res: Response) => {
  try {
    const { operation, message, proposalId } = req.body as {
      operation: 'analyze' | 'propose' | 'positions' | 'execute' | 'custom';
      message?: string;
      proposalId?: string;
    };

    if (!operation) {
      return res.status(400).json({
        success: false,
        error: 'operation is required',
      });
    }

    // FAIL FAST: Ensure IBKR is connected for all operations
    try {
      await ensureIbkrReady();
      console.log('[AgentRoutes] IBKR connection verified for operate');
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

    const sendEvent = (event: any) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      switch (operation) {
        case 'analyze': {
          sendEvent({ type: 'status', phase: 'analyzing' });

          // Call getMarketData tool
          sendEvent({ type: 'action', tool: 'getMarketData', content: 'Fetching market data...' });
          const { executeToolCall } = await import('./lib/agent-tools');
          const marketResult = await executeToolCall({ tool: 'getMarketData', args: {} });

          if (marketResult.success) {
            const { spy, vix, market, regime } = marketResult.data;
            const marketSummary = [
              spy?.price ? `SPY $${spy.price.toFixed(2)}` : null,
              vix?.level ? `VIX ${vix.level.toFixed(1)} (${vix.regime || 'N/A'})` : null,
              market?.isOpen ? 'Market Open' : 'Market Closed',
            ].filter(Boolean).join(' | ');

            sendEvent({ type: 'result', content: marketSummary });
          } else {
            sendEvent({ type: 'error', error: marketResult.error });
          }

          // Call getPositions tool
          sendEvent({ type: 'action', tool: 'getPositions', content: 'Checking positions...' });
          const posResult = await executeToolCall({ tool: 'getPositions', args: {} });

          if (posResult.success) {
            const { summary, account } = posResult.data;
            const posSummary = [
              `${summary.optionCount} option position(s)`,
              account?.portfolioValue ? `NAV $${account.portfolioValue.toLocaleString()}` : null,
              account?.dayPnL !== undefined ? `Day P&L ${account.dayPnL >= 0 ? '+' : ''}$${account.dayPnL.toFixed(0)}` : null,
            ].filter(Boolean).join(' | ');

            sendEvent({ type: 'result', content: posSummary });
          }

          sendEvent({ type: 'done' });
          break;
        }

        case 'propose': {
          sendEvent({ type: 'status', phase: 'analyzing' });

          // First get market data
          const { executeToolCall } = await import('./lib/agent-tools');
          sendEvent({ type: 'action', tool: 'getMarketData', content: 'Analyzing market conditions...' });
          const marketResult = await executeToolCall({ tool: 'getMarketData', args: {} });

          if (!marketResult.success) {
            sendEvent({ type: 'error', error: marketResult.error });
            sendEvent({ type: 'done' });
            break;
          }

          const { spy, vix, regime } = marketResult.data;
          sendEvent({ type: 'result', content: `SPY $${spy?.price?.toFixed(2)} | VIX ${vix?.level?.toFixed(1)}` });

          // Run the trading engine
          sendEvent({ type: 'status', phase: 'planning' });
          sendEvent({ type: 'action', tool: 'runEngine', content: 'Running trading engine...' });

          const engineResult = await executeToolCall({ tool: 'runEngine', args: { symbol: 'SPY' } });

          if (!engineResult.success || !engineResult.data?.canTrade) {
            const reason = engineResult.data?.reason || engineResult.error || 'No trade opportunity found';
            sendEvent({ type: 'result', content: reason });
            sendEvent({ type: 'done' });
            break;
          }

          // Engine found a trade opportunity
          const engineData = engineResult.data;
          const strikesStr = engineData.strikes
            ? `PUT $${engineData.strikes.put} / CALL $${engineData.strikes.call}`
            : 'N/A';
          sendEvent({ type: 'result', content: `Found: ${engineData.direction} at ${strikesStr}` });

          // Run dual-brain validation
          sendEvent({ type: 'status', phase: 'validating' });
          sendEvent({ type: 'action', tool: 'validate', content: 'Validating with AI critic...' });

          // Build trading context for dual-brain
          const context: TradingContext = {
            spyPrice: spy?.price || 0,
            vix: vix?.level || 0,
            positions: [],
            portfolioValue: 100000,
            buyingPower: 50000,
            dayPnL: 0,
            mandate: {
              allowedSymbols: ['SPY'],
              strategyType: 'SELL',
              minDelta: 0.05,
              maxDelta: 0.15,
              maxDailyLossPercent: 2,
              noOvernightPositions: true,
            },
          };

          const dualBrainResult = await analyzeTradeOpportunity(context);

          // Stream reasoning if available
          if (dualBrainResult.proposerResponse) {
            sendEvent({ type: 'thinking', content: dualBrainResult.proposerResponse });
          }

          // Send proposal
          if (dualBrainResult.proposal) {
            const proposal = {
              id: `prop_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
              symbol: dualBrainResult.proposal.symbol || 'SPY',
              expiration: dualBrainResult.proposal.expiry || '0DTE',
              strategy: dualBrainResult.proposal.optionType || 'PUT',
              bias: 'NEUTRAL' as const,
              legs: [{
                optionType: dualBrainResult.proposal.optionType || 'PUT',
                strike: dualBrainResult.proposal.strike || engineData.strikes?.put || 0,
                delta: 0.1,
                premium: dualBrainResult.proposal.price || engineData.strikes?.premium || 0,
              }],
              contracts: dualBrainResult.proposal.quantity || 2,
              entryPremiumTotal: (dualBrainResult.proposal.price || engineData.strikes?.premium || 0) * 100 * 2,
              maxLoss: (dualBrainResult.proposal.price || engineData.strikes?.premium || 0) * 3.5 * 100 * 2,
              stopLossPrice: (dualBrainResult.proposal.price || engineData.strikes?.premium || 0) * 3,
              reasoning: dualBrainResult.proposal.reasoning,
            };

            // Store for later execution
            pendingProposals.set(proposal.id, dualBrainResult);
            setTimeout(() => pendingProposals.delete(proposal.id), 60 * 60 * 1000);

            sendEvent({ type: 'proposal', proposal });

            // Send critique
            if (dualBrainResult.critique) {
              const critique = {
                approved: dualBrainResult.critique.approved || false,
                riskLevel: dualBrainResult.critique.riskAssessment || 'MEDIUM',
                mandateCompliant: dualBrainResult.critique.mandateCompliant || false,
                concerns: dualBrainResult.critique.concerns || [],
                suggestions: dualBrainResult.critique.suggestions || [],
              };
              sendEvent({ type: 'critique', critique });
            }
          }

          sendEvent({ type: 'done' });
          break;
        }

        case 'positions': {
          sendEvent({ type: 'status', phase: 'analyzing' });
          sendEvent({ type: 'action', tool: 'getPositions', content: 'Fetching positions...' });

          const { executeToolCall } = await import('./lib/agent-tools');
          const result = await executeToolCall({ tool: 'getPositions', args: {} });

          if (result.success) {
            const { summary, account, positions } = result.data;
            sendEvent({ type: 'result', content: `${summary.totalPositions} position(s) | NAV $${account?.portfolioValue?.toLocaleString() || 'N/A'}` });

            if (positions && positions.length > 0) {
              const posDetails = positions.map((p: any) =>
                `${p.symbol} ${p.type}: ${p.quantity} @ $${p.avgCost?.toFixed(2)} (P&L: $${p.unrealizedPnL?.toFixed(0)})`
              ).join('\n');
              sendEvent({ type: 'result', content: posDetails });
            }
          } else {
            sendEvent({ type: 'error', error: result.error });
          }

          sendEvent({ type: 'done' });
          break;
        }

        case 'execute': {
          if (!proposalId) {
            sendEvent({ type: 'error', error: 'proposalId is required for execution' });
            sendEvent({ type: 'done' });
            break;
          }

          const proposal = pendingProposals.get(proposalId);
          if (!proposal) {
            sendEvent({ type: 'error', error: 'Proposal not found or expired' });
            sendEvent({ type: 'done' });
            break;
          }

          sendEvent({ type: 'status', phase: 'executing' });
          sendEvent({ type: 'action', tool: 'executeTrade', content: 'Submitting order to IBKR...' });

          // Execute the trade
          const { executeToolCall } = await import('./lib/agent-tools');
          const result = await executeToolCall({
            tool: 'executeTrade',
            args: {
              _approved: true, // Human approved via UI
              ...proposal.proposal,
            },
          });

          if (result.success) {
            pendingProposals.delete(proposalId);
            sendEvent({
              type: 'execution',
              executionResult: {
                success: true,
                message: 'Order submitted to IBKR',
                ibkrOrderIds: result.data?.orderIds || [],
                tradeId: result.data?.tradeId,
                timestamp: new Date(),
              },
            });
          } else {
            sendEvent({
              type: 'execution',
              executionResult: {
                success: false,
                message: result.error || 'Execution failed',
                timestamp: new Date(),
              },
            });
          }

          sendEvent({ type: 'done' });
          break;
        }

        case 'custom': {
          if (!message) {
            sendEvent({ type: 'error', error: 'message is required for custom operation' });
            sendEvent({ type: 'done' });
            break;
          }

          // Fall back to regular chat stream for custom requests
          sendEvent({ type: 'status', phase: 'thinking' });

          // Use existing chat stream logic
          const systemPrompt = `You ARE APEYOLO, an autonomous 0DTE options trading agent.
Use your tools to help the user. Available tools:
- getMarketData() - Get VIX, SPY price, market status
- getPositions() - View current portfolio positions
- runEngine() - Run the 5-step trading engine
Be direct and concise. Do not use emojis.`;

          const messages: LLMMessage[] = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message },
          ];

          // Accumulate content and emit batched updates
          let fullContent = '';
          let fullThinking = '';
          let lastThinkingEmit = 0;
          let lastContentEmit = 0;
          const EMIT_INTERVAL_MS = 300; // Emit updates every 300ms for smooth streaming

          // Set up timeout protection (2 minutes)
          const OPERATION_TIMEOUT_MS = 120000;
          let timeoutReached = false;
          const timeoutId = setTimeout(() => {
            timeoutReached = true;
            sendEvent({ type: 'error', error: 'Operation timed out after 2 minutes' });
            sendEvent({ type: 'done' });
          }, OPERATION_TIMEOUT_MS);

          try {
            for await (const chunk of streamChatWithLLM({ messages, stream: true })) {
              if (timeoutReached) break;

              if (chunk.message?.thinking) {
                fullThinking += chunk.message.thinking;
                const now = Date.now();
                // Emit thinking update at intervals (accumulated, not per-chunk)
                if (now - lastThinkingEmit > EMIT_INTERVAL_MS) {
                  sendEvent({ type: 'thinking', content: fullThinking, isUpdate: true });
                  lastThinkingEmit = now;
                }
              }
              if (chunk.message?.content) {
                fullContent += chunk.message.content;
                const now = Date.now();
                // Emit content update at intervals (accumulated, not per-chunk)
                if (now - lastContentEmit > EMIT_INTERVAL_MS) {
                  sendEvent({ type: 'result', content: fullContent, isUpdate: true });
                  lastContentEmit = now;
                }
              }
            }

            clearTimeout(timeoutId);
            if (timeoutReached) break;

            // Emit final complete thinking (if any)
            if (fullThinking) {
              sendEvent({ type: 'thinking', content: fullThinking, isComplete: true });
            }

            // Check for tool call in response
            const toolCall = parseToolCall(fullContent);
            if (toolCall) {
              sendEvent({ type: 'action', tool: toolCall.tool, content: `Executing ${toolCall.tool}...` });
              const result = await executeToolCall(toolCall);
              if (result.success) {
                sendEvent({ type: 'result', content: formatToolResponse(toolCall.tool, result.data), isComplete: true });
              } else {
                sendEvent({ type: 'error', error: result.error });
              }
            } else if (fullContent) {
              // No tool call - emit final content
              sendEvent({ type: 'result', content: fullContent, isComplete: true });
            }

            sendEvent({ type: 'done' });
          } catch (streamError: any) {
            clearTimeout(timeoutId);
            console.error('[AgentRoutes] Stream error in custom operation:', streamError);
            sendEvent({ type: 'error', error: streamError.message || 'Stream failed' });
            sendEvent({ type: 'done' });
          }
          break;
        }

        default:
          sendEvent({ type: 'error', error: `Unknown operation: ${operation}` });
          sendEvent({ type: 'done' });
      }
    } catch (opError: any) {
      console.error('[AgentRoutes] Operation error:', opError);
      sendEvent({ type: 'error', error: opError.message || 'Operation failed' });
      sendEvent({ type: 'done' });
    }

    res.end();
  } catch (error: any) {
    console.error('[AgentRoutes] Error in operate:', error);

    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
      res.end();
    } else {
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to process operation',
      });
    }
  }
});

export default router;
