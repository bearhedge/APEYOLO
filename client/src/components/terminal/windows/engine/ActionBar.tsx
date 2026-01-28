/**
 * ActionBar - Bottom action bar with analyze/execute controls
 *
 * Shows different buttons based on HUD state:
 * - idle: ANALYZE button
 * - analyzing: "Analyzing..." (disabled)
 * - strikes_selected: NEXT button to go to structuring
 * - structuring: BACK + APE IN (APE IN blocked if rails fail)
 * - ready: RESET + APE IN
 */

interface ActionBarProps {
  state: 'idle' | 'analyzing' | 'strikes_selected' | 'structuring' | 'ready';
  onAnalyze: () => void;
  onNext: () => void;
  onBack: () => void;
  onExecute: () => void;
  onReset: () => void;
  isExecuting: boolean;
  canExecute: boolean; // Based on rails validation
}

export function ActionBar({
  state,
  onAnalyze,
  onNext,
  onBack,
  onExecute,
  onReset,
  isExecuting,
  canExecute,
}: ActionBarProps) {
  // Determine main action based on state
  const getMainAction = () => {
    switch (state) {
      case 'idle':
        return { label: 'ANALYZE', handler: onAnalyze, disabled: false };
      case 'analyzing':
        return { label: 'ANALYZING...', handler: () => {}, disabled: true };
      case 'strikes_selected':
        return { label: 'NEXT', handler: onNext, disabled: false };
      case 'structuring':
        return { label: 'BACK', handler: onBack, disabled: false };
      case 'ready':
        return { label: 'RESET', handler: onReset, disabled: false };
      default:
        return { label: 'ANALYZE', handler: onAnalyze, disabled: false };
    }
  };

  const mainAction = getMainAction();

  // APE IN is only enabled in structuring/ready states when canExecute is true
  const showApeIn = state === 'structuring' || state === 'ready';
  const apeInEnabled = showApeIn && canExecute && !isExecuting;

  // NEXT button highlight in strikes_selected state
  const isNextHighlighted = state === 'strikes_selected';

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
      {/* Main action button */}
      <button
        onClick={mainAction.handler}
        disabled={mainAction.disabled}
        style={{
          padding: '8px 24px',
          background: isNextHighlighted ? '#1a2a3a' : 'transparent',
          border: `1px solid ${isNextHighlighted ? '#00ffff' : '#333'}`,
          color: mainAction.disabled ? '#555' : isNextHighlighted ? '#00ffff' : '#888',
          fontSize: 12,
          cursor: mainAction.disabled ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          transition: 'all 0.2s ease',
        }}
      >
        <span style={{ color: isNextHighlighted ? '#00ffff' : '#555' }}>
          {state === 'structuring' ? '\u2190' : '\u25C0'}
        </span>
        <span>{mainAction.label}</span>
        <span style={{ color: isNextHighlighted ? '#00ffff' : '#555' }}>
          {state === 'strikes_selected' ? '\u2192' : '\u25B6'}
        </span>
      </button>

      {/* Execute button - only show in structuring/ready states */}
      {showApeIn ? (
        <button
          onClick={onExecute}
          disabled={!apeInEnabled}
          style={{
            padding: '10px 20px',
            background: apeInEnabled ? '#1a3a1a' : 'transparent',
            border: `1px solid ${apeInEnabled ? '#4ade80' : '#333'}`,
            borderRadius: 4,
            color: apeInEnabled ? '#4ade80' : '#555',
            fontSize: 12,
            fontWeight: 600,
            cursor: apeInEnabled ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit',
            transition: 'all 0.2s ease',
          }}
        >
          {isExecuting ? '[ EXECUTING... ]' : '[ ENTER: APE IN ]'}
        </button>
      ) : (
        // Placeholder to maintain layout
        <div style={{ width: 140 }} />
      )}
    </div>
  );
}
