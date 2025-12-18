import { LeftNav } from '@/components/LeftNav';
import { ChatCanvas } from '@/components/ChatCanvas';
import { ContextPanel } from '@/components/ContextPanel';
import { useAgentChat } from '@/hooks/useAgentChat';
import { Circle, RefreshCw } from 'lucide-react';

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

  return (
    <div className="flex h-[calc(100vh-64px)]">
      <LeftNav />
      <div className="flex-1 flex flex-col">
        {/* Agent Status Bar */}
        <div className="flex items-center justify-between px-6 py-2 border-b border-white/10 bg-charcoal">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Circle
                className={`w-2.5 h-2.5 ${
                  isOnline ? 'fill-green-500 text-green-500' : 'fill-red-500 text-red-500'
                }`}
              />
              <span className="text-sm font-medium">
                {isOnline ? 'Agent Online' : 'Agent Offline'}
              </span>
            </div>
            {isOnline && model && (
              <span className="text-xs text-silver">
                Model: {model}
              </span>
            )}
            {!isOnline && statusError && (
              <span className="text-xs text-red-400">
                {statusError}
              </span>
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
          isOnline={isOnline}
          onSend={sendMessageStreaming}
          onCancel={cancelStreaming}
        />
      </div>
      <ContextPanel />
    </div>
  );
}
