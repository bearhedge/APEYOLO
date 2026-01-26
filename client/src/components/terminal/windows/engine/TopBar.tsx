/**
 * TopBar - HUD status bar showing market data and mode
 *
 * Displays: SPY price, VIX, connection status, AUTO/MANUAL mode
 */

interface TopBarProps {
  spyPrice: number;
  spyChangePct: number;
  vix: number;
  isConnected: boolean;
  mode: 'MANUAL' | 'AUTO';
  autoCountdown?: number; // seconds until next auto-analyze
  onModeToggle: () => void;
}

export function TopBar({
  spyPrice,
  spyChangePct,
  vix,
  isConnected,
  mode,
  autoCountdown,
  onModeToggle,
}: TopBarProps) {
  const priceColor = spyChangePct >= 0 ? '#4ade80' : '#ef4444';
  const vixColor = vix > 20 ? '#f59e0b' : '#888';

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
        {/* SPY - show N/A when price is 0 (SPY will never actually be $0) */}
        <span>
          <span style={{ color: '#888' }}>SPY </span>
          {spyPrice > 0 ? (
            <>
              <span style={{ color: '#fff', fontWeight: 600 }}>${spyPrice.toFixed(2)}</span>
              <span style={{ color: priceColor, marginLeft: 6 }}>
                {spyChangePct >= 0 ? '\u25B2' : '\u25BC'}
                {spyChangePct >= 0 ? '+' : ''}{spyChangePct.toFixed(2)}%
              </span>
            </>
          ) : (
            <span style={{ color: '#666', fontWeight: 500 }}>N/A</span>
          )}
        </span>

        {/* VIX - show N/A when value is 0 */}
        <span>
          <span style={{ color: '#888' }}>VIX </span>
          {vix > 0 ? (
            <span style={{ color: vixColor, fontWeight: 500 }}>{vix.toFixed(1)}</span>
          ) : (
            <span style={{ color: '#666', fontWeight: 500 }}>N/A</span>
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
      </div>

      {/* Right: Mode toggle */}
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
  );
}
