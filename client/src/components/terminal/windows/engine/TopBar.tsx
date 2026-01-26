/**
 * TopBar - HUD status bar showing market data and mode
 *
 * Displays: SPY bid x ask + % change, VIX bid x ask + % change, connection status, AUTO/MANUAL mode
 */

interface TopBarProps {
  spyBid: number;
  spyAsk: number;
  spyPrevClose: number;
  vixBid: number;
  vixAsk: number;
  vixPrevClose: number;
  isConnected: boolean;
  wsConnected?: boolean;
  nav?: number;          // Account NAV
  mode: 'MANUAL' | 'AUTO';
  autoCountdown?: number; // seconds until next auto-analyze
  onModeToggle: () => void;
}

export function TopBar({
  spyBid,
  spyAsk,
  spyPrevClose,
  vixBid,
  vixAsk,
  vixPrevClose,
  isConnected,
  wsConnected,
  nav,
  mode,
  autoCountdown,
  onModeToggle,
}: TopBarProps) {
  // Calculate midpoint for % change
  const spyMid = (spyBid + spyAsk) / 2;
  const vixMid = (vixBid + vixAsk) / 2;

  // Calculate % change from previous close
  const spyChangePct = spyPrevClose > 0 && spyMid > 0
    ? ((spyMid - spyPrevClose) / spyPrevClose) * 100
    : 0;
  const vixChangePct = vixPrevClose > 0 && vixMid > 0
    ? ((vixMid - vixPrevClose) / vixPrevClose) * 100
    : 0;

  const spyPriceColor = spyChangePct >= 0 ? '#4ade80' : '#ef4444';
  const vixPriceColor = vixChangePct >= 0 ? '#4ade80' : '#ef4444';
  const vixValueColor = vixMid > 20 ? '#f59e0b' : '#888';

  const formatCountdown = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 12px',
        borderBottom: '1px solid #222',
        background: '#0a0a0a',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 13,
      }}
    >
      {/* Left: Market data */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        {/* SPY bid x ask */}
        <span>
          <span style={{ color: '#888' }}>SPY </span>
          {spyBid > 0 && spyAsk > 0 ? (
            <>
              <span style={{ color: '#fff', fontWeight: 600 }}>
                ${spyBid.toFixed(2)}
              </span>
              <span style={{ color: '#666' }}> x </span>
              <span style={{ color: '#fff', fontWeight: 600 }}>
                ${spyAsk.toFixed(2)}
              </span>
              {spyPrevClose > 0 && (
                <span style={{ color: spyPriceColor, marginLeft: 6 }}>
                  {spyChangePct >= 0 ? '\u25B2' : '\u25BC'}
                  {spyChangePct >= 0 ? '+' : ''}{spyChangePct.toFixed(2)}%
                </span>
              )}
            </>
          ) : (
            <span style={{ color: '#ef4444', fontWeight: 500 }}>--</span>
          )}
        </span>

        {/* VIX value only */}
        <span>
          <span style={{ color: '#888' }}>VIX </span>
          {vixMid > 0 ? (
            <span style={{ color: vixValueColor, fontWeight: 500 }}>
              {vixMid.toFixed(2)}
            </span>
          ) : (
            <span style={{ color: '#ef4444', fontWeight: 500 }}>--</span>
          )}
        </span>

        {/* Connection */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: isConnected ? '#4ade80' : '#ef4444',
              display: 'inline-block',
            }}
          />
          <span style={{ color: isConnected ? '#4ade80' : '#ef4444', fontSize: 11 }}>
            {isConnected ? 'CONNECTED' : 'DISCONNECTED'}
          </span>
        </span>

        {/* WebSocket Status */}
        <span style={{ color: wsConnected ? '#4ade80' : '#666', marginLeft: 8 }}>
          WS:{wsConnected ? 'ON' : 'OFF'}
        </span>
      </div>

      {/* Right: NAV + Mode toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {/* NAV */}
        {nav !== undefined && nav > 0 && (
          <span style={{ color: '#00ffff', fontWeight: 600 }}>
            NAV ${nav.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        )}

        {/* Mode toggle */}
        <button
          onClick={onModeToggle}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 12px',
            background: 'transparent',
            border: `1px solid ${mode === 'AUTO' ? '#00ffff' : '#333'}`,
            borderRadius: 4,
            color: mode === 'AUTO' ? '#00ffff' : '#888',
            fontSize: 12,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <span>{mode}</span>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: mode === 'AUTO' ? '#00ffff' : 'transparent',
              border: mode === 'AUTO' ? 'none' : '1px solid #666',
              animation: mode === 'AUTO' ? 'pulse 2s infinite' : 'none',
            }}
          />
          {mode === 'AUTO' && autoCountdown !== undefined && (
            <span style={{ color: '#00ffff', fontFamily: 'monospace' }}>
              {formatCountdown(autoCountdown)}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
