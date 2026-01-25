/**
 * ActionBar - Bottom action bar with analyze/execute controls
 *
 * Features:
 * - Main action: ANALYZE / RESET
 * - Credit display
 * - Execute button: APE IN
 */

interface ActionBarProps {
  state: 'idle' | 'analyzing' | 'ready';
  credit: number;
  contracts: number;
  onAnalyze: () => void;
  onExecute: () => void;
  onReset: () => void;
  isExecuting: boolean;
}

export function ActionBar({
  state,
  credit,
  contracts,
  onAnalyze,
  onExecute,
  onReset,
  isExecuting,
}: ActionBarProps) {
  const mainAction = state === 'ready' ? 'RESET' : 'ANALYZE';
  const handleMainAction = state === 'ready' ? onReset : onAnalyze;
  const canExecute = state === 'ready' && !isExecuting;

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px 12px',
        background: '#0a0a0a',
        borderTop: '1px solid #222',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 13,
      }}
    >
      {/* Main action */}
      <button
        onClick={handleMainAction}
        disabled={state === 'analyzing'}
        style={{
          padding: '8px 24px',
          background: 'transparent',
          border: '1px solid #333',
          color: state === 'analyzing' ? '#555' : '#888',
          fontSize: 12,
          cursor: state === 'analyzing' ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span style={{ color: '#555' }}>{'\u25C0'}</span>
        <span>{state === 'analyzing' ? 'ANALYZING...' : mainAction}</span>
        <span style={{ color: '#555' }}>{'\u25B6'}</span>
      </button>

      {/* Credit display */}
      <div style={{ color: '#888' }}>
        <span style={{ color: '#555' }}>CREDIT: </span>
        <span style={{ color: credit > 0 ? '#4ade80' : '#666', fontWeight: 600 }}>
          ${credit.toFixed(2)}
        </span>
      </div>

      {/* Execute button */}
      <button
        onClick={onExecute}
        disabled={!canExecute}
        style={{
          padding: '10px 20px',
          background: canExecute ? '#1a3a1a' : 'transparent',
          border: `1px solid ${canExecute ? '#4ade80' : '#333'}`,
          borderRadius: 4,
          color: canExecute ? '#4ade80' : '#555',
          fontSize: 12,
          fontWeight: 600,
          cursor: canExecute ? 'pointer' : 'not-allowed',
          fontFamily: 'inherit',
          transition: 'all 0.2s ease',
        }}
      >
        [ ENTER: APE IN ]
      </button>
    </div>
  );
}
