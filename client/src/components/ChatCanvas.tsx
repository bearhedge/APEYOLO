import { useState, useRef, useEffect } from 'react';
import { Send, Square, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ChatMessage } from '@/hooks/useAgentChat';

interface ChatCanvasProps {
  /** Messages from agent chat hook */
  messages?: ChatMessage[];
  /** Whether the agent is currently streaming a response */
  isStreaming?: boolean;
  /** Whether a message is being sent */
  isSending?: boolean;
  /** Whether the agent is online and can operate */
  isOnline?: boolean;
  /** Custom reason for being offline (shows in banner) */
  offlineReason?: string;
  /** Callback to send a message */
  onSend?: (content: string) => void;
  /** Callback to cancel streaming */
  onCancel?: () => void;
  /** Initial message (used when no messages prop) */
  initialMessage?: string;
}

export function ChatCanvas({
  messages: externalMessages,
  isStreaming = false,
  isSending = false,
  isOnline = false,
  offlineReason,
  onSend,
  onCancel,
  initialMessage,
}: ChatCanvasProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Use external messages if provided, otherwise use empty array with initial message
  const messages = externalMessages ?? (initialMessage ? [{
    id: 'initial',
    role: 'system' as const,
    content: initialMessage,
    timestamp: new Date(),
  }] : []);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() || isSending || isStreaming) return;

    if (onSend) {
      onSend(input);
      setInput('');
    }
  };

  const presets = [
    { label: '/analyze', desc: 'Analyze current positions' },
    { label: '/risk', desc: 'Risk assessment' },
    { label: '/status', desc: 'Portfolio status' },
    { label: '/help', desc: 'Available commands' },
  ];

  return (
    <div className="flex-1 flex flex-col bg-black">
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-4">
          {/* Offline Banner */}
          {!isOnline && (
            <div className="p-4 bg-red-900/20 border border-red-500/30 text-center">
              <p className="text-sm text-red-400">
                {offlineReason || 'Agent is offline. Messages cannot be sent until the connection is restored.'}
              </p>
            </div>
          )}

          {/* Empty State */}
          {messages.length === 0 && (
            <div className="text-center py-12">
              <p className="text-silver text-sm">
                {isOnline
                  ? 'Start a conversation with the trading agent.'
                  : 'Waiting for agent connection...'}
              </p>
            </div>
          )}

          {/* Messages */}
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${
                message.role === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              <div
                className={`max-w-[80%] p-4 ${
                  message.role === 'user'
                    ? 'bg-white text-black border border-white'
                    : message.role === 'system'
                    ? 'bg-dark-gray border border-white/20 text-silver'
                    : 'bg-dark-gray border border-white/20'
                } ${message.isStreaming ? 'animate-pulse' : ''}`}
                data-testid={`message-${message.role}`}
              >
                <p className="text-sm whitespace-pre-wrap">
                  {message.content || (message.isStreaming ? '...' : '')}
                </p>
                <p className="text-xs opacity-60 mt-2 tabular-nums">
                  {message.timestamp.toLocaleTimeString()}
                  {message.isStreaming && ' (streaming...)'}
                </p>
              </div>
            </div>
          ))}

          {/* Auto-scroll anchor */}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Presets */}
      <div className="border-t border-white/10 bg-charcoal px-6 py-3">
        <div className="max-w-3xl mx-auto flex gap-2 overflow-x-auto">
          {presets.map((preset) => (
            <button
              key={preset.label}
              onClick={() => setInput(preset.label)}
              disabled={!isOnline || isSending || isStreaming}
              className="flex-shrink-0 px-3 py-1.5 text-xs bg-transparent border border-white/30 hover:bg-white/10 transition-colors uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid={`preset-${preset.label.slice(1)}`}
              title={preset.desc}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Input Bar */}
      <div className="border-t border-white/10 bg-charcoal p-4">
        <div className="max-w-3xl mx-auto flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder={
              !isOnline
                ? 'Agent offline...'
                : isStreaming
                ? 'Waiting for response...'
                : 'Enter command or ask a question...'
            }
            disabled={!isOnline || isSending || isStreaming}
            className="flex-1 input-monochrome disabled:opacity-50"
            data-testid="input-chat"
          />
          {isStreaming ? (
            <Button
              onClick={onCancel}
              size="icon"
              variant="destructive"
              className="bg-red-600 hover:bg-red-700"
              data-testid="button-cancel"
              title="Cancel"
            >
              <Square className="w-4 h-4" />
            </Button>
          ) : (
            <Button
              onClick={handleSend}
              size="icon"
              className="btn-primary"
              disabled={!isOnline || !input.trim() || isSending}
              data-testid="button-send"
            >
              {isSending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
