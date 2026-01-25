/**
 * SelectionBar - Strategy and strike selection
 *
 * Features:
 * - [1] PUT SPREAD  [2] CALL SPREAD  [3] IRON CONDOR buttons
 * - Current strikes display
 * - Keyboard shortcuts (1, 2, 3)
 */

export type Strategy = 'put-spread' | 'call-spread' | 'iron-condor';

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
    { key: 'put-spread', label: 'PUT SPREAD', shortcut: '1' },
    { key: 'call-spread', label: 'CALL SPREAD', shortcut: '2' },
    { key: 'iron-condor', label: 'IRON CONDOR', shortcut: '3' },
  ];

  const formatStrike = () => {
    if (strategy === 'put-spread' && putStrike) {
      return `${putStrike}/${putStrike - putSpread}`;
    }
    if (strategy === 'call-spread' && callStrike) {
      return `${callStrike}/${callStrike + callSpread}`;
    }
    if (strategy === 'iron-condor' && putStrike && callStrike) {
      return `${putStrike}/${putStrike - putSpread} | ${callStrike}/${callStrike + callSpread}`;
    }
    return '---/---';
  };

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 12px',
        borderTop: '1px solid #222',
        borderBottom: '1px solid #222',
        background: '#0d0d0d',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 12,
      }}
    >
      {/* Strategy buttons */}
      <div style={{ display: 'flex', gap: 8 }}>
        {strategies.map((s) => (
          <button
            key={s.key}
            onClick={() => onStrategyChange(s.key)}
            style={{
              padding: '6px 12px',
              background: strategy === s.key ? '#1a1a1a' : 'transparent',
              border: `1px solid ${strategy === s.key ? '#00ffff' : '#333'}`,
              borderRadius: 4,
              color: strategy === s.key ? '#00ffff' : '#666',
              fontSize: 11,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'all 0.15s ease',
            }}
          >
            <span style={{ color: strategy === s.key ? '#00ffff' : '#555', marginRight: 4 }}>
              [{s.shortcut}]
            </span>
            {s.label}
          </button>
        ))}
      </div>

      {/* Current strikes */}
      <div style={{ color: '#888' }}>
        <span style={{ color: '#555' }}>STRIKES: </span>
        <span style={{ color: '#fff', fontWeight: 500 }}>{formatStrike()}</span>
      </div>
    </div>
  );
}
