import { LeftNav } from '@/components/LeftNav';
import { ChatCanvas } from '@/components/ChatCanvas';
import { ContextPanel } from '@/components/ContextPanel';
import { useAgentChat } from '@/hooks/useAgentChat';
import { useQuery } from '@tanstack/react-query';
import { Circle, RefreshCw, AlertTriangle } from 'lucide-react';

// System prompt for the trading agent - directive style to avoid meta-commentary
const TRADING_AGENT_PROMPT = `You ARE APEYOLO, an autonomous 0DTE options trading agent.

CRITICAL RULES:
- Respond directly as APEYOLO. Never explain what you would do - just do it.
- Never use phrases like "Here's how I would respond", "APEYOLO would say", or "Certainly!"
- Never prefix responses with meta-commentary about what you're going to do.
- When you want to take action, use the format: ACTION: tool_name(args)

AVAILABLE TOOLS:
- getMarketData() - Get VIX, SPY price, market status
- getPositions() - View current portfolio positions
- runEngine() - Run the 5-step trading engine to find optimal strikes
- executeTrade(side, strike, contracts) - Submit order to IBKR
- closeTrade(positionId) - Close an existing position

YOUR CAPABILITIES:
- Analyze market conditions (VIX level, SPY price, time to expiry)
- View current positions and P/L in real-time
- Run the trading engine to find optimal strangle strikes
- Execute trades within mandate limits

TRADING MANDATE:
- Max 2 contracts per side
- Trading hours only (9:30 AM - 4:00 PM ET)
- 2% max loss rule per trade
- Critic (Qwen) must approve before execution

RESPONSE STYLE:
- Be concise and direct
- State observations, then actions
- If uncertain, say so clearly`;

// Fetch IBKR broker diagnostics
async function fetchBrokerStatus(): Promise<{ connected: boolean; provider: string; error?: string }> {
  try {
    const response = await fetch('/api/broker/diag', { credentials: 'include' });
    if (!response.ok) {
      return { connected: false, provider: 'unknown', error: 'Failed to fetch broker status' };
    }
    const data = await response.json();
    // Check if all IBKR phases are successful (status 200)
    const isConnected = data.success &&
      data.oauth?.status === 200 &&
      data.sso?.status === 200 &&
      data.validate?.status === 200 &&
      data.init?.status === 200;
    return {
      connected: isConnected,
      provider: data.provider || 'unknown',
      error: isConnected ? undefined : 'IBKR not fully connected',
    };
  } catch (error) {
    return { connected: false, provider: 'unknown', error: 'Failed to check broker' };
  }
}

export function Agent() {
  const {
    isOnline,
    model,
    statusError,
    isCheckingStatus,
    messages,
    isStreaming,
    isSending,
    sendMessageStreaming,
    cancelStreaming,
    clearMessages,
    refreshStatus,
  } = useAgentChat({
    systemPrompt: TRADING_AGENT_PROMPT,
    enableStatusPolling: true,
  });

  // IBKR broker status query
  const brokerQuery = useQuery({
    queryKey: ['/api/broker/diag'],
    queryFn: fetchBrokerStatus,
    refetchInterval: 30000, // Check every 30 seconds
    staleTime: 10000,
  });

  const ibkrConnected = brokerQuery.data?.connected ?? false;
  const ibkrProvider = brokerQuery.data?.provider ?? 'unknown';
  const ibkrError = brokerQuery.data?.error;

  // Agent can only operate if both LLM and IBKR are connected
  const canOperate = isOnline && ibkrConnected;

  return (
    <div className="flex h-[calc(100vh-64px)]">
      <LeftNav />
      <div className="flex-1 flex flex-col">
        {/* Agent Status Bar */}
        <div className="flex items-center justify-between px-6 py-2 border-b border-white/10 bg-charcoal">
          <div className="flex items-center gap-4">
            {/* LLM Status */}
            <div className="flex items-center gap-2">
              <Circle
                className={`w-2.5 h-2.5 ${
                  isOnline ? 'fill-green-500 text-green-500' : 'fill-red-500 text-red-500'
                }`}
              />
              <span className="text-sm font-medium">
                {isOnline ? 'LLM Online' : 'LLM Offline'}
              </span>
              {isOnline && model && (
                <span className="text-xs text-silver">({model})</span>
              )}
            </div>

            {/* IBKR Status */}
            <div className="flex items-center gap-2 border-l border-white/10 pl-4">
              <Circle
                className={`w-2.5 h-2.5 ${
                  ibkrConnected ? 'fill-green-500 text-green-500' : 'fill-red-500 text-red-500'
                }`}
              />
              <span className="text-sm font-medium">
                {ibkrConnected ? 'IBKR Connected' : 'IBKR Disconnected'}
              </span>
              {ibkrConnected && ibkrProvider === 'ibkr' && (
                <span className="text-xs text-silver">(Live)</span>
              )}
            </div>

            {/* Warning if not fully operational */}
            {!canOperate && (
              <div className="flex items-center gap-1 text-amber-400 text-xs">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>
                  {!isOnline && !ibkrConnected
                    ? 'LLM and IBKR required'
                    : !isOnline
                    ? 'LLM required'
                    : 'IBKR required for live data'}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={refreshStatus}
              disabled={isCheckingStatus}
              className="p-1.5 text-silver hover:text-white transition-colors disabled:opacity-50"
              title="Refresh status"
            >
              <RefreshCw className={`w-4 h-4 ${isCheckingStatus ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={clearMessages}
              className="text-xs text-silver hover:text-white transition-colors px-2 py-1"
            >
              Clear Chat
            </button>
          </div>
        </div>

        {/* Chat Canvas */}
        <ChatCanvas
          messages={messages}
          isStreaming={isStreaming}
          isSending={isSending}
          isOnline={canOperate}
          onSend={sendMessageStreaming}
          onCancel={cancelStreaming}
        />
      </div>
      <ContextPanel />
    </div>
  );
}
