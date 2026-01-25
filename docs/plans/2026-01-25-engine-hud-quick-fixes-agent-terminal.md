# Engine HUD: Quick Fixes + Agent Terminal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix immediate bugs (STRANGLE label, R key spam, credit display) and wire the HUD into the agent system so hotkeys/commands trigger real AI-powered analysis.

**Architecture:** Three quick fixes to existing components, then integrate `useAgentOperator` hook into EngineWindow. Add V/M/P/A hotkeys that map to agent operations. Create CommandInput component for typed commands. Stream agent SSE events to log lines.

**Tech Stack:** React, TypeScript, TanStack Query, SSE streaming via `useAgentOperator`

---

## Phase 1: Quick Fixes

### Task 1: Verify STRANGLE Label

**Files:**
- Verify: `client/src/components/terminal/windows/engine/SelectionBar.tsx:30-32`

**Step 1: Read and verify the label**

The file at line 30-32 already shows:
```typescript
const strategies: { key: Strategy; label: string; shortcut: string }[] = [
  { key: 'put-spread', label: 'PUT', shortcut: '1' },
  { key: 'call-spread', label: 'CALL', shortcut: '2' },
  { key: 'strangle', label: 'STRANGLE', shortcut: '3' },
];
```

This is already correct - says `'STRANGLE'` not `'IRON CONDOR'`.

**Step 2: Confirm no changes needed**

No code changes required. Label is correct.

---

### Task 2: Remove R Key Spam

**Files:**
- Modify: `client/src/components/terminal/windows/EngineWindow.tsx:272-275`
- Modify: `client/src/components/terminal/windows/engine/useKeyboardControls.ts:28,117-119`

**Step 1: Remove onRefresh callback from EngineWindow**

In `EngineWindow.tsx`, find lines 272-275:
```typescript
onRefresh: () => {
  // Refresh is handled by SSE, just add log
  addLogLine('REFRESHING MARKET DATA...', 'header');
},
```

Replace with:
```typescript
onRefresh: () => {
  // R key reserved for future agent commands
},
```

**Step 2: Run build to verify no errors**

Run: `cd /Users/home/APE-YOLO && npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
cd /Users/home/APE-YOLO && git add client/src/components/terminal/windows/EngineWindow.tsx && git commit -m "$(cat <<'EOF'
fix: remove R key spam in Engine HUD

R key no longer logs "REFRESHING MARKET DATA..." on every press.
Reserved for future agent commands.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Simplify Credit Display

**Files:**
- Modify: `client/src/components/terminal/windows/engine/ActionBar.tsx:74-78`

**Step 1: Remove contract multiplier from credit display**

In `ActionBar.tsx`, find lines 74-78:
```typescript
{contracts > 0 && (
  <span style={{ color: '#555', marginLeft: 8 }}>
    x{contracts}
  </span>
)}
```

Delete these 4 lines entirely. The credit display should just show `CREDIT: $X.XX`.

**Step 2: Run build to verify**

Run: `cd /Users/home/APE-YOLO && npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
cd /Users/home/APE-YOLO && git add client/src/components/terminal/windows/engine/ActionBar.tsx && git commit -m "$(cat <<'EOF'
fix: simplify credit display in Engine HUD

Removed x{contracts} multiplier from credit display.
Now shows clean "CREDIT: $X.XX" format.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2: Agent Integration

### Task 4: Add Agent Command Type Definitions

**Files:**
- Modify: `client/src/components/terminal/windows/EngineWindow.tsx` (add at top after imports)

**Step 1: Add command mapping type**

After the imports in `EngineWindow.tsx`, add:
```typescript
// Agent command mapping
type AgentCommand = '/vix' | '/market' | '/positions' | '/analyze' | '/help';

const AGENT_COMMANDS: Record<AgentCommand, { operation: 'analyze' | 'positions'; params?: { focus?: string } }> = {
  '/vix': { operation: 'analyze', params: { focus: 'vix' } },
  '/market': { operation: 'analyze', params: { focus: 'market' } },
  '/positions': { operation: 'positions' },
  '/analyze': { operation: 'analyze' },
  '/help': { operation: 'analyze' }, // Will be handled specially
};
```

**Step 2: Run build to verify**

Run: `cd /Users/home/APE-YOLO && npm run build`
Expected: Build succeeds

---

### Task 5: Import useAgentOperator Hook

**Files:**
- Modify: `client/src/components/terminal/windows/EngineWindow.tsx:14`

**Step 1: Add import for useAgentOperator**

After line 14 (`import { useEngineAnalysis } from '@/hooks/useEngineAnalysis';`), add:
```typescript
import { useAgentOperator } from '@/hooks/useAgentOperator';
```

**Step 2: Run build to verify**

Run: `cd /Users/home/APE-YOLO && npm run build`
Expected: Build succeeds

---

### Task 6: Initialize useAgentOperator in EngineWindow

**Files:**
- Modify: `client/src/components/terminal/windows/EngineWindow.tsx` (inside EngineWindow function)

**Step 1: Add agent operator hook initialization**

After the `useEngineAnalysis` hook call (around line 58), add:
```typescript
// Agent operator for AI-powered commands
const {
  operate: agentOperate,
  activities: agentActivities,
  isProcessing: agentProcessing,
} = useAgentOperator({ enableStatusPolling: false });
```

**Step 2: Run build to verify**

Run: `cd /Users/home/APE-YOLO && npm run build`
Expected: Build succeeds

---

### Task 7: Add Agent Activity to Log Lines Effect

**Files:**
- Modify: `client/src/components/terminal/windows/EngineWindow.tsx` (add new useEffect)

**Step 1: Add effect to convert agent activities to log lines**

After the existing analysis streaming effect (around line 200), add:
```typescript
// Stream agent activities to log
useEffect(() => {
  if (agentActivities.length === 0) return;

  // Get the most recent activity
  const latest = agentActivities[agentActivities.length - 1];

  // Skip if we've already logged this activity
  if (loggedSteps.has(`agent_${latest.id}`)) return;

  // Map agent activity types to log line types
  const typeMap: Record<string, LogLine['type']> = {
    action: 'header',
    thinking: 'info',
    result: 'success',
    tool_progress: 'success',
    info: 'info',
    error: 'error',
  };

  const logType = typeMap[latest.type] || 'info';
  addLogLine(latest.content, logType);
  setLoggedSteps(prev => new Set([...prev, `agent_${latest.id}`]));
}, [agentActivities, loggedSteps, addLogLine]);
```

**Step 2: Run build to verify**

Run: `cd /Users/home/APE-YOLO && npm run build`
Expected: Build succeeds

---

### Task 8: Add Agent Command Handler

**Files:**
- Modify: `client/src/components/terminal/windows/EngineWindow.tsx` (add new callback)

**Step 1: Add handleAgentCommand callback**

After the `handleReset` callback (around line 218), add:
```typescript
// Handle agent commands (V, M, P hotkeys or typed /commands)
const handleAgentCommand = useCallback((command: AgentCommand) => {
  if (agentProcessing) return;

  // Handle /help specially
  if (command === '/help') {
    setLogLines([]);
    setLoggedSteps(new Set());
    addLogLine('AVAILABLE COMMANDS', 'header');
    addLogLine('/vix - VIX analysis and volatility regime', 'info');
    addLogLine('/market - Full market snapshot', 'info');
    addLogLine('/positions - Current holdings', 'info');
    addLogLine('/analyze - Full 5-step analysis', 'info');
    addLogLine('Press V, M, P, A for quick access', 'info');
    return;
  }

  const config = AGENT_COMMANDS[command];
  if (!config) return;

  // Clear log and start agent operation
  setLogLines([]);
  setLoggedSteps(new Set());
  setHudState('analyzing');
  addLogLine(`Running ${command.slice(1).toUpperCase()}...`, 'header');

  agentOperate(config.operation, { message: config.params?.focus });
}, [agentProcessing, agentOperate, addLogLine]);
```

**Step 2: Run build to verify**

Run: `cd /Users/home/APE-YOLO && npm run build`
Expected: Build succeeds

---

### Task 9: Add V/M/P Hotkeys to useKeyboardControls Interface

**Files:**
- Modify: `client/src/components/terminal/windows/engine/useKeyboardControls.ts:19-31`

**Step 1: Add new callback types to interface**

In `useKeyboardControls.ts`, update the interface (lines 19-31):
```typescript
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
  // Agent command hotkeys
  onVix?: () => void;
  onMarket?: () => void;
  onPositions?: () => void;
}
```

**Step 2: Run build to verify**

Run: `cd /Users/home/APE-YOLO && npm run build`
Expected: Build succeeds

---

### Task 10: Add V/M/P Hotkeys to useKeyboardControls Hook

**Files:**
- Modify: `client/src/components/terminal/windows/engine/useKeyboardControls.ts:33-45,114-127,130-142`

**Step 1: Add new parameters to hook destructuring**

Update the function parameters (lines 33-45):
```typescript
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
  onVix,
  onMarket,
  onPositions,
}: KeyboardControlsOptions) {
```

**Step 2: Add V/M/P key handlers**

After the `case ' ':` block (around line 127), add before the closing bracket:
```typescript
        // Agent command hotkeys
        case 'v':
        case 'V':
          e.preventDefault();
          onVix?.();
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          onMarket?.();
          break;
        case 'p':
        case 'P':
          e.preventDefault();
          onPositions?.();
          break;
```

**Step 3: Add to dependency array**

Update the dependency array (lines 130-142) to include the new callbacks:
```typescript
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
      onVix,
      onMarket,
      onPositions,
    ]
```

**Step 4: Run build to verify**

Run: `cd /Users/home/APE-YOLO && npm run build`
Expected: Build succeeds

---

### Task 11: Wire V/M/P Hotkeys in EngineWindow

**Files:**
- Modify: `client/src/components/terminal/windows/EngineWindow.tsx:259-283`

**Step 1: Add agent hotkey handlers to useKeyboardControls call**

Update the `useKeyboardControls` call (around line 259) to add the new handlers:
```typescript
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
    // R key reserved for future agent commands
  },
  onShowHelp: () => setShowHelp((h) => !h),
  onPauseAuto: () => {
    if (mode === 'AUTO') {
      setMode('MANUAL');
      addLogLine('AUTO MODE PAUSED', 'info');
    }
  },
  // Agent command hotkeys
  onVix: () => handleAgentCommand('/vix'),
  onMarket: () => handleAgentCommand('/market'),
  onPositions: () => handleAgentCommand('/positions'),
});
```

**Step 2: Run build to verify**

Run: `cd /Users/home/APE-YOLO && npm run build`
Expected: Build succeeds

**Step 3: Commit Phase 2 progress**

```bash
cd /Users/home/APE-YOLO && git add -A && git commit -m "$(cat <<'EOF'
feat: integrate agent operator with Engine HUD

- Add useAgentOperator hook to EngineWindow
- Add V/M/P hotkeys for quick agent commands
- Stream agent activities to HUD log
- Add handleAgentCommand for /vix, /market, /positions, /help

Hotkey mappings:
- V = /vix (VIX analysis)
- M = /market (market snapshot)
- P = /positions (current holdings)
- A = /analyze (full analysis - existing)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3: Command Input

### Task 12: Create CommandInput Component

**Files:**
- Create: `client/src/components/terminal/windows/engine/CommandInput.tsx`

**Step 1: Write the CommandInput component**

Create new file `CommandInput.tsx`:
```typescript
/**
 * CommandInput - Terminal-style command input for agent commands
 *
 * Features:
 * - Type /vix, /market, /positions, /analyze, /help
 * - Natural language queries
 * - Enter to submit
 * - Command history (up/down arrows)
 */

import { useState, useCallback, useRef, useEffect } from 'react';

interface CommandInputProps {
  onCommand: (command: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function CommandInput({ onCommand, disabled, placeholder = '/help' }: CommandInputProps) {
  const [value, setValue] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;

    // Add to history (avoid duplicates at end)
    if (history[history.length - 1] !== trimmed) {
      setHistory(prev => [...prev.slice(-19), trimmed]); // Keep last 20
    }
    setHistoryIndex(-1);

    onCommand(trimmed);
    setValue('');
  }, [value, disabled, history, onCommand]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      const newIndex = historyIndex < history.length - 1 ? historyIndex + 1 : historyIndex;
      setHistoryIndex(newIndex);
      setValue(history[history.length - 1 - newIndex] || '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex <= 0) {
        setHistoryIndex(-1);
        setValue('');
      } else {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setValue(history[history.length - 1 - newIndex] || '');
      }
    }
  }, [handleSubmit, history, historyIndex]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '8px 12px',
        borderTop: '1px solid #222',
        background: '#0a0a0a',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 13,
      }}
    >
      <span style={{ color: '#00ffff', marginRight: 8 }}>&gt;</span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        style={{
          flex: 1,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: '#fff',
          fontSize: 13,
          fontFamily: 'inherit',
          caretColor: '#00ff00',
        }}
      />
      {value && (
        <span
          style={{
            color: '#555',
            fontSize: 11,
            marginLeft: 8,
          }}
        >
          ENTER
        </span>
      )}
    </div>
  );
}
```

**Step 2: Run build to verify**

Run: `cd /Users/home/APE-YOLO && npm run build`
Expected: Build succeeds

---

### Task 13: Export CommandInput from Index

**Files:**
- Modify: `client/src/components/terminal/windows/engine/index.ts`

**Step 1: Add CommandInput export**

Add to `index.ts`:
```typescript
export { CommandInput } from './CommandInput';
```

The full file should now be:
```typescript
export { TopBar } from './TopBar';
export { MainArea, type LogLine } from './MainArea';
export { SelectionBar, type Strategy } from './SelectionBar';
export { ActionBar } from './ActionBar';
export { useKeyboardControls } from './useKeyboardControls';
export { CommandInput } from './CommandInput';
```

**Step 2: Run build to verify**

Run: `cd /Users/home/APE-YOLO && npm run build`
Expected: Build succeeds

---

### Task 14: Add CommandInput to EngineWindow Import

**Files:**
- Modify: `client/src/components/terminal/windows/EngineWindow.tsx:17-24`

**Step 1: Add CommandInput to imports**

Update the import block (lines 17-24):
```typescript
import {
  TopBar,
  MainArea,
  SelectionBar,
  ActionBar,
  CommandInput,
  useKeyboardControls,
  type LogLine,
  type Strategy,
} from './engine';
```

**Step 2: Run build to verify**

Run: `cd /Users/home/APE-YOLO && npm run build`
Expected: Build succeeds

---

### Task 15: Add handleCommandInput Handler

**Files:**
- Modify: `client/src/components/terminal/windows/EngineWindow.tsx` (add after handleAgentCommand)

**Step 1: Add command input handler**

After `handleAgentCommand` callback, add:
```typescript
// Handle typed command input (including natural language)
const handleCommandInput = useCallback((input: string) => {
  // Check if it's a known command
  const command = input.toLowerCase() as AgentCommand;
  if (AGENT_COMMANDS[command]) {
    handleAgentCommand(command);
    return;
  }

  // Treat as natural language query
  if (!agentProcessing) {
    setLogLines([]);
    setLoggedSteps(new Set());
    setHudState('analyzing');
    addLogLine(`Query: ${input}`, 'header');
    agentOperate('analyze', { message: input });
  }
}, [handleAgentCommand, agentProcessing, agentOperate, addLogLine]);
```

**Step 2: Run build to verify**

Run: `cd /Users/home/APE-YOLO && npm run build`
Expected: Build succeeds

---

### Task 16: Render CommandInput in EngineWindow

**Files:**
- Modify: `client/src/components/terminal/windows/EngineWindow.tsx` (in JSX, between MainArea and SelectionBar)

**Step 1: Add CommandInput between MainArea and SelectionBar**

In the JSX return, after `</MainArea>` (around line 314), add:
```typescript
{/* Command input */}
<CommandInput
  onCommand={handleCommandInput}
  disabled={agentProcessing || isAnalyzing}
  placeholder={agentProcessing ? 'Processing...' : '/help for commands'}
/>
```

**Step 2: Run build to verify**

Run: `cd /Users/home/APE-YOLO && npm run build`
Expected: Build succeeds

**Step 3: Commit Phase 3**

```bash
cd /Users/home/APE-YOLO && git add -A && git commit -m "$(cat <<'EOF'
feat: add CommandInput for typed agent commands

- Create CommandInput component with command history
- Parse /vix, /market, /positions, /analyze, /help
- Support natural language queries
- Render between MainArea and SelectionBar

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: Update Help Overlay with Agent Commands

**Files:**
- Modify: `client/src/components/terminal/windows/EngineWindow.tsx:337-374`

**Step 1: Update help overlay content**

Update the help overlay content (around lines 360-370) to include agent commands:
```typescript
<div style={{ color: '#00ffff', marginBottom: 16, fontSize: 14 }}>KEYBOARD SHORTCUTS</div>
<div style={{ color: '#888', marginBottom: 8 }}>TRADING</div>
<div>[1] [2] [3] - Select strategy</div>
<div>[{'\u2190'}] [{'\u2192'}] - Adjust spread width</div>
<div>[{'\u2191'}] [{'\u2193'}] - Adjust contracts</div>
<div>[Tab] - Toggle AUTO/MANUAL</div>
<div>[Enter] - Analyze / Execute</div>
<div>[Esc] - Reset</div>
<div>[A] - Analyze now</div>
<div>[Space] - Pause auto mode</div>
<div style={{ color: '#888', marginTop: 12, marginBottom: 8 }}>AGENT COMMANDS</div>
<div>[V] - VIX analysis</div>
<div>[M] - Market snapshot</div>
<div>[P] - Current positions</div>
<div style={{ color: '#555', marginTop: 12 }}>Type /help in command bar for more</div>
<div style={{ marginTop: 16, color: '#555', fontSize: 11 }}>Press any key to close</div>
```

**Step 2: Run build to verify**

Run: `cd /Users/home/APE-YOLO && npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
cd /Users/home/APE-YOLO && git add -A && git commit -m "$(cat <<'EOF'
docs: update help overlay with agent commands

Added V/M/P hotkey documentation and command bar hint.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Verification

### Task 18: Manual Testing Checklist

**Step 1: Start dev server**

Run: `cd /Users/home/APE-YOLO && npm run dev`

**Step 2: Verify quick fixes**

1. Open browser to `http://localhost:5000/terminal`
2. Click Engine window to open
3. Verify STRANGLE button shows "STRANGLE" (not "IRON CONDOR")
4. Press R key - verify no "REFRESHING MARKET DATA..." spam in log
5. Run analysis - verify credit shows `CREDIT: $X.XX` without `x{contracts}`

**Step 3: Verify agent hotkeys**

1. Press V - should see "Running VIX..." and agent activity stream
2. Press M - should see "Running MARKET..." and agent activity stream
3. Press P - should see "Running POSITIONS..." and agent activity stream
4. Press ? - should see updated help overlay with agent commands section

**Step 4: Verify command input**

1. Click in command input field
2. Type `/help` and press Enter - should show available commands
3. Type `/vix` and press Enter - should trigger VIX analysis
4. Type `what's the best delta right now?` and press Enter - should send as natural language query
5. Press Up arrow - should recall previous command

**Step 5: Final commit**

```bash
cd /Users/home/APE-YOLO && git add -A && git commit -m "$(cat <<'EOF'
feat: Engine HUD quick fixes + agent terminal complete

Quick Fixes:
- Verified STRANGLE label (already correct)
- Removed R key spam
- Simplified credit display (removed x{contracts})

Agent Integration:
- V/M/P hotkeys trigger agent operations
- CommandInput for typed commands
- Natural language query support
- Agent activities stream to HUD log

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Verify STRANGLE label | SelectionBar.tsx |
| 2 | Remove R key spam | EngineWindow.tsx |
| 3 | Simplify credit display | ActionBar.tsx |
| 4 | Add command type definitions | EngineWindow.tsx |
| 5 | Import useAgentOperator | EngineWindow.tsx |
| 6 | Initialize useAgentOperator | EngineWindow.tsx |
| 7 | Add agent activity to log effect | EngineWindow.tsx |
| 8 | Add agent command handler | EngineWindow.tsx |
| 9 | Add V/M/P to interface | useKeyboardControls.ts |
| 10 | Add V/M/P key handlers | useKeyboardControls.ts |
| 11 | Wire V/M/P in EngineWindow | EngineWindow.tsx |
| 12 | Create CommandInput | CommandInput.tsx (new) |
| 13 | Export CommandInput | index.ts |
| 14 | Import CommandInput | EngineWindow.tsx |
| 15 | Add command input handler | EngineWindow.tsx |
| 16 | Render CommandInput | EngineWindow.tsx |
| 17 | Update help overlay | EngineWindow.tsx |
| 18 | Manual testing | N/A |
