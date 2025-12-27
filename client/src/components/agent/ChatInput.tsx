/**
 * ChatInput - Inline chat input for V2 agent
 *
 * Simple text input with send button for conversational agent interactions.
 * Uses useAgentV2 hook for the 5-layer architecture.
 */

import { useState, useCallback, KeyboardEvent } from 'react';
import { Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface ChatInputProps {
  onSend: (message: string) => void;
  isStreaming: boolean;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({
  onSend,
  isStreaming,
  disabled = false,
  placeholder = 'Ask the agent anything...',
}: ChatInputProps) {
  const [message, setMessage] = useState('');

  const handleSend = useCallback(() => {
    const trimmed = message.trim();
    if (trimmed && !isStreaming && !disabled) {
      onSend(trimmed);
      setMessage('');
    }
  }, [message, isStreaming, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const isDisabled = disabled || isStreaming;

  return (
    <div className="flex items-end gap-2 p-4 border-t border-white/10 bg-charcoal">
      <div className="flex-1 relative">
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={isDisabled}
          className="min-h-[44px] max-h-[120px] resize-none bg-black/30 border-white/10 pr-3 py-3"
          rows={1}
        />
        {isStreaming && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
          </div>
        )}
      </div>
      <Button
        onClick={handleSend}
        disabled={isDisabled || !message.trim()}
        size="icon"
        className="h-11 w-11 shrink-0"
      >
        <Send className="w-4 h-4" />
      </Button>
    </div>
  );
}
