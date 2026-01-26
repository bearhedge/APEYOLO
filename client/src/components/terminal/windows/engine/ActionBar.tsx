/**
 * ActionBar - Bottom action bar with step-aware controls
 *
 * Step 1: Shows minimal info (strategy selection is in MainArea)
 * Step 2: Shows credit preview
 * Step 3: Hidden (confirmation has APE IN button)
 * Legacy mode: ANALYZE / RESET / APE IN buttons
 */

interface ActionBarProps {
  state: 'idle' | 'analyzing' | 'ready';
  credit: number;
  contracts: number;
  onAnalyze: () => void;
  onExecute: () => void;
  onReset: () => void;
  isExecuting: boolean;
  flowStep?: 1 | 2 | 3;
}

export function ActionBar({
  state,
  credit,
  contracts,
  onAnalyze,
  onExecute,
  onReset,
  isExecuting,
  flowStep = 1,
}: ActionBarProps) {
  // Hide ActionBar during step 3 (confirmation screen has its own APE IN button)
  if (flowStep === 3) {
    return null;
  }

  // Step 2: Show credit preview only
  if (flowStep === 2) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '10px 12px',
          background: '#0a0a0a',
          borderTop: '1px solid #222',
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 13,
        }}
      >
        <div style={{ color: '#888' }}>
          <span style={{ color: '#555' }}>ESTIMATED CREDIT: </span>
          <span style={{ color: credit > 0 ? '#4ade80' : '#666', fontWeight: 600 }}>
            ${credit.toFixed(2)}
          </span>
          <span style={{ color: '#555', marginLeft: 12 }}>
            ({contracts} contracts)
          </span>
        </div>
      </div>
    );
  }

  // Step 1 or legacy mode: Full action bar
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
