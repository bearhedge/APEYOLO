/**
 * SelectionBar - Strategy and strike selection
 *
 * Features:
 * - [1] PUT  [2] CALL  [3] STRANGLE buttons
 * - Current strikes display
 * - Keyboard shortcuts (1, 2, 3)
 */

export type Strategy = 'put-spread' | 'call-spread' | 'strangle';

interface SelectionBarProps {
  strategy: Strategy;
  onStrategyChange: (s: Strategy) => void;
  putStrike?: number | null;
  callStrike?: number | null;
  putSpread?: number; // width of put spread
  callSpread?: number; // width of call spread
}

export function SelectionBar({
  strategy,
  onStrategyChange,
  putStrike,
  callStrike,
  putSpread = 5,
  callSpread = 5,
}: SelectionBarProps) {
  const strategies: { key: Strategy; label: string; shortcut: string }[] = [
    { key: 'put-spread', label: 'PUT', shortcut: '1' },
    { key: 'call-spread', label: 'CALL', shortcut: '2' },
    { key: 'strangle', label: 'STRANGLE', shortcut: '3' },
  ];

  const formatStrike = () => {
    if (strategy === 'put-spread' && putStrike) {
      return `${putStrike}P`;
    }
    if (strategy === 'call-spread' && callStrike) {
      return `${callStrike}C`;
    }
    if (strategy === 'strangle') {
      if (putStrike && callStrike) {
        return `${putStrike}P / ${callStrike}C`;
      }
      if (putStrike) return `${putStrike}P / ---C`;
      if (callStrike) return `---P / ${callStrike}C`;
    }
    return '---';
  };

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px 12px',
        borderTop: '1px solid #333',
        borderBottom: '1px solid #333',
        background: '#111',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 12,
      }}
    >
      {/* Strategy buttons */}
      <div style={{ display: 'flex', gap: 8 }}>
        {strategies.map((s) => {
          const isActive = strategy === s.key;
          return (
            <button
              key={s.key}
              onClick={() => onStrategyChange(s.key)}
              style={{
                padding: '8px 14px',
                background: isActive ? '#1a3a3a' : '#1a1a1a',
                border: `1px solid ${isActive ? '#00ffff' : '#444'}`,
                borderRadius: 4,
                color: isActive ? '#00ffff' : '#aaa',
                fontSize: 11,
                fontWeight: isActive ? 600 : 400,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'all 0.15s ease',
              }}
            >
              <span style={{ color: isActive ? '#00ffff' : '#666', marginRight: 6 }}>
                [{s.shortcut}]
              </span>
              {s.label}
            </button>
          );
        })}
      </div>

      {/* Current strikes */}
      <div style={{ color: '#888' }}>
        <span style={{ color: '#666', marginRight: 8 }}>STRIKES:</span>
        <span style={{ color: '#fff', fontWeight: 600, fontSize: 13 }}>{formatStrike()}</span>
      </div>
    </div>
  );
}
