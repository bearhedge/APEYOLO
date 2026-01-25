# Terminal Engine HUD Redesign

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform EngineWindow from a 5-step wizard into a single-screen gaming HUD with real-time streaming analysis, keyboard controls, and hacker terminal aesthetics.

**Architecture:** Replace the multi-step wizard with a Bloomberg Terminal-meets-gaming-HUD layout. Single screen showing market data, streaming analysis log, strategy selection, and action bar. Keyboard-driven with MANUAL/AUTO mode toggle.

**Tech Stack:** React 18, TypeScript, Inline styles (terminal aesthetic), Custom hooks for keyboard controls

---

## Current State

**Files involved:**
- `client/src/components/terminal/windows/EngineWindow.tsx` - Current 5-step wizard (902 lines)
- `client/src/hooks/useEngineAnalysis.ts` - Step-by-step analysis hook (563 lines)
- `client/src/App.tsx` - Routing (111 lines)
- `client/src/pages/Engine.tsx` - Standalone engine page (redirects to /trade)

**Current flow:**
1. User sees Step 1 with market data
2. Clicks "ANALYZE MARKET" button
3. Analysis runs through 4 steps silently
4. User manually navigates through wizard pages
5. Selects strikes, risk tier, stop loss
6. Confirms and executes

**Problems:**
- 5 separate wizard steps feel slow
- No real-time feedback during analysis
- Mouse-driven (not keyboard friendly)
- No auto-mode for passive monitoring

---

## The HUD Layout

```
+------------------------------------------------------------------+
|  SPY $587.42 ^+0.34%  |  VIX 16.2  |  * CONNECTED  | AUTO . 2:34 |  <- Top bar
+------------------------------------------------------------------+
|                                                                   |
|  09:31:42 > SCANNING MARKET...                                    |
|  09:31:43   v VIX 16.2 -- low volatility, safe to sell            |
|  09:31:43   v SPY trending sideways, no directional bias          |
|  09:31:44   v IV Rank 34% -- decent premium available             |
|                                                                   |
|  09:31:45 > FINDING STRIKES...                                    |
|  09:31:46   v PUT SPREAD: 580/575 @ $0.72 credit (12d)            |
|  09:31:46   v CALL SPREAD: 595/600 @ $0.68 credit (14d)           |
|  09:31:47   -> IRON CONDOR: $1.40 total credit                    |
|                                                                   |
|  09:31:48 > SIZING POSITION...                                    |
|  09:31:48   Account: $104,797 | Risk: 2% | Contracts: 2           |
|  09:31:49   Max loss: $860 | Max profit: $280                     |
|                                                                   |
|  ============================  READY TO APE IN                    |  <- Main area
|  _                                                                |  <- Blinking cursor
+------------------------------------------------------------------+
|  [1] PUT SPREAD  [2] CALL SPREAD  [3] IRON CONDOR  |  580/575    |  <- Selection bar
+------------------------------------------------------------------+
|  < ANALYZE >           CREDIT: $1.40       [ ENTER: APE IN ]     |  <- Action bar
+------------------------------------------------------------------+
```

---

## Phase 1: Cleanup

### Task 1: Remove Engine.tsx Page

**Files:**
- Delete: `client/src/pages/Engine.tsx`
- Modify: `client/src/App.tsx`

**Step 1: Check current Engine.tsx content**

Read the file to understand what's being deleted and any dependencies.

**Step 2: Update App.tsx to remove Engine import and route**

In `client/src/App.tsx`, remove:

```tsx
// Remove this import
import { Engine } from "@/pages/Engine";

// Remove or update this route (line 82-84)
<Route path="/engine">
  <Redirect to="/trade" />
</Route>
```

Keep the redirect to /trade since that's already there.

**Step 3: Delete Engine.tsx**

```bash
rm client/src/pages/Engine.tsx
```

**Step 4: Verify build**

Run: `cd "/Users/home/Desktop/APE YOLO/APE-YOLO" && npm run build`
Expected: Build succeeds (Engine.tsx wasn't actually used due to redirect)

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove unused Engine.tsx page (redirects to /trade)"
```

---

### Task 2: Delete Engine Components Folder

**Files:**
- Delete: `client/src/components/engine/*` (entire folder)

**Step 1: List current engine components**

```bash
ls -la client/src/components/engine/
```

**Step 2: Verify no imports from EngineWindow**

Check that EngineWindow.tsx doesn't import from the engine components folder:

```bash
grep -r "from.*components/engine" client/src/components/terminal/
```

**Step 3: Delete the engine folder**

```bash
rm -rf client/src/components/engine/
```

**Step 4: Verify build**

Run: `npm run build`
Expected: Build succeeds (Trade.tsx uses these, but we can fix that separately)

Note: If build fails due to Trade.tsx imports, we'll need to update Trade.tsx to not use engine components. The terminal EngineWindow is self-contained.

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove client/src/components/engine/ folder"
```

---

## Phase 2: Layout Rewrite

### Task 3: Create TopBar Component

**Files:**
- Create: `client/src/components/terminal/windows/engine/TopBar.tsx`

**Step 1: Create the engine subfolder**

```bash
mkdir -p client/src/components/terminal/windows/engine
```

**Step 2: Write the TopBar component**

Create `client/src/components/terminal/windows/engine/TopBar.tsx`:

```tsx
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
        {/* SPY */}
        <span>
          <span style={{ color: '#888' }}>SPY </span>
          <span style={{ color: '#fff', fontWeight: 600 }}>${spyPrice.toFixed(2)}</span>
          <span style={{ color: priceColor, marginLeft: 6 }}>
            {spyChangePct >= 0 ? '\u25B2' : '\u25BC'}
            {spyChangePct >= 0 ? '+' : ''}{spyChangePct.toFixed(2)}%
          </span>
        </span>

        {/* VIX */}
        <span>
          <span style={{ color: '#888' }}>VIX </span>
          <span style={{ color: vixColor, fontWeight: 500 }}>{vix.toFixed(1)}</span>
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
```

**Step 3: Verify file created**

```bash
ls -la client/src/components/terminal/windows/engine/TopBar.tsx
```

**Step 4: Commit**

```bash
git add client/src/components/terminal/windows/engine/TopBar.tsx
git commit -m "feat(engine-hud): add TopBar component with market data and mode toggle"
```

---

### Task 4: Create MainArea Component (Streaming Log)

**Files:**
- Create: `client/src/components/terminal/windows/engine/MainArea.tsx`

**Step 1: Write the MainArea component**

Create `client/src/components/terminal/windows/engine/MainArea.tsx`:

```tsx
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
```

**Step 2: Verify file created**

```bash
ls -la client/src/components/terminal/windows/engine/MainArea.tsx
```

**Step 3: Commit**

```bash
git add client/src/components/terminal/windows/engine/MainArea.tsx
git commit -m "feat(engine-hud): add MainArea component with streaming log"
```

---

### Task 5: Create SelectionBar Component

**Files:**
- Create: `client/src/components/terminal/windows/engine/SelectionBar.tsx`

**Step 1: Write the SelectionBar component**

Create `client/src/components/terminal/windows/engine/SelectionBar.tsx`:

```tsx
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
```

**Step 2: Verify file created**

```bash
ls -la client/src/components/terminal/windows/engine/SelectionBar.tsx
```

**Step 3: Commit**

```bash
git add client/src/components/terminal/windows/engine/SelectionBar.tsx
git commit -m "feat(engine-hud): add SelectionBar component for strategy selection"
```

---

### Task 6: Create ActionBar Component

**Files:**
- Create: `client/src/components/terminal/windows/engine/ActionBar.tsx`

**Step 1: Write the ActionBar component**

Create `client/src/components/terminal/windows/engine/ActionBar.tsx`:

```tsx
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
        {contracts > 0 && (
          <span style={{ color: '#555', marginLeft: 8 }}>
            x{contracts}
          </span>
        )}
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
```

**Step 2: Verify file created**

```bash
ls -la client/src/components/terminal/windows/engine/ActionBar.tsx
```

**Step 3: Commit**

```bash
git add client/src/components/terminal/windows/engine/ActionBar.tsx
git commit -m "feat(engine-hud): add ActionBar component with analyze/execute controls"
```

---

### Task 7: Create useKeyboardControls Hook

**Files:**
- Create: `client/src/components/terminal/windows/engine/useKeyboardControls.ts`

**Step 1: Write the keyboard controls hook**

Create `client/src/components/terminal/windows/engine/useKeyboardControls.ts`:

```tsx
/**
 * useKeyboardControls - Keyboard event handling for HUD
 *
 * Controls:
 * [1] [2] [3]    - Select strategy
 * [Arrow keys]  - Adjust strikes/contracts
 * [Tab]         - Toggle AUTO/MANUAL
 * [Enter]       - Execute main action
 * [Esc]         - Cancel/Reset
 * [Space]       - Pause auto-mode
 * [A]           - Analyze now
 * [R]           - Refresh market data
 * [?]           - Show help overlay
 */

import { useEffect, useCallback } from 'react';
import type { Strategy } from './SelectionBar';

interface KeyboardControlsOptions {
  enabled: boolean;
  onStrategyChange: (s: Strategy) => void;
  onStrikeAdjust: (direction: 'wider' | 'tighter') => void;
  onContractAdjust: (direction: 'up' | 'down') => void;
  onModeToggle: () => void;
  onEnter: () => void;
  onEscape: () => void;
  onAnalyze: () => void;
  onRefresh: () => void;
  onShowHelp: () => void;
  onPauseAuto: () => void;
}

export function useKeyboardControls({
  enabled,
  onStrategyChange,
  onStrikeAdjust,
  onContractAdjust,
  onModeToggle,
  onEnter,
  onEscape,
  onAnalyze,
  onRefresh,
  onShowHelp,
  onPauseAuto,
}: KeyboardControlsOptions) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      // Don't capture if user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (e.key) {
        // Strategy selection
        case '1':
          e.preventDefault();
          onStrategyChange('put-spread');
          break;
        case '2':
          e.preventDefault();
          onStrategyChange('call-spread');
          break;
        case '3':
          e.preventDefault();
          onStrategyChange('iron-condor');
          break;

        // Strike adjustment
        case 'ArrowLeft':
          e.preventDefault();
          onStrikeAdjust('tighter');
          break;
        case 'ArrowRight':
          e.preventDefault();
          onStrikeAdjust('wider');
          break;

        // Contract adjustment
        case 'ArrowUp':
          e.preventDefault();
          onContractAdjust('up');
          break;
        case 'ArrowDown':
          e.preventDefault();
          onContractAdjust('down');
          break;

        // Mode toggle
        case 'Tab':
          e.preventDefault();
          onModeToggle();
          break;

        // Actions
        case 'Enter':
          e.preventDefault();
          onEnter();
          break;
        case 'Escape':
          e.preventDefault();
          onEscape();
          break;

        // Quick actions
        case 'a':
        case 'A':
          e.preventDefault();
          onAnalyze();
          break;
        case 'r':
        case 'R':
          e.preventDefault();
          onRefresh();
          break;
        case '?':
          e.preventDefault();
          onShowHelp();
          break;
        case ' ':
          e.preventDefault();
          onPauseAuto();
          break;
      }
    },
    [
      enabled,
      onStrategyChange,
      onStrikeAdjust,
      onContractAdjust,
      onModeToggle,
      onEnter,
      onEscape,
      onAnalyze,
      onRefresh,
      onShowHelp,
      onPauseAuto,
    ]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
```

**Step 2: Verify file created**

```bash
ls -la client/src/components/terminal/windows/engine/useKeyboardControls.ts
```

**Step 3: Commit**

```bash
git add client/src/components/terminal/windows/engine/useKeyboardControls.ts
git commit -m "feat(engine-hud): add useKeyboardControls hook"
```

---

### Task 8: Create Component Index

**Files:**
- Create: `client/src/components/terminal/windows/engine/index.ts`

**Step 1: Write the index file**

Create `client/src/components/terminal/windows/engine/index.ts`:

```tsx
export { TopBar } from './TopBar';
export { MainArea, type LogLine } from './MainArea';
export { SelectionBar, type Strategy } from './SelectionBar';
export { ActionBar } from './ActionBar';
export { useKeyboardControls } from './useKeyboardControls';
```

**Step 2: Verify file created**

```bash
ls -la client/src/components/terminal/windows/engine/index.ts
```

**Step 3: Commit**

```bash
git add client/src/components/terminal/windows/engine/index.ts
git commit -m "feat(engine-hud): add component index exports"
```

---

## Phase 3: Rewrite EngineWindow

### Task 9: Rewrite EngineWindow.tsx with HUD Layout

**Files:**
- Modify: `client/src/components/terminal/windows/EngineWindow.tsx`

**Step 1: Complete rewrite of EngineWindow**

Replace entire content of `client/src/components/terminal/windows/EngineWindow.tsx`:

```tsx
/**
 * EngineWindow - Gaming HUD style trading interface
 *
 * Single-screen layout with:
 * - Top bar: market data, connection, mode
 * - Main area: streaming analysis log
 * - Selection bar: strategy and strikes
 * - Action bar: analyze/execute
 *
 * Keyboard-driven with MANUAL/AUTO modes
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useEngineAnalysis } from '@/hooks/useEngineAnalysis';
import { useMarketSnapshot } from '@/hooks/useMarketSnapshot';
import { useEngine } from '@/hooks/useEngine';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  TopBar,
  MainArea,
  SelectionBar,
  ActionBar,
  useKeyboardControls,
  type LogLine,
  type Strategy,
} from './engine';

type Mode = 'MANUAL' | 'AUTO';

export function EngineWindow() {
  // Mode state
  const [mode, setMode] = useState<Mode>('MANUAL');
  const [autoCountdown, setAutoCountdown] = useState(300); // 5 minutes
  const [showHelp, setShowHelp] = useState(false);

  // Strategy and position state
  const [strategy, setStrategy] = useState<Strategy>('iron-condor');
  const [contracts, setContracts] = useState(2);
  const [putStrike, setPutStrike] = useState<number | null>(null);
  const [callStrike, setCallStrike] = useState<number | null>(null);
  const [spreadWidth, setSpreadWidth] = useState(5);

  // Log lines for streaming display
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [hudState, setHudState] = useState<'idle' | 'analyzing' | 'ready'>('idle');

  // Engine analysis hook
  const {
    analyze,
    isAnalyzing,
    currentStep: engineStep,
    completedSteps,
    analysis,
    error: analysisError,
  } = useEngineAnalysis({
    symbol: 'SPY',
    strategy: strategy === 'put-spread' ? 'put-only' : strategy === 'call-spread' ? 'call-only' : 'strangle',
    riskTier: 'balanced',
  });

  // Broker status
  const { data: ibkrStatus } = useQuery<{
    configured: boolean;
    connected: boolean;
    accountId?: string;
    nav?: number;
  }>({
    queryKey: ['/api/ibkr/status'],
    queryFn: async () => {
      const res = await fetch('/api/ibkr/status', { credentials: 'include' });
      if (!res.ok) return { configured: false, connected: false };
      return res.json();
    },
    refetchInterval: 30000,
  });

  // Market snapshot
  const { snapshot: marketSnapshot } = useMarketSnapshot();

  // Execute trade mutation
  const executeMutation = useMutation({
    mutationFn: async (proposal: any) => {
      const res = await fetch('/api/engine/execute-paper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ tradeProposal: proposal }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to execute trade');
      }
      return res.json();
    },
    onSuccess: () => {
      addLogLine('TRADE EXECUTED SUCCESSFULLY', 'success');
      setHudState('idle');
      setLogLines([]);
    },
    onError: (err) => {
      addLogLine(`ERROR: ${err.message}`, 'info');
    },
  });

  // Derived values
  const spyPrice = marketSnapshot?.spyPrice ?? 0;
  const spyChangePct = marketSnapshot?.spyChangePct ?? 0;
  const vix = marketSnapshot?.vix ?? 0;
  const isConnected = ibkrStatus?.connected ?? false;

  // Calculate credit
  const credit = useMemo(() => {
    if (!analysis?.q3Strikes) return 0;
    const putPremium = analysis.q3Strikes.selectedPut?.premium ?? 0;
    const callPremium = analysis.q3Strikes.selectedCall?.premium ?? 0;

    if (strategy === 'put-spread') return putPremium * contracts;
    if (strategy === 'call-spread') return callPremium * contracts;
    return (putPremium + callPremium) * contracts;
  }, [analysis, strategy, contracts]);

  // Add log line helper
  const addLogLine = useCallback((text: string, type: LogLine['type']) => {
    const now = new Date();
    const timestamp = now.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    setLogLines((prev) => [...prev, { timestamp, text, type }]);
  }, []);

  // Stream analysis steps to log
  useEffect(() => {
    if (isAnalyzing) {
      setHudState('analyzing');
    }

    // Log each step completion
    if (completedSteps.has(1) && !logLines.some((l) => l.text.includes('VIX'))) {
      const vixVal = analysis?.q1MarketRegime?.inputs?.vixValue ?? vix;
      const regime = analysis?.q1MarketRegime?.regimeLabel ?? 'NORMAL';
      addLogLine(`VIX ${vixVal.toFixed(1)} - ${regime.toLowerCase()}, ${regime === 'ELEVATED' ? 'caution advised' : 'safe to trade'}`, 'success');
    }

    if (completedSteps.has(2) && !logLines.some((l) => l.text.includes('bias'))) {
      const direction = analysis?.q2Direction?.recommendedDirection ?? 'NEUTRAL';
      const conf = analysis?.q2Direction?.confidencePct ?? 70;
      addLogLine(`${direction} bias detected (${conf}% confidence)`, 'success');
    }

    if (completedSteps.has(3) && !logLines.some((l) => l.text.includes('SPREAD'))) {
      const putStrikeVal = analysis?.q3Strikes?.selectedPut?.strike;
      const callStrikeVal = analysis?.q3Strikes?.selectedCall?.strike;
      const putDelta = Math.abs(analysis?.q3Strikes?.selectedPut?.delta ?? 0.12);
      const callDelta = Math.abs(analysis?.q3Strikes?.selectedCall?.delta ?? 0.12);

      if (putStrikeVal) {
        setPutStrike(putStrikeVal);
        addLogLine(`PUT SPREAD: ${putStrikeVal}/${putStrikeVal - spreadWidth} @ $${(analysis?.q3Strikes?.selectedPut?.premium ?? 0).toFixed(2)} credit (${(putDelta * 100).toFixed(0)}d)`, 'success');
      }
      if (callStrikeVal) {
        setCallStrike(callStrikeVal);
        addLogLine(`CALL SPREAD: ${callStrikeVal}/${callStrikeVal + spreadWidth} @ $${(analysis?.q3Strikes?.selectedCall?.premium ?? 0).toFixed(2)} credit (${(callDelta * 100).toFixed(0)}d)`, 'success');
      }
      if (putStrikeVal && callStrikeVal) {
        const totalCredit = (analysis?.q3Strikes?.selectedPut?.premium ?? 0) + (analysis?.q3Strikes?.selectedCall?.premium ?? 0);
        addLogLine(`IRON CONDOR: $${totalCredit.toFixed(2)} total credit`, 'result');
      }
    }

    if (completedSteps.has(4) && !logLines.some((l) => l.text.includes('Account'))) {
      const contractCount = analysis?.q4Size?.recommendedContracts ?? contracts;
      const nav = ibkrStatus?.nav ?? 100000;
      const maxLoss = (analysis?.tradeProposal?.maxLoss ?? 0);
      const maxProfit = credit * 100;
      setContracts(contractCount);
      addLogLine(`Account: $${nav.toLocaleString()} | Risk: 2% | Contracts: ${contractCount}`, 'info');
      addLogLine(`Max loss: $${maxLoss.toFixed(0)} | Max profit: $${maxProfit.toFixed(0)}`, 'info');
    }

    // When all steps complete
    if (completedSteps.size >= 4 && !isAnalyzing && hudState === 'analyzing') {
      setHudState('ready');
    }
  }, [completedSteps, isAnalyzing, analysis, hudState, vix, addLogLine, contracts, credit, ibkrStatus?.nav, logLines, spreadWidth]);

  // Start analysis header
  const handleAnalyze = useCallback(() => {
    setLogLines([]);
    setHudState('analyzing');
    addLogLine('SCANNING MARKET...', 'header');
    analyze();
  }, [analyze, addLogLine]);

  // Reset
  const handleReset = useCallback(() => {
    setLogLines([]);
    setHudState('idle');
    setPutStrike(null);
    setCallStrike(null);
  }, []);

  // Execute
  const handleExecute = useCallback(() => {
    if (hudState !== 'ready' || !analysis?.tradeProposal) return;
    executeMutation.mutate(analysis.tradeProposal);
  }, [hudState, analysis, executeMutation]);

  // Mode toggle
  const handleModeToggle = useCallback(() => {
    setMode((m) => (m === 'MANUAL' ? 'AUTO' : 'MANUAL'));
    setAutoCountdown(300);
  }, []);

  // Auto mode countdown
  useEffect(() => {
    if (mode !== 'AUTO') return;

    const interval = setInterval(() => {
      setAutoCountdown((c) => {
        if (c <= 1) {
          // Auto-analyze when countdown hits 0
          if (hudState === 'idle' && isConnected) {
            handleAnalyze();
          }
          return 300; // Reset to 5 minutes
        }
        return c - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [mode, hudState, isConnected, handleAnalyze]);

  // Calculate progress
  const progress = useMemo(() => {
    if (!isAnalyzing) return completedSteps.size >= 4 ? 100 : 0;
    return (engineStep / 5) * 100;
  }, [isAnalyzing, engineStep, completedSteps.size]);

  // Keyboard controls
  useKeyboardControls({
    enabled: true,
    onStrategyChange: setStrategy,
    onStrikeAdjust: (dir) => {
      setSpreadWidth((w) => (dir === 'wider' ? Math.min(w + 1, 10) : Math.max(w - 1, 1)));
    },
    onContractAdjust: (dir) => {
      setContracts((c) => (dir === 'up' ? Math.min(c + 1, 10) : Math.max(c - 1, 1)));
    },
    onModeToggle: handleModeToggle,
    onEnter: hudState === 'ready' ? handleExecute : handleAnalyze,
    onEscape: handleReset,
    onAnalyze: handleAnalyze,
    onRefresh: () => {
      // Refresh is handled by SSE, just add log
      addLogLine('REFRESHING MARKET DATA...', 'header');
    },
    onShowHelp: () => setShowHelp((h) => !h),
    onPauseAuto: () => {
      if (mode === 'AUTO') {
        setMode('MANUAL');
        addLogLine('AUTO MODE PAUSED', 'info');
      }
    },
  });

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#0a0a0a',
        color: '#00ff00',
        fontFamily: "'IBM Plex Mono', 'JetBrains Mono', monospace",
      }}
    >
      {/* Top bar */}
      <TopBar
        spyPrice={spyPrice}
        spyChangePct={spyChangePct}
        vix={vix}
        isConnected={isConnected}
        mode={mode}
        autoCountdown={mode === 'AUTO' ? autoCountdown : undefined}
        onModeToggle={handleModeToggle}
      />

      {/* Main area */}
      <MainArea
        lines={logLines}
        isAnalyzing={isAnalyzing}
        progress={progress}
        isReady={hudState === 'ready'}
      />

      {/* Selection bar */}
      <SelectionBar
        strategy={strategy}
        onStrategyChange={setStrategy}
        putStrike={putStrike}
        callStrike={callStrike}
        putSpread={spreadWidth}
        callSpread={spreadWidth}
      />

      {/* Action bar */}
      <ActionBar
        state={hudState}
        credit={credit}
        contracts={contracts}
        onAnalyze={handleAnalyze}
        onExecute={handleExecute}
        onReset={handleReset}
        isExecuting={executeMutation.isPending}
      />

      {/* Error display */}
      {analysisError && (
        <div
          style={{
            position: 'absolute',
            bottom: 60,
            left: 12,
            right: 12,
            padding: 8,
            background: '#1a0a0a',
            border: '1px solid #ef4444',
            color: '#ef4444',
            fontSize: 12,
          }}
        >
          ERROR: {analysisError}
        </div>
      )}

      {/* Help overlay */}
      {showHelp && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
          onClick={() => setShowHelp(false)}
        >
          <div
            style={{
              padding: 24,
              background: '#111',
              border: '1px solid #333',
              color: '#888',
              fontSize: 13,
              lineHeight: 1.8,
            }}
          >
            <div style={{ color: '#00ffff', marginBottom: 16, fontSize: 14 }}>KEYBOARD SHORTCUTS</div>
            <div>[1] [2] [3] - Select strategy</div>
            <div>[{'\u2190'}] [{'\u2192'}] - Adjust spread width</div>
            <div>[{'\u2191'}] [{'\u2193'}] - Adjust contracts</div>
            <div>[Tab] - Toggle AUTO/MANUAL</div>
            <div>[Enter] - Analyze / Execute</div>
            <div>[Esc] - Reset</div>
            <div>[A] - Analyze now</div>
            <div>[Space] - Pause auto mode</div>
            <div>[?] - Toggle this help</div>
            <div style={{ marginTop: 16, color: '#555', fontSize: 11 }}>Press any key to close</div>
          </div>
        </div>
      )}
    </div>
  );
}
```

**Step 2: Verify the build**

Run: `cd "/Users/home/Desktop/APE YOLO/APE-YOLO" && npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add client/src/components/terminal/windows/EngineWindow.tsx
git commit -m "feat(engine-hud): complete rewrite with gaming HUD layout"
```

---

## Phase 4: Visual Polish

### Task 10: Add HUD CSS Animations

**Files:**
- Modify: `client/src/index.css`

**Step 1: Add HUD-specific animations**

Add to the end of `client/src/index.css`:

```css
/* ==================== ENGINE HUD ANIMATIONS ==================== */

/* Blinking cursor */
@keyframes hud-blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

/* Pulse for AUTO mode indicator */
@keyframes hud-pulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 4px currentColor; }
  50% { opacity: 0.6; box-shadow: 0 0 8px currentColor; }
}

/* Ready state breathing */
@keyframes hud-breathe {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.8; transform: scale(1.02); }
}

/* Selection flash */
@keyframes hud-flash {
  0% { background: rgba(0, 255, 255, 0.3); }
  100% { background: transparent; }
}

/* Progress shimmer */
@keyframes hud-shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(200%); }
}

/* Execute button glow */
@keyframes hud-glow {
  0%, 100% { box-shadow: 0 0 4px rgba(74, 222, 128, 0.4); }
  50% { box-shadow: 0 0 12px rgba(74, 222, 128, 0.8); }
}

/* Error shake */
@keyframes hud-shake {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-4px); }
  40%, 80% { transform: translateX(4px); }
}

/* Screen flash on execute */
@keyframes hud-screen-flash {
  0% { background: rgba(74, 222, 128, 0.2); }
  100% { background: transparent; }
}
```

**Step 2: Verify CSS added**

Run: `tail -40 client/src/index.css`
Expected: See the HUD animation keyframes

**Step 3: Commit**

```bash
git add client/src/index.css
git commit -m "feat(engine-hud): add CSS animations for HUD effects"
```

---

## Phase 5: Testing

### Task 11: Final Testing and Verification

**Files:**
- No changes, verification only

**Step 1: Build the project**

```bash
cd "/Users/home/Desktop/APE YOLO/APE-YOLO" && npm run build
```

Expected: Build succeeds with no errors

**Step 2: Start development server**

```bash
npm run dev
```

**Step 3: Open terminal and test**

1. Navigate to `/terminal`
2. Click to open Engine window (or find it in terminal windows)
3. Verify single-screen HUD layout (no wizard steps)

**Step 4: Test keyboard controls**

| Key | Expected |
|-----|----------|
| 1 | Select PUT SPREAD strategy |
| 2 | Select CALL SPREAD strategy |
| 3 | Select IRON CONDOR strategy |
| Left/Right arrows | Adjust spread width |
| Up/Down arrows | Adjust contracts |
| Tab | Toggle MANUAL/AUTO mode |
| A or Enter (idle) | Start analysis |
| ? | Show keyboard shortcuts overlay |

**Step 5: Test analysis streaming**

1. Press A or Enter to analyze
2. Watch log stream with timestamps and checkmarks
3. See progress bar fill
4. At "READY TO APE IN" state, verify Enter executes

**Step 6: Test AUTO mode**

1. Press Tab to enable AUTO
2. Verify countdown displays (5:00)
3. Verify countdown ticks down
4. Press Space to pause (returns to MANUAL)

**Step 7: Verify no auto-execute**

In AUTO mode, when analysis completes:
- "READY TO APE IN" should display
- Should NOT auto-execute
- User must press Enter to execute

**Step 8: Commit verified state**

```bash
git add -A
git commit -m "feat(engine-hud): complete terminal engine HUD redesign"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Remove Engine.tsx page | `App.tsx`, delete `Engine.tsx` |
| 2 | Delete engine components folder | delete `components/engine/` |
| 3 | Create TopBar component | `engine/TopBar.tsx` |
| 4 | Create MainArea component | `engine/MainArea.tsx` |
| 5 | Create SelectionBar component | `engine/SelectionBar.tsx` |
| 6 | Create ActionBar component | `engine/ActionBar.tsx` |
| 7 | Create keyboard controls hook | `engine/useKeyboardControls.ts` |
| 8 | Create component index | `engine/index.ts` |
| 9 | Rewrite EngineWindow | `EngineWindow.tsx` |
| 10 | Add HUD CSS animations | `index.css` |
| 11 | Final testing | Verification only |

---

## What Changes

**Removed:**
- 5-step wizard UI pattern
- BACK/NEXT navigation buttons
- Separate wizard step components in EngineWindow

**Added:**
- Single-screen HUD layout
- Real-time streaming analysis log with timestamps
- Keyboard controls for all actions
- AUTO/MANUAL mode toggle
- "READY TO APE IN" execution gate
- Hacker terminal aesthetics (scanlines, blinking cursor)
- Help overlay with keyboard shortcuts

**Preserved:**
- All API calls and backend logic
- useEngineAnalysis hook (analysis streaming)
- useMarketSnapshot hook (SSE market data)
- Trade execution via /api/engine/execute-paper
- Broker status checking
