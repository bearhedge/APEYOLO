/**
 * CommandInput - Terminal-style command input for agent commands
 *
 * Features:
 * - Type /vix, /market, /positions, /analyze, /help
 * - Natural language queries
 * - Enter to submit
 * - Command history (up/down arrows)
 */

import { useState, useCallback, useRef, useEffect } from 'react';

interface CommandInputProps {
  onCommand: (command: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function CommandInput({ onCommand, disabled, placeholder = '/help' }: CommandInputProps) {
  const [value, setValue] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;

    // Add to history (avoid duplicates at end)
    if (history[history.length - 1] !== trimmed) {
      setHistory(prev => [...prev.slice(-19), trimmed]); // Keep last 20
    }
    setHistoryIndex(-1);

    onCommand(trimmed);
    setValue('');
  }, [value, disabled, history, onCommand]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      const newIndex = historyIndex < history.length - 1 ? historyIndex + 1 : historyIndex;
      setHistoryIndex(newIndex);
      setValue(history[history.length - 1 - newIndex] || '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex <= 0) {
        setHistoryIndex(-1);
        setValue('');
      } else {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setValue(history[history.length - 1 - newIndex] || '');
      }
    }
  }, [handleSubmit, history, historyIndex]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '8px 12px',
        borderTop: '1px solid #222',
        background: '#0a0a0a',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 13,
      }}
    >
      <span style={{ color: '#00ffff', marginRight: 8 }}>&gt;</span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        style={{
          flex: 1,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: '#fff',
          fontSize: 13,
          fontFamily: 'inherit',
          caretColor: '#00ff00',
        }}
      />
      {value && (
        <span
          style={{
            color: '#555',
            fontSize: 11,
            marginLeft: 8,
          }}
        >
          ENTER
        </span>
      )}
    </div>
  );
}
