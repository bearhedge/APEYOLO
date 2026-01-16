# Separate Engine from Agent - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the UI crash by completely separating Engine and Agent state management - Engine uses dedicated `useEngineAnalysis` hook that calls `/api/engine/analyze/stream` directly.

**Architecture:** Create a new hook `useEngineAnalysis` that manages Engine-specific state (isAnalyzing, currentStep, analysis). Trade.tsx uses this hook instead of `useAgentOperator`. AgentSidebar keeps its own `useAgentOperator` for chat. No shared state between systems.

**Tech Stack:** React hooks, SSE (EventSource), TypeScript, existing `/api/engine/analyze/stream` endpoint.

---

## Task 1: Create useEngineAnalysis Hook

**Files:**
- Create: `client/src/hooks/useEngineAnalysis.ts`

**Step 1: Create the hook file with types and initial state**

```typescript
/**
 * useEngineAnalysis - Dedicated hook for Engine streaming analysis
 *
 * Completely separate from Agent state. Calls /api/engine/analyze/stream directly.
 * Manages: isAnalyzing, currentStep, completedSteps, analysis result
 */

import { useState, useCallback, useRef } from 'react';
import type { EngineAnalyzeResponse } from '@shared/types/engine';

// Event types from server
interface EngineStreamEvent {
  type: 'start' | 'step_start' | 'step_complete' | 'step_error' | 'complete' | 'error';
  timestamp: number;
  step?: number;
  stepName?: string;
  result?: EngineAnalyzeResponse;
  error?: string;
}

interface UseEngineAnalysisOptions {
  symbol?: string;
  strategy?: 'strangle' | 'put-only' | 'call-only';
  riskTier?: 'conservative' | 'balanced' | 'aggressive';
}

interface UseEngineAnalysisReturn {
  // Actions
  analyze: () => void;
  cancel: () => void;

  // State
  isAnalyzing: boolean;
  currentStep: number;
  completedSteps: Set<number>;
  analysis: EngineAnalyzeResponse | null;
  error: string | null;
}

export function useEngineAnalysis(options: UseEngineAnalysisOptions = {}): UseEngineAnalysisReturn {
  const { symbol = 'SPY', strategy = 'strangle', riskTier = 'balanced' } = options;

  // State
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [analysis, setAnalysis] = useState<EngineAnalyzeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refs for cleanup
  const eventSourceRef = useRef<EventSource | null>(null);

  // Cancel any running analysis
  const cancel = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsAnalyzing(false);
  }, []);

  // Start analysis
  const analyze = useCallback(() => {
    // Cancel any existing analysis
    cancel();

    // Reset state
    setIsAnalyzing(true);
    setCurrentStep(1);
    setCompletedSteps(new Set());
    setAnalysis(null);
    setError(null);

    // Build URL with query params
    const params = new URLSearchParams({
      symbol,
      strategy,
      riskTier,
    });
    const url = `/api/engine/analyze/stream?${params}`;

    console.log('[useEngineAnalysis] Starting analysis:', url);

    // Create EventSource for SSE
    const eventSource = new EventSource(url, { withCredentials: true });
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data: EngineStreamEvent = JSON.parse(event.data);
        console.log('[useEngineAnalysis] Event:', data.type, data.step);

        switch (data.type) {
          case 'start':
            setCurrentStep(1);
            break;

          case 'step_start':
            if (data.step) {
              setCurrentStep(data.step);
            }
            break;

          case 'step_complete':
            if (data.step) {
              setCompletedSteps((prev) => new Set(prev).add(data.step!));
              setCurrentStep(data.step + 1);
            }
            break;

          case 'step_error':
            setError(data.error || `Step ${data.step} failed`);
            break;

          case 'complete':
            if (data.result) {
              setAnalysis(data.result);
            }
            setIsAnalyzing(false);
            eventSource.close();
            eventSourceRef.current = null;
            break;

          case 'error':
            setError(data.error || 'Analysis failed');
            setIsAnalyzing(false);
            eventSource.close();
            eventSourceRef.current = null;
            break;
        }
      } catch (parseError) {
        console.error('[useEngineAnalysis] Parse error:', parseError);
      }
    };

    eventSource.onerror = (err) => {
      console.error('[useEngineAnalysis] SSE error:', err);
      setError('Connection lost');
      setIsAnalyzing(false);
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [symbol, strategy, riskTier, cancel]);

  return {
    analyze,
    cancel,
    isAnalyzing,
    currentStep,
    completedSteps,
    analysis,
    error,
  };
}
```

**Step 2: Verify the file compiles**

Run: `cd "/Users/home/Desktop/APE YOLO/APE-YOLO" && npx tsc --noEmit client/src/hooks/useEngineAnalysis.ts 2>&1 | head -20`
Expected: No errors (or only import path errors which are fine for now)

**Step 3: Commit**

```bash
git add client/src/hooks/useEngineAnalysis.ts
git commit -m "feat: add useEngineAnalysis hook for direct engine streaming"
```

---

## Task 2: Update Trade.tsx

**Files:**
- Modify: `client/src/pages/Trade.tsx`

**Step 1: Replace useAgentOperator with useEngineAnalysis**

```typescript
/**
 * Trade Page - Unified trading interface
 *
 * Combines Engine workflow (center) + Agent sidebar (right).
 * Engine uses useEngineAnalysis (direct API).
 * Agent sidebar uses its own useAgentOperator (separate state).
 */

import { useState, useEffect } from 'react';
import { LeftNav } from '@/components/LeftNav';
import { Engine } from '@/pages/Engine';
import { AgentSidebar } from '@/components/agent/AgentSidebar';
import { useEngineAnalysis } from '@/hooks/useEngineAnalysis';

export function Trade() {
  // Engine analysis - completely separate from Agent
  const {
    analyze,
    isAnalyzing,
    currentStep,
    completedSteps,
    analysis,
    error,
  } = useEngineAnalysis({
    symbol: 'SPY',
    strategy: 'strangle',
    riskTier: 'balanced',
  });

  // Load Agent sidebar collapsed state from localStorage
  const [isAgentCollapsed, setIsAgentCollapsed] = useState(() => {
    const saved = localStorage.getItem('agent-sidebar-collapsed');
    if (saved !== null) return saved === 'true';
    return window.innerWidth < 1280;
  });

  // Persist collapsed state to localStorage
  useEffect(() => {
    localStorage.setItem('agent-sidebar-collapsed', String(isAgentCollapsed));
  }, [isAgentCollapsed]);

  // Auto-collapse on resize (responsive)
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1280 && !isAgentCollapsed) {
        setIsAgentCollapsed(true);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isAgentCollapsed]);

  const toggleAgentSidebar = () => setIsAgentCollapsed(!isAgentCollapsed);

  console.log('[Trade] isAnalyzing:', isAnalyzing, 'currentStep:', currentStep);

  return (
    <div className="flex h-[calc(100vh-64px)]">
      {/* Left Navigation */}
      <LeftNav />

      {/* Engine Workflow (Center) */}
      <div
        className="min-w-0 overflow-hidden"
        style={{ flex: isAgentCollapsed ? '1 0 0' : '55 0 0' }}
      >
        <Engine
          hideLeftNav={true}
          isAnalyzing={isAnalyzing}
          currentStep={currentStep}
          completedSteps={completedSteps}
          streamAnalysis={analysis}
          streamError={error}
          onAnalyze={analyze}
        />
      </div>

      {/* Agent Sidebar (Right) - Uses its own useAgentOperator */}
      <AgentSidebar
        isCollapsed={isAgentCollapsed}
        onToggleCollapse={toggleAgentSidebar}
      />
    </div>
  );
}
```

**Step 2: Verify no TypeScript errors**

Run: `cd "/Users/home/Desktop/APE YOLO/APE-YOLO" && npx tsc --noEmit 2>&1 | head -30`
Expected: May show Engine.tsx prop errors (we'll fix in next task)

**Step 3: Commit**

```bash
git add client/src/pages/Trade.tsx
git commit -m "refactor: Trade.tsx uses useEngineAnalysis instead of useAgentOperator"
```

---

## Task 3: Update Engine.tsx Props Interface

**Files:**
- Modify: `client/src/pages/Engine.tsx`

**Step 1: Update interface to accept new props**

Find and replace the EngineProps interface (around line 29-40):

```typescript
interface EngineProps {
  /** Hide LeftNav when embedded in another page (e.g., Trade page) */
  hideLeftNav?: boolean;
  /** Callback to trigger analysis */
  onAnalyze?: () => void;
  /** Is engine currently analyzing? */
  isAnalyzing?: boolean;
  /** Current step number (1-5) */
  currentStep?: number;
  /** Set of completed step numbers */
  completedSteps?: Set<number>;
  /** Final analysis result from stream */
  streamAnalysis?: any;
  /** Error from stream */
  streamError?: string | null;
}
```

**Step 2: Update function signature**

```typescript
export function Engine({
  hideLeftNav = false,
  onAnalyze,
  isAnalyzing = false,
  currentStep: propCurrentStep,
  completedSteps: propCompletedSteps,
  streamAnalysis,
  streamError,
}: EngineProps = {}) {
```

**Step 3: Remove old activity processing code**

Delete or comment out lines ~52-130 that process `parentActivities` and `parentProposal`. Replace with simpler logic:

```typescript
  // Use props for step tracking when analyzing via streaming
  const streamCurrentStep = propCurrentStep ?? 1;
  const streamCompletedSteps = propCompletedSteps ?? new Set<number>();
  const streamIsRunning = isAnalyzing;
```

**Step 4: Update effectiveAnalysis to use streamAnalysis**

Around line 160, add:

```typescript
  // Merge stream analysis with useEngine analysis
  const effectiveAnalysis = useMemo(() => {
    // Prefer stream analysis when available (from useEngineAnalysis)
    if (streamAnalysis) {
      return streamAnalysis;
    }
    // Fall back to useEngine analysis
    return analysis;
  }, [streamAnalysis, analysis]);
```

**Step 5: Update isLoading to include isAnalyzing**

Find the `isLoading` prop in EngineWizardLayout (around line 448) and ensure it includes `isAnalyzing`:

```typescript
isLoading={isExecuting || loading || isAnalyzing}
```

**Step 6: Verify no TypeScript errors**

Run: `cd "/Users/home/Desktop/APE YOLO/APE-YOLO" && npx tsc --noEmit 2>&1 | head -30`
Expected: No errors

**Step 7: Commit**

```bash
git add client/src/pages/Engine.tsx
git commit -m "refactor: Engine.tsx accepts streaming props from useEngineAnalysis"
```

---

## Task 4: Clean Up Old Debug Logging

**Files:**
- Modify: `client/src/hooks/useAgentOperator.ts` - Remove module-level log
- Modify: `client/src/pages/Trade.tsx` - Clean up any old debug logs

**Step 1: Remove module-level log from useAgentOperator**

Delete line ~12: `console.log('[useAgentOperator] MODULE LOADED - v2');`

**Step 2: Commit**

```bash
git add client/src/hooks/useAgentOperator.ts
git commit -m "cleanup: remove debug logging"
```

---

## Task 5: Deploy and Verify

**Step 1: Deploy to Cloud Run**

```bash
cd "/Users/home/Desktop/APE YOLO/APE-YOLO" && gcloud run deploy apeyolo --source . --region us-central1 --allow-unauthenticated
```

**Step 2: Verify in browser**

1. Open https://apeyolo.com
2. Open DevTools Console
3. Click "Analyze Market"
4. Expected:
   - `[useEngineAnalysis] Starting analysis:` log appears
   - `[useEngineAnalysis] Event: start` appears
   - `[useEngineAnalysis] Event: step_start 1` appears
   - Steps progress: 1 → 2 → 3 → ...
   - No crash
   - Analysis completes with data

**Step 3: Verify Agent sidebar still works**

1. Expand Agent sidebar
2. Type a message in chat
3. Expected: Chat works independently, no interference with Engine

---

## Summary

| Task | Files | Description |
|------|-------|-------------|
| 1 | `client/src/hooks/useEngineAnalysis.ts` | CREATE - New hook for direct engine streaming |
| 2 | `client/src/pages/Trade.tsx` | MODIFY - Use useEngineAnalysis, not useAgentOperator |
| 3 | `client/src/pages/Engine.tsx` | MODIFY - Accept new streaming props |
| 4 | `client/src/hooks/useAgentOperator.ts` | MODIFY - Remove debug logs |
| 5 | Deploy | Verify end-to-end |

**Key Principle:** Engine = Direct API calls (`/api/engine/analyze/stream`). Agent = Chat interface (`/api/agent/operate`). Never mix state.
