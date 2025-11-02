import { useState } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

interface ChatCanvasProps {
  initialMessage?: string;
}

export function ChatCanvas({ initialMessage }: ChatCanvasProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'system',
      content: initialMessage || 'Welcome back. No scheduled actions in the next 24h.',
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');

  const handleSend = () => {
    if (!input.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');

    // Simulate assistant response
    setTimeout(() => {
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Command received. Processing your request...',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    }, 500);
  };

  const presets = [
    { label: '/analyze', desc: 'Analyze current positions' },
    { label: '/rebalance', desc: 'Suggest rebalancing' },
    { label: '/roll', desc: 'Roll positions' },
    { label: '/explain', desc: 'Explain strategy' },
  ];

  return (
    <div className="flex-1 flex flex-col bg-black">
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-4">
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
                }`}
                data-testid={`message-${message.role}`}
              >
                <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                <p className="text-xs opacity-60 mt-2 tabular-nums">
                  {message.timestamp.toLocaleTimeString()}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Presets */}
      <div className="border-t border-white/10 bg-charcoal px-6 py-3">
        <div className="max-w-3xl mx-auto flex gap-2 overflow-x-auto">
          {presets.map((preset) => (
            <button
              key={preset.label}
              onClick={() => setInput(preset.label)}
              className="flex-shrink-0 px-3 py-1.5 text-xs bg-transparent border border-white/30 hover:bg-white/10 transition-colors uppercase tracking-wider"
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
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Enter command or ask a question..."
            className="flex-1 input-monochrome"
            data-testid="input-chat"
          />
          <Button
            onClick={handleSend}
            size="icon"
            className="btn-primary"
            data-testid="button-send"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
