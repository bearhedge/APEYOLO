/**
 * MainArea - Streaming analysis log with timestamps
 *
 * Features:
 * - Real-time log of engine analysis
 * - Timestamps on every line
 * - Checkmarks as steps complete
 * - Progress bar
 * - Blinking cursor
 * - "READY TO APE IN" state
 */

import { useEffect, useRef } from 'react';

export interface LogLine {
  timestamp: string;
  text: string;
  type: 'header' | 'success' | 'info' | 'result' | 'ready';
}

interface MainAreaProps {
  lines: LogLine[];
  isAnalyzing: boolean;
  progress: number; // 0-100
  isReady: boolean;
}

export function MainArea({ lines, isAnalyzing, progress, isReady }: MainAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  const getLineColor = (type: LogLine['type']) => {
    switch (type) {
      case 'header':
        return '#00ffff'; // cyan
      case 'success':
        return '#4ade80'; // green
      case 'result':
        return '#f59e0b'; // amber
      case 'ready':
        return '#00ff00'; // matrix green
      default:
        return '#888';
    }
  };

  const getLinePrefix = (type: LogLine['type']) => {
    switch (type) {
      case 'header':
        return '>';
      case 'success':
        return '\u2713'; // checkmark
      case 'result':
        return '\u2192'; // arrow
      case 'ready':
        return '';
      default:
        return ' ';
    }
  };

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        background: '#0a0a0a',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 13,
        position: 'relative',
      }}
    >
      {/* Scanlines overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px)',
          pointerEvents: 'none',
          zIndex: 1,
        }}
      />

      {/* Log area */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '12px 16px',
        }}
      >
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              gap: 8,
              marginBottom: 4,
              color: getLineColor(line.type),
            }}
          >
            <span style={{ color: '#666', minWidth: 70 }}>{line.timestamp}</span>
            <span style={{ minWidth: 16 }}>{getLinePrefix(line.type)}</span>
            <span>{line.text}</span>
          </div>
        ))}

        {/* Blinking cursor */}
        {!isReady && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <span style={{ color: '#666', minWidth: 70 }}></span>
            <span
              style={{
                width: 10,
                height: 18,
                background: '#00ff00',
                animation: 'blink 1s step-end infinite',
              }}
            />
          </div>
        )}

        {/* Ready state */}
        {isReady && (
          <div
            style={{
              marginTop: 16,
              padding: '12px 0',
              textAlign: 'center',
              animation: 'pulse 2s infinite',
            }}
          >
            <div
              style={{
                display: 'inline-block',
                padding: '8px 24px',
                background: 'linear-gradient(90deg, #0a0a0a, #1a1a1a, #0a0a0a)',
                border: '1px solid #00ff00',
                color: '#00ff00',
                fontSize: 14,
                fontWeight: 600,
                letterSpacing: 2,
              }}
            >
              READY TO APE IN
            </div>
          </div>
        )}
      </div>

      {/* Progress bar */}
      {isAnalyzing && (
        <div
          style={{
            height: 3,
            background: '#222',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              height: '100%',
              width: `${progress}%`,
              background: 'linear-gradient(90deg, #00ffff, #00ff00)',
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      )}

      {/* CSS animations */}
      <style>{`
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      `}</style>
    </div>
  );
}
