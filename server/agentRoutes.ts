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

// ============================================
// Query Planner - Manus-style task breakdown
// ============================================

type QueryType = 'PRICE' | 'MARKET' | 'POSITION' | 'TRADE' | 'COMPLEX';

interface PlanStep {
  id: number;
  description: string;
  tool?: string;
  args?: Record<string, any>;
  status: 'pending' | 'running' | 'complete' | 'error';
}

interface QueryPlan {
  type: QueryType;
  steps: PlanStep[];
}

// Session context for follow-up query detection
// Maps session ID to last query type (simple in-memory cache)
const sessionQueryContext = new Map<string, { type: QueryType; timestamp: number }>();
const SESSION_CONTEXT_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Check if text is a follow-up query (e.g., "and now?", "again?", "refresh")
 */
function isFollowUpQuery(text: string): boolean {
  const lower = text.toLowerCase().trim();
  // Very short queries or common follow-up patterns
  const followUpPatterns = [
    /^and now\??$/,
    /^now\??$/,
    /^again\??$/,
    /^refresh$/,
    /^update$/,
    /^what about now\??$/,
    /^how about now\??$/,
    /^check again$/,
    /^same$/,
  ];
  return followUpPatterns.some(pattern => pattern.test(lower)) || lower.length < 10;
}

/**
 * Get last query type for a session
 */
function getSessionContext(sessionId: string): QueryType | null {
  const ctx = sessionQueryContext.get(sessionId);
  if (!ctx) return null;
  // Check if context is still valid
  if (Date.now() - ctx.timestamp > SESSION_CONTEXT_TTL) {
    sessionQueryContext.delete(sessionId);
    return null;
  }
  return ctx.type;
}

/**
 * Store query type for a session
 */
function setSessionContext(sessionId: string, type: QueryType): void {
  sessionQueryContext.set(sessionId, { type, timestamp: Date.now() });
  // Cleanup old entries periodically
  if (sessionQueryContext.size > 100) {
    const now = Date.now();
    for (const [key, value] of sessionQueryContext.entries()) {
      if (now - value.timestamp > SESSION_CONTEXT_TTL) {
        sessionQueryContext.delete(key);
      }
    }
  }
}

/**
 * Classify user query into a type for deterministic planning.
 * This enables smart, query-aware data retrieval without over-fetching.
 *
 * @param text - The user's query text
 * @param sessionId - Optional session ID for context-aware follow-up detection
 */
function classifyQuery(text: string, sessionId?: string): QueryType {
  const lower = text.toLowerCase();

  // Check for follow-up queries first
  if (sessionId && isFollowUpQuery(text)) {
    const lastType = getSessionContext(sessionId);
    if (lastType) {
      console.log(`[QueryPlanner] Follow-up detected, using last query type: ${lastType}`);
      return lastType;
    }
    // No context - default to PRICE for short queries like "and now?"
    console.log(`[QueryPlanner] Follow-up detected but no context, defaulting to PRICE`);
    return 'PRICE';
  }

  // PRICE - Just wants a quote
  if (/\b(spy|price|quote|trading at|what.*(spy|price))\b/.test(lower)
      && !/\b(vix|market|regime|trade|should|find)\b/.test(lower)) {
    return 'PRICE';
  }

  // MARKET - Wants market context/conditions
  if (/\b(market|regime|vix|conditions|should.*(trade|enter)|how.*(look|market))\b/.test(lower)) {
    return 'MARKET';
  }

  // POSITION - Wants portfolio info
  if (/\b(position|p&l|pnl|portfolio|holding|nav|account)\b/.test(lower)) {
    return 'POSITION';
  }

  // TRADE - Wants trade opportunity
  if (/\b(trade|propose|find|entry|opportunity|setup|engine)\b/.test(lower)) {
    return 'TRADE';
  }

  // COMPLEX - Let LLM figure it out
  return 'COMPLEX';
}

/**
 * Generate a task plan based on query type.
 * Returns numbered steps that will be displayed in the UI.
 */
function generatePlan(queryType: QueryType): QueryPlan {
  switch (queryType) {
    case 'PRICE':
      return {
        type: 'PRICE',
        steps: [
          { id: 1, description: 'Fetch SPY quote from IBKR', tool: 'getMarketData', status: 'pending' },
        ],
      };

    case 'MARKET':
      return {
        type: 'MARKET',
        steps: [
          { id: 1, description: 'Fetch SPY price', tool: 'getMarketData', status: 'pending' },
          { id: 2, description: 'Fetch VIX level', tool: 'getMarketData', status: 'pending' },
          { id: 3, description: 'Analyze market regime', status: 'pending' },
        ],
      };

    case 'POSITION':
      return {
        type: 'POSITION',
        steps: [
          { id: 1, description: 'Fetch portfolio positions', tool: 'getPositions', status: 'pending' },
          { id: 2, description: 'Calculate P&L', status: 'pending' },
        ],
      };

    case 'TRADE':
      return {
        type: 'TRADE',
        steps: [
          { id: 1, description: 'Fetch market data', tool: 'getMarketData', status: 'pending' },
          { id: 2, description: 'Check current positions', tool: 'getPositions', status: 'pending' },
          { id: 3, description: 'Run trading engine', tool: 'runEngine', status: 'pending' },
          { id: 4, description: 'Generate proposal', status: 'pending' },
        ],
      };

    case 'COMPLEX':
    default:
      return {
        type: 'COMPLEX',
        steps: [
          { id: 1, description: 'Analyze request', status: 'pending' },
          { id: 2, description: 'Execute query', status: 'pending' },
        ],
      };
  }
}

/**
 * Execute a query plan and stream results.
 * Emits plan, step, and data events for Manus-style UI.
 */
async function executePlanWithStreaming(
  plan: QueryPlan,
  res: Response,
  sendEvent: (event: any) => void
): Promise<{ data: Record<string, any>; response: string }> {
  const workspaceData: Record<string, any> = {};
  let finalResponse = '';

  // Emit the plan
  sendEvent({
    type: 'plan',
    steps: plan.steps.map(s => ({ id: s.id, description: s.description, status: s.status })),
  });

  // Execute each step
  for (const step of plan.steps) {
    // Mark step as running
    sendEvent({ type: 'step', stepId: step.id, status: 'running' });

    try {
      if (step.tool) {
        // Execute the tool
        const result = await executeToolCall({ tool: step.tool, args: step.args || {} });

        if (result.success && result.data) {
          // Emit workspace data based on tool
          if (step.tool === 'getMarketData') {
            const { spy, vix, market, regime } = result.data;
            if (spy?.price) {
              workspaceData['SPY'] = `$${spy.price.toFixed(2)}`;
              sendEvent({ type: 'data', key: 'SPY', value: `$${spy.price.toFixed(2)}` });
            }
            if (spy?.changePercent !== undefined) {
              const changeStr = `${spy.changePercent >= 0 ? '+' : ''}${spy.changePercent.toFixed(2)}%`;
              workspaceData['Change'] = changeStr;
              sendEvent({ type: 'data', key: 'Change', value: changeStr });
            }
            if (vix?.level) {
              workspaceData['VIX'] = `${vix.level.toFixed(2)} (${vix.regime || 'N/A'})`;
              sendEvent({ type: 'data', key: 'VIX', value: `${vix.level.toFixed(2)} (${vix.regime || 'N/A'})` });
            }
            if (market) {
              workspaceData['Market'] = market.isOpen ? 'OPEN' : 'CLOSED';
              sendEvent({ type: 'data', key: 'Market', value: market.isOpen ? 'OPEN' : 'CLOSED' });
            }
            if (regime) {
              workspaceData['Regime'] = regime.shouldTrade ? 'FAVORABLE' : 'UNFAVORABLE';
              sendEvent({ type: 'data', key: 'Regime', value: regime.shouldTrade ? 'FAVORABLE' : 'UNFAVORABLE' });
            }
          } else if (step.tool === 'getPositions') {
            const { summary, account, positions } = result.data;
            workspaceData['Positions'] = `${summary?.totalPositions || 0} open`;
            sendEvent({ type: 'data', key: 'Positions', value: `${summary?.totalPositions || 0} open` });
            if (account?.portfolioValue) {
              workspaceData['NAV'] = `$${account.portfolioValue.toLocaleString()}`;
              sendEvent({ type: 'data', key: 'NAV', value: `$${account.portfolioValue.toLocaleString()}` });
            }
            if (account?.dayPnL !== undefined) {
              const pnlStr = `${account.dayPnL >= 0 ? '+' : ''}$${account.dayPnL.toFixed(0)}`;
              workspaceData['Day P&L'] = pnlStr;
              sendEvent({ type: 'data', key: 'Day P&L', value: pnlStr });
            }
          } else if (step.tool === 'runEngine') {
            if (result.data.canTrade) {
              workspaceData['Trade'] = result.data.direction || 'AVAILABLE';
              sendEvent({ type: 'data', key: 'Trade', value: result.data.direction || 'AVAILABLE' });
              if (result.data.strikes) {
                const strikesStr = `PUT $${result.data.strikes.put || 'N/A'} / CALL $${result.data.strikes.call || 'N/A'}`;
                workspaceData['Strikes'] = strikesStr;
                sendEvent({ type: 'data', key: 'Strikes', value: strikesStr });
              }
            } else {
              workspaceData['Trade'] = 'NO OPPORTUNITY';
              sendEvent({ type: 'data', key: 'Trade', value: 'NO OPPORTUNITY' });
            }
          }
        }
      }

      // Mark step complete
      sendEvent({ type: 'step', stepId: step.id, status: 'complete' });
    } catch (error: any) {
      sendEvent({ type: 'step', stepId: step.id, status: 'error' });
      console.error(`[QueryPlanner] Step ${step.id} failed:`, error.message);
    }
  }

  // Generate final response from workspace data
  const parts: string[] = [];
  if (workspaceData['SPY']) parts.push(`SPY: ${workspaceData['SPY']}${workspaceData['Change'] ? ` (${workspaceData['Change']})` : ''}`);
  if (workspaceData['VIX']) parts.push(`VIX: ${workspaceData['VIX']}`);
  if (workspaceData['Market']) parts.push(`Market: ${workspaceData['Market']}`);
  if (workspaceData['Regime']) parts.push(`Regime: ${workspaceData['Regime']}`);
  if (workspaceData['NAV']) parts.push(`NAV: ${workspaceData['NAV']}`);
  if (workspaceData['Day P&L']) parts.push(`Day P&L: ${workspaceData['Day P&L']}`);
  if (workspaceData['Positions']) parts.push(`Positions: ${workspaceData['Positions']}`);
  if (workspaceData['Trade']) parts.push(`Trade: ${workspaceData['Trade']}`);
  if (workspaceData['Strikes']) parts.push(`Strikes: ${workspaceData['Strikes']}`);

  finalResponse = parts.join(' | ') + '\n[Source: IBKR real-time data]';

  return { data: workspaceData, response: finalResponse };
}

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
      parts.push(`SPY: $${spy.price.toFixed(2)}${changeStr}`);
    }

    if (vix?.level) {
      const regimeStr = vix.regime ? ` (${vix.regime})` : '';
      parts.push(`VIX: ${vix.level.toFixed(2)}${regimeStr}`);
    }

    if (market) {
      parts.push(market.isOpen ? 'Market: OPEN' : 'Market: CLOSED');
    }

    if (regime?.reason) {
      parts.push(regime.reason);
    }

    // Add source attribution
    const result = parts.length > 0 ? parts.join(' | ') : 'Market data retrieved';
    return `${result}\n[Source: IBKR real-time data]`;
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
 * GET /api/agent/market
 *
 * Get real-time market data from IBKR (SPY, VIX, positions, account).
 * This is the primary data source for the Agent UI panel.
 */
router.get('/market', requireAuth, async (_req: Request, res: Response) => {
  try {
    // Use the agent tool to get IBKR market data
    const marketResult = await executeToolCall({ tool: 'getMarketData', args: {} });

    if (!marketResult.success) {
      return res.status(503).json({
        success: false,
        error: marketResult.error || 'Failed to fetch IBKR market data',
      });
    }

    const { spy, vix, market, regime } = marketResult.data;

    res.json({
      success: true,
      spy: spy ? {
        price: spy.price,
        change: spy.change,
        changePercent: spy.changePercent,
      } : null,
      vix: vix ? {
        current: vix.level,
        regime: vix.regime,
      } : null,
      market: {
        isOpen: market?.isOpen ?? false,
        canTrade: market?.canTrade ?? false,
        currentTime: market?.currentTime,
      },
      regime: regime,
      source: 'ibkr',
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[AgentRoutes] Market data error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to fetch market data',
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

    // Helper to send SSE events
    const sendEvent = (event: any) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // Get the user's message for query classification
    const lastUserMessage = messages.filter(m => m.role === 'user').pop()?.content || '';

    // Classify the query and generate a plan
    const queryType = classifyQuery(lastUserMessage);
    console.log(`[AgentRoutes] Query classified as: ${queryType}`);

    // For non-COMPLEX queries, use deterministic plan-based execution
    // This is faster, more reliable, and provides better UI feedback
    if (queryType !== 'COMPLEX') {
      const plan = generatePlan(queryType);
      console.log(`[AgentRoutes] Executing plan with ${plan.steps.length} steps`);

      sendEvent({ type: 'status', phase: 'executing' });

      try {
        const { data, response } = await executePlanWithStreaming(plan, res, sendEvent);

        // Emit context update for UI
        if (data['SPY'] || data['VIX']) {
          sendEvent({
            type: 'context',
            context: {
              spyPrice: parseFloat(data['SPY']?.replace('$', '') || '0'),
              vix: parseFloat(data['VIX']?.split(' ')[0] || '0'),
              marketOpen: data['Market'] === 'OPEN',
              lastUpdate: Date.now(),
            },
          });
        }

        // Emit done with the response
        sendEvent({
          type: 'done',
          fullContent: response,
        });

        sendEvent({ type: 'status', phase: 'idle' });
        res.end();
        return;
      } catch (planError: any) {
        console.error('[AgentRoutes] Plan execution failed:', planError.message);
        // Fall through to LLM-based execution
      }
    }

    // For COMPLEX queries or plan failures, use LLM-based execution
    // Emit status event - agent is now thinking
    sendEvent({
      type: 'status',
      phase: 'thinking',
    });

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

        // If we had reasoning, update status to responding (reasoning already streamed)
        if (reasoningFromField && fullReasoning) {
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
          // No tool call detected - check if we should auto-execute based on user intent
          // This is a fallback for when the LLM doesn't output the ACTION: format
          const lastUserMessage = messages.filter(m => m.role === 'user').pop()?.content || '';
          const lowerMessage = lastUserMessage.toLowerCase();

          const needsMarketData = /\b(spy|vix|price|market|what.*(is|at)|trading at|quote)\b/i.test(lowerMessage);
          const needsPositions = /\b(position|portfolio|holding|pnl|p&l)\b/i.test(lowerMessage);

          if (needsMarketData) {
            // User asked about market data but LLM didn't call tool - auto-execute
            console.log('[AgentRoutes] Auto-detecting market data request, executing getMarketData');

            res.write(`data: ${JSON.stringify({
              type: 'status',
              phase: 'executing',
            })}\n\n`);

            res.write(`data: ${JSON.stringify({
              type: 'action',
              tool: 'getMarketData',
              args: {},
              status: 'running',
            })}\n\n`);

            const marketResult = await executeToolCall({ tool: 'getMarketData', args: {} });

            res.write(`data: ${JSON.stringify({
              type: 'action',
              tool: 'getMarketData',
              args: {},
              status: marketResult.success ? 'done' : 'error',
              result: marketResult.data,
              error: marketResult.error,
            })}\n\n`);

            if (marketResult.success && marketResult.data) {
              const { spy, vix, market } = marketResult.data;
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

            const formattedContent = marketResult.success
              ? formatToolResponse('getMarketData', marketResult.data)
              : `Error: ${marketResult.error || 'Failed to get market data'}`;

            res.write(`data: ${JSON.stringify({
              type: 'done',
              fullContent: formattedContent,
              reasoning: finalReasoning,
              toolCall: { tool: 'getMarketData', result: marketResult },
            })}\n\n`);
          } else if (needsPositions) {
            // User asked about positions but LLM didn't call tool - auto-execute
            console.log('[AgentRoutes] Auto-detecting positions request, executing getPositions');

            res.write(`data: ${JSON.stringify({
              type: 'status',
              phase: 'executing',
            })}\n\n`);

            res.write(`data: ${JSON.stringify({
              type: 'action',
              tool: 'getPositions',
              args: {},
              status: 'running',
            })}\n\n`);

            const posResult = await executeToolCall({ tool: 'getPositions', args: {} });

            res.write(`data: ${JSON.stringify({
              type: 'action',
              tool: 'getPositions',
              args: {},
              status: posResult.success ? 'done' : 'error',
              result: posResult.data,
              error: posResult.error,
            })}\n\n`);

            const formattedContent = posResult.success
              ? formatToolResponse('getPositions', posResult.data)
              : `Error: ${posResult.error || 'Failed to get positions'}`;

            res.write(`data: ${JSON.stringify({
              type: 'done',
              fullContent: formattedContent,
              reasoning: finalReasoning,
              toolCall: { tool: 'getPositions', result: posResult },
            })}\n\n`);
          } else {
            // Normal response - no tool needed
            res.write(`data: ${JSON.stringify({
              type: 'done',
              fullContent: responseContent,
              reasoning: finalReasoning,
            })}\n\n`);
          }
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
          const strikes = engineData.strikes;

          // Format detailed strike info
          let strikesStr = '';
          if (strikes) {
            const parts: string[] = [];
            if (strikes.put) {
              const putDelta = strikes.putDelta ? ` (Δ${strikes.putDelta.toFixed(2)})` : '';
              const putPrice = strikes.putBid ? ` @ $${strikes.putBid.toFixed(2)}` : '';
              parts.push(`PUT $${strikes.put}${putDelta}${putPrice}`);
            }
            if (strikes.call) {
              const callDelta = strikes.callDelta ? ` (Δ${strikes.callDelta.toFixed(2)})` : '';
              const callPrice = strikes.callBid ? ` @ $${strikes.callBid.toFixed(2)}` : '';
              parts.push(`CALL $${strikes.call}${callDelta}${callPrice}`);
            }
            strikesStr = parts.join(' / ');
            if (strikes.premium) {
              strikesStr += ` | Premium: $${strikes.premium.toFixed(2)}`;
            }
          }

          sendEvent({
            type: 'result',
            content: `Found: ${engineData.direction || 'STRANGLE'}\n${strikesStr}`,
          });

          // Run dual-brain validation with timeout
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

          // Timeout wrapper for dual-brain validation (30 second max)
          const VALIDATION_TIMEOUT_MS = 30000;
          let dualBrainResult: DualBrainResult | null = null;

          try {
            const timeoutPromise = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Validation timeout')), VALIDATION_TIMEOUT_MS)
            );
            dualBrainResult = await Promise.race([
              analyzeTradeOpportunity(context),
              timeoutPromise,
            ]);
          } catch (error: any) {
            console.warn('[AgentRoutes] Dual-brain validation failed/timed out:', error.message);
            sendEvent({ type: 'result', content: `Skipping AI validation (${error.message})` });
          }

          // Build proposal from engine data (primary) or dual-brain (fallback enhancement)
          const proposalId = `prop_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

          // Build legs from engine strikes
          const legs: Array<{ optionType: string; strike: number; delta: number; premium: number; bid?: number; ask?: number }> = [];
          if (strikes?.put) {
            legs.push({
              optionType: 'PUT',
              strike: strikes.put,
              delta: strikes.putDelta || 0.1,
              premium: strikes.putBid || 0,
              bid: strikes.putBid,
              ask: strikes.putAsk,
            });
          }
          if (strikes?.call) {
            legs.push({
              optionType: 'CALL',
              strike: strikes.call,
              delta: strikes.callDelta || 0.1,
              premium: strikes.callBid || 0,
              bid: strikes.callBid,
              ask: strikes.callAsk,
            });
          }

          const totalPremium = strikes?.premium || legs.reduce((sum, leg) => sum + (leg.premium || 0), 0) * 100;

          const proposal = {
            id: proposalId,
            symbol: 'SPY',
            expiration: '0DTE',
            strategy: engineData.direction || 'STRANGLE',
            bias: 'NEUTRAL' as const,
            legs,
            contracts: engineData.positionSize?.contracts || 2,
            entryPremiumTotal: totalPremium,
            maxLoss: totalPremium * 3.5,
            stopLossPrice: (legs[0]?.premium || 0) * 3,
            reasoning: dualBrainResult?.proposal?.reasoning || strikes?.reasoning || 'Engine-selected based on delta and liquidity',
          };

          // Store for later execution
          pendingProposals.set(proposalId, dualBrainResult || { success: true } as any);
          setTimeout(() => pendingProposals.delete(proposalId), 60 * 60 * 1000);

          sendEvent({ type: 'proposal', proposal });

          // Send critique if available
          if (dualBrainResult?.critique) {
            const critique = {
              approved: dualBrainResult.critique.approved || false,
              riskLevel: dualBrainResult.critique.riskAssessment || 'MEDIUM',
              mandateCompliant: dualBrainResult.critique.mandateCompliant || false,
              concerns: dualBrainResult.critique.concerns || [],
              suggestions: dualBrainResult.critique.suggestions || [],
            };
            sendEvent({ type: 'critique', critique });
          } else {
            // No AI critique available - show basic assessment
            sendEvent({
              type: 'critique',
              critique: {
                approved: true,
                riskLevel: 'MEDIUM',
                mandateCompliant: true,
                concerns: [],
                suggestions: ['AI validation was skipped - review manually before executing'],
              },
            });
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

          // Use query planner for simple queries - bypass LLM entirely
          // Pass user ID as session context for follow-up query detection
          const sessionId = (req as any).user?.id || 'anonymous';
          const queryType = classifyQuery(message, sessionId);
          console.log(`[AgentRoutes] Custom query classified as: ${queryType}`);

          // Store this query type for follow-up detection
          if (queryType !== 'COMPLEX') {
            setSessionContext(sessionId, queryType);
          }

          if (queryType !== 'COMPLEX') {
            // Deterministic execution - no LLM needed
            const plan = generatePlan(queryType);
            console.log(`[AgentRoutes] Executing plan with ${plan.steps.length} steps`);

            try {
              const { data, response } = await executePlanWithStreaming(plan, res, sendEvent);

              // Emit context update for UI
              if (data['SPY'] || data['VIX']) {
                sendEvent({
                  type: 'context',
                  context: {
                    spyPrice: parseFloat(data['SPY']?.replace('$', '') || '0'),
                    vix: parseFloat(data['VIX']?.split(' ')[0] || '0'),
                    marketOpen: data['Market'] === 'OPEN',
                    lastUpdate: Date.now(),
                  },
                });
              }

              // Emit final result
              sendEvent({ type: 'result', content: response });
              sendEvent({ type: 'done' });
              break;
            } catch (planError: any) {
              console.error('[AgentRoutes] Plan execution failed, falling back to LLM:', planError.message);
              // Fall through to LLM-based execution
            }
          }

          // COMPLEX queries or plan failures - use LLM
          sendEvent({ type: 'status', phase: 'thinking' });

          // Use existing chat stream logic
          const systemPrompt = `You ARE APEYOLO, an autonomous 0DTE options trading agent.

CRITICAL: To use a tool, you MUST output EXACTLY this format on its own line:
ACTION: toolName()

Available tools:
- ACTION: getMarketData() - Get VIX, SPY price, market status
- ACTION: getPositions() - View current portfolio positions
- ACTION: runEngine() - Run the 5-step trading engine

ALWAYS use tools for real data. NEVER make up prices or numbers.
When user asks about SPY price, VIX, or market data → output: ACTION: getMarketData()
When user asks about positions or portfolio → output: ACTION: getPositions()

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
            } else {
              // LLM didn't call a tool - auto-detect if we should call one
              // This prevents hallucinated data when user asks about prices
              const lowerMessage = message.toLowerCase();
              const needsMarketData = /\b(spy|vix|price|market|trading at|what.*(is|s).*at)\b/i.test(lowerMessage);
              const needsPositions = /\b(position|portfolio|holding|pnl|p&l)\b/i.test(lowerMessage);

              if (needsMarketData) {
                // User asked about market data but LLM didn't call tool - auto-execute
                sendEvent({ type: 'action', tool: 'getMarketData', content: 'Fetching real market data...' });
                const marketResult = await executeToolCall({ tool: 'getMarketData', args: {} });
                if (marketResult.success) {
                  sendEvent({ type: 'result', content: formatToolResponse('getMarketData', marketResult.data), isComplete: true });
                } else {
                  sendEvent({ type: 'error', error: marketResult.error || 'Failed to get market data' });
                }
              } else if (needsPositions) {
                // User asked about positions but LLM didn't call tool - auto-execute
                sendEvent({ type: 'action', tool: 'getPositions', content: 'Fetching positions...' });
                const posResult = await executeToolCall({ tool: 'getPositions', args: {} });
                if (posResult.success) {
                  sendEvent({ type: 'result', content: formatToolResponse('getPositions', posResult.data), isComplete: true });
                } else {
                  sendEvent({ type: 'error', error: posResult.error || 'Failed to get positions' });
                }
              } else if (fullContent) {
                // No tool needed - emit final content
                sendEvent({ type: 'result', content: fullContent, isComplete: true });
              }
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
