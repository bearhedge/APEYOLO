import { LeftNav } from '@/components/LeftNav';
import { ChatCanvas } from '@/components/ChatCanvas';
import { ContextPanel } from '@/components/ContextPanel';
import { useAgentChat } from '@/hooks/useAgentChat';
import { useBrokerStatus } from '@/hooks/useBrokerStatus';
import { Circle, RefreshCw, AlertTriangle } from 'lucide-react';

// System prompt for the trading agent - directive style to avoid meta-commentary
const TRADING_AGENT_PROMPT = `You ARE APEYOLO, an autonomous 0DTE options trading agent.

CRITICAL: ALWAYS THINK BEFORE ACTING
Before taking any action, you MUST reason through your decision inside <think>...</think> tags.
This is required - never skip the thinking step.

Example format:
<think>
User is asking about SPY price. I should fetch current market data to give them accurate info.
The getMarketData tool will provide VIX, SPY price, and market status.
</think>
ACTION: getMarketData()

CRITICAL RULES:
- ALWAYS use <think>...</think> tags before taking any action
- Respond directly as APEYOLO. Never explain what you would do - just do it.
- Never use phrases like "Here's how I would respond", "APEYOLO would say", or "Certainly!"
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
- Always think first inside <think> tags, then act
- Be concise and direct
- State observations, then actions
- If uncertain, say so clearly`;

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

  // IBKR broker status - use same hook as Settings/Engine for consistency
  const {
    connected: ibkrConnected,
    provider: ibkrProvider,
    isConnecting: ibkrIsConnecting,
    environment: ibkrEnvironment,
  } = useBrokerStatus();

  // Agent can only operate if both LLM and IBKR are connected
  const canOperate = isOnline && ibkrConnected;

  // Generate specific offline reason for better UX
  const getOfflineReason = () => {
    if (!isOnline && !ibkrConnected) {
      return 'LLM and IBKR broker are not connected. Please check your configuration.';
    }
    if (!isOnline) {
      return 'LLM is offline. Please check the agent configuration.';
    }
    if (!ibkrConnected) {
      return 'IBKR broker is not connected. Live market data required for agent operation.';
    }
    return undefined;
  };

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
                  ibkrConnected
                    ? 'fill-green-500 text-green-500'
                    : ibkrIsConnecting
                    ? 'fill-yellow-500 text-yellow-500'
                    : 'fill-red-500 text-red-500'
                }`}
              />
              <span className="text-sm font-medium">
                {ibkrConnected
                  ? 'IBKR Connected'
                  : ibkrIsConnecting
                  ? 'IBKR Connecting...'
                  : 'IBKR Disconnected'}
              </span>
              {ibkrConnected && (
                <span className="text-xs text-silver">
                  ({ibkrEnvironment === 'live' ? 'Live' : 'Paper'})
                </span>
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
          offlineReason={getOfflineReason()}
          onSend={sendMessageStreaming}
          onCancel={cancelStreaming}
        />
      </div>
      <ContextPanel />
    </div>
  );
}
