/**
 * MainArea - Step-based main content area
 *
 * 3-Step Flow:
 * - Step 1: Strategy selector (PUT / CALL / STRANGLE buttons)
 * - Step 2: Options chain table with strike selection
 * - Step 3: Trade confirmation screen
 *
 * Also supports legacy log streaming mode
 */

import { useEffect, useRef, useCallback, useState } from 'react';

export interface LogLine {
  timestamp: string;
  text: string;
  type: 'header' | 'success' | 'info' | 'result' | 'ready' | 'error';
}

export interface OptionStrike {
  strike: number;
  bid: number;
  ask: number;
  delta: number;
  oi?: number;
}

type Strategy = 'put-spread' | 'call-spread' | 'strangle';

interface MainAreaProps {
  // Legacy props for log streaming
  lines: LogLine[];
  isAnalyzing: boolean;
  progress: number;
  isReady: boolean;

  // 3-step flow props
  flowStep?: 1 | 2 | 3;
  selectedStrategy?: Strategy | null;
  optionsChain?: { puts: OptionStrike[]; calls: OptionStrike[] };
  selectedStrike?: OptionStrike | null;
  onStrategySelect?: (strategy: Strategy) => void;
  onStrikeSelect?: (strike: OptionStrike) => void;
  onNext?: () => void;
  onBack?: () => void;

  // Trade confirmation data
  contracts?: number;
  spreadWidth?: number;
  credit?: number;
  maxLoss?: number;
  putStrike?: number | null;
  callStrike?: number | null;
  onExecute?: () => void;
}

export function MainArea({
  lines,
  isAnalyzing,
  progress,
  isReady,
  flowStep = 1,
  selectedStrategy,
  optionsChain,
  selectedStrike,
  onStrategySelect,
  onStrikeSelect,
  onNext,
  onBack,
  contracts = 2,
  spreadWidth = 5,
  putStrike: propPutStrike,
  callStrike: propCallStrike,
  credit = 0,
  maxLoss = 0,
  onExecute,
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

  // Render Step 1: Strategy Selector
  const renderStrategySelector = () => (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        padding: 24,
      }}
    >
      <div style={{ color: '#00ffff', fontSize: 14, letterSpacing: 2, marginBottom: 8 }}>
        SELECT STRATEGY
      </div>

      <div style={{ display: 'flex', gap: 16 }}>
        {(['put-spread', 'call-spread', 'strangle'] as Strategy[]).map((strat) => {
          const labels: Record<Strategy, string> = {
            'put-spread': 'PUT',
            'call-spread': 'CALL',
            'strangle': 'STRANGLE',
          };
          const shortcuts: Record<Strategy, string> = {
            'put-spread': '1',
            'call-spread': '2',
            'strangle': '3',
          };

          return (
            <button
              key={strat}
              onClick={() => onStrategySelect?.(strat)}
              style={{
                padding: '16px 32px',
                background: '#1a1a1a',
                border: '2px solid #333',
                borderRadius: 8,
                color: '#fff',
                fontSize: 16,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: "'IBM Plex Mono', monospace",
                transition: 'all 0.2s ease',
                minWidth: 120,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#00ffff';
                e.currentTarget.style.background = '#1a2a2a';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#333';
                e.currentTarget.style.background = '#1a1a1a';
              }}
            >
              <div style={{ color: '#666', fontSize: 11, marginBottom: 4 }}>
                [{shortcuts[strat]}]
              </div>
              {labels[strat]}
            </button>
          );
        })}
      </div>

      <div style={{ color: '#555', fontSize: 11, marginTop: 16 }}>
        Click or press 1, 2, 3 to select
      </div>
    </div>
  );

  // Render Step 2: Options Chain
  const renderOptionsChain = () => {
    const strikes = selectedStrategy === 'call-spread'
      ? optionsChain?.calls || []
      : optionsChain?.puts || [];

    const typeLabel = selectedStrategy === 'call-spread' ? 'CALLS' : 'PUTS';

    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          padding: 16,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
            paddingBottom: 8,
            borderBottom: '1px solid #333',
          }}
        >
          <div style={{ color: '#00ffff', fontSize: 13, letterSpacing: 1 }}>
            {typeLabel} (0DTE)
          </div>
          <button
            onClick={onBack}
            style={{
              padding: '4px 12px',
              background: 'transparent',
              border: '1px solid #444',
              borderRadius: 4,
              color: '#888',
              fontSize: 11,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            &larr; BACK
          </button>
        </div>

        {/* Table header */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '80px 120px 80px',
            gap: 16,
            padding: '8px 12px',
            color: '#666',
            fontSize: 11,
            borderBottom: '1px solid #222',
          }}
        >
          <span>STRIKE</span>
          <span>BID/ASK</span>
          <span>DELTA</span>
        </div>

        {/* Strike rows */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {strikes.length === 0 ? (
            <div style={{ color: '#555', padding: 24, textAlign: 'center' }}>
              No strikes available
            </div>
          ) : (
            strikes.map((strike, i) => {
              const isSelected = selectedStrike?.strike === strike.strike;
              const midPrice = ((strike.bid + strike.ask) / 2).toFixed(2);

              return (
                <div
                  key={strike.strike}
                  onClick={() => onStrikeSelect?.(strike)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '80px 120px 80px',
                    gap: 16,
                    padding: '10px 12px',
                    cursor: 'pointer',
                    background: isSelected ? '#1a2a2a' : 'transparent',
                    borderLeft: isSelected ? '3px solid #00ffff' : '3px solid transparent',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = '#111';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = 'transparent';
                    }
                  }}
                >
                  <span style={{ color: '#fff', fontWeight: 600 }}>{strike.strike}</span>
                  <span style={{ color: '#4ade80' }}>
                    {strike.bid.toFixed(2)}/{strike.ask.toFixed(2)}
                  </span>
                  <span style={{ color: '#888' }}>
                    .{Math.abs(strike.delta * 100).toFixed(0).padStart(2, '0')}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* Next button */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            paddingTop: 16,
            borderTop: '1px solid #222',
          }}
        >
          <button
            onClick={onNext}
            disabled={!selectedStrike}
            style={{
              padding: '10px 24px',
              background: selectedStrike ? '#1a3a3a' : 'transparent',
              border: `1px solid ${selectedStrike ? '#00ffff' : '#333'}`,
              borderRadius: 4,
              color: selectedStrike ? '#00ffff' : '#555',
              fontSize: 12,
              fontWeight: 600,
              cursor: selectedStrike ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit',
            }}
          >
            NEXT &rarr;
          </button>
        </div>
      </div>
    );
  };

  // Render Step 3: Trade Confirmation
  const renderConfirmation = () => {
    const isStrangle = selectedStrategy === 'strangle';

    const strategyLabel = selectedStrategy === 'put-spread'
      ? 'PUT CREDIT SPREAD'
      : selectedStrategy === 'call-spread'
      ? 'CALL CREDIT SPREAD'
      : 'STRANGLE';

    // For spreads, use selected strike; for strangle, use prop strikes
    const shortStrike = selectedStrike?.strike || 0;
    const longStrike = selectedStrategy === 'call-spread'
      ? shortStrike + spreadWidth
      : shortStrike - spreadWidth;

    // Calculate credit
    const midPrice = selectedStrike ? (selectedStrike.bid + selectedStrike.ask) / 2 : 0;
    const displayCredit = credit > 0 ? credit : midPrice;
    const totalCredit = displayCredit * contracts * 100;
    const calculatedMaxLoss = maxLoss > 0 ? maxLoss : (spreadWidth * 100 - midPrice * 100) * contracts;

    // Format strikes display
    const strikesDisplay = isStrangle
      ? `${propPutStrike || '---'}P / ${propCallStrike || '---'}C`
      : `${shortStrike}/${longStrike} (${spreadWidth}-wide)`;

    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 400,
            background: '#111',
            border: '2px solid #333',
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '16px 20px',
              background: '#1a1a1a',
              borderBottom: '1px solid #333',
              textAlign: 'center',
            }}
          >
            <div style={{ color: '#00ffff', fontSize: 14, letterSpacing: 2, fontWeight: 600 }}>
              TRADE CONFIRMATION
            </div>
          </div>

          {/* Details */}
          <div style={{ padding: '20px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#888' }}>Strategy:</span>
                <span style={{ color: '#fff', fontWeight: 600 }}>{strategyLabel}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#888' }}>Strikes:</span>
                <span style={{ color: '#fff', fontWeight: 600 }}>
                  {strikesDisplay}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#888' }}>Expiration:</span>
                <span style={{ color: '#f59e0b', fontWeight: 600 }}>0DTE (today)</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#888' }}>Contracts:</span>
                <span style={{ color: '#fff', fontWeight: 600 }}>{contracts}</span>
              </div>
            </div>

            {/* Divider */}
            <div style={{ borderTop: '1px solid #333', margin: '16px 0' }} />

            {/* Financial details */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#888' }}>Credit:</span>
                <span style={{ color: '#4ade80', fontWeight: 600, fontSize: 16 }}>
                  ${displayCredit.toFixed(2)} (${totalCredit.toFixed(0)} total)
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#888' }}>Max Loss:</span>
                <span style={{ color: '#ef4444', fontWeight: 600 }}>
                  ${calculatedMaxLoss.toFixed(0)}
                </span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div
            style={{
              display: 'flex',
              gap: 12,
              padding: '16px 20px',
              background: '#0a0a0a',
              borderTop: '1px solid #333',
            }}
          >
            <button
              onClick={onBack}
              style={{
                flex: 1,
                padding: '12px',
                background: 'transparent',
                border: '1px solid #444',
                borderRadius: 4,
                color: '#888',
                fontSize: 12,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              &larr; BACK
            </button>
            <button
              onClick={onExecute}
              style={{
                flex: 2,
                padding: '12px',
                background: '#1a3a1a',
                border: '2px solid #4ade80',
                borderRadius: 4,
                color: '#4ade80',
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'inherit',
                letterSpacing: 1,
              }}
            >
              APE IN
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Render log lines (analyzing state or legacy mode)
  const renderLogLines = () => (
    <>
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
    </>
  );

  // Determine what to render based on state
  const renderContent = () => {
    // If analyzing, show log lines
    if (isAnalyzing) {
      return renderLogLines();
    }

    // 3-step flow
    switch (flowStep) {
      case 1:
        return renderStrategySelector();
      case 2:
        return renderOptionsChain();
      case 3:
        return renderConfirmation();
      default:
        return renderLogLines();
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

      {renderContent()}

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
