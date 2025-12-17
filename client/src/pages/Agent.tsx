import { LeftNav } from '@/components/LeftNav';
import { ChatCanvas } from '@/components/ChatCanvas';
import { ContextPanel } from '@/components/ContextPanel';
import { useAgentChat } from '@/hooks/useAgentChat';
import { Circle, RefreshCw } from 'lucide-react';

// System prompt for the trading agent
const TRADING_AGENT_PROMPT = `You are APEYOLO, an autonomous trading agent for 0DTE options on SPY. Your role is to:

1. Analyze current positions and market conditions
2. Assess risk based on Greeks (delta, theta, gamma, vega)
3. Make trading decisions within the user's mandate
4. Execute trades via IBKR when conditions are met

You have access to:
- Real-time SPY price and option chains
- Current portfolio positions with P&L
- Risk rules and trading mandate constraints
- Historical performance data

When the user asks for analysis or decisions, provide concise, actionable insights. Always consider risk management and mandate compliance.`;

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
