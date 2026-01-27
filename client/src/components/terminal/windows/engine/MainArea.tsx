/**
 * MainArea - Terminal log display
 *
 * Shows streaming analysis log lines with:
 * - Timestamped entries
 * - Color-coded by type (header, success, info, result, error)
 * - Progress bar during analysis
 * - Ready state indicator
 */

import { useEffect, useRef } from 'react';

export interface LogLine {
  timestamp: string;
  text: string;
  type: 'header' | 'success' | 'info' | 'result' | 'ready' | 'error';
  // Optional strike data for clickable strike rows
  strikeData?: {
    strike: number;
    optionType: 'PUT' | 'CALL';
  };
}

export interface OptionStrike {
  strike: number;
  bid: number;
  ask: number;
  delta: number;
  oi?: number;
}

interface MainAreaProps {
  lines: LogLine[];
  isAnalyzing: boolean;
  progress: number;
  isReady: boolean;
  onPutSelect?: (strike: number) => void;
  onCallSelect?: (strike: number) => void;
  selectedPutStrike?: number | null;
  selectedCallStrike?: number | null;
}

export function MainArea({
  lines,
  isAnalyzing,
  progress,
  isReady,
  onPutSelect,
  onCallSelect,
  selectedPutStrike,
  selectedCallStrike,
}: MainAreaProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom for log lines
  useEffect(() => {
    if (scrollRef.current && lines.length > 0) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines]);

  const getLineColor = (type: LogLine['type']) => {
    switch (type) {
      case 'header':
        return '#00ffff';
      case 'success':
        return '#4ade80';
      case 'result':
        return '#f59e0b';
      case 'ready':
        return '#00ff00';
      case 'error':
        return '#ef4444';
      default:
        return '#888';
    }
  };

  const getLinePrefix = (type: LogLine['type']) => {
    switch (type) {
      case 'header':
        return '>';
      case 'success':
        return '\u2713';
      case 'result':
        return '\u2192';
      case 'error':
        return '\u2717';
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
          background:
            'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px)',
          pointerEvents: 'none',
          zIndex: 1,
        }}
      />

      {/* Log lines */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '12px 16px',
        }}
      >
        {lines.map((line, i) => {
          const isClickable = !!line.strikeData;
          const isSelected = line.strikeData && (
            (line.strikeData.optionType === 'PUT' && selectedPutStrike === line.strikeData.strike) ||
            (line.strikeData.optionType === 'CALL' && selectedCallStrike === line.strikeData.strike)
          );

          const handleClick = () => {
            if (!line.strikeData) return;
            console.log('[MainArea] Strike clicked:', line.strikeData);
            if (line.strikeData.optionType === 'PUT' && onPutSelect) {
              onPutSelect(line.strikeData.strike);
            } else if (line.strikeData.optionType === 'CALL' && onCallSelect) {
              onCallSelect(line.strikeData.strike);
            }
          };

          return (
            <div
              key={i}
              onClick={isClickable ? handleClick : undefined}
              style={{
                display: 'flex',
                gap: 8,
                marginBottom: 4,
                color: isSelected ? '#00ffff' : getLineColor(line.type),
                cursor: isClickable ? 'pointer' : 'default',
                padding: isClickable ? '4px 8px' : '0',
                marginLeft: isClickable ? '-8px' : '0',
                background: isSelected ? 'rgba(0, 255, 255, 0.1)' : isClickable ? 'transparent' : 'transparent',
                borderLeft: isSelected ? '2px solid #00ffff' : 'none',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (isClickable && !isSelected) {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                }
              }}
              onMouseLeave={(e) => {
                if (isClickable && !isSelected) {
                  e.currentTarget.style.background = 'transparent';
                }
              }}
            >
              <span style={{ color: '#666', minWidth: 70 }}>{line.timestamp}</span>
              <span style={{ minWidth: 16 }}>{getLinePrefix(line.type)}</span>
              <span style={{ whiteSpace: 'pre-wrap' }}>{line.text}</span>
            </div>
          );
        })}

        {/* Blinking cursor */}
        {!isReady && isAnalyzing && (
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
