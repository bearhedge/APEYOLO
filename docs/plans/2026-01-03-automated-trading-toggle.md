# Automated Trading Toggle Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a toggle in Engine page settings to enable/disable the scheduled 11:00 AM trade-engine job.

**Architecture:** Use existing job enable/disable infrastructure. Fetch trade-engine job status on page load, display toggle, update via PUT /api/jobs/trade-engine endpoint.

**Tech Stack:** React (frontend toggle), existing Express routes, existing Drizzle jobs table

---

### Task 1: Add Trade Engine Job Status Hook

**Files:**
- Create: `client/src/hooks/useTradeEngineJob.ts`

**Step 1: Create the hook file**

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface TradeEngineJob {
  id: string;
  name: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  schedule: string;
}

interface JobResponse {
  ok: boolean;
  job: TradeEngineJob;
}

async function fetchTradeEngineJob(): Promise<TradeEngineJob> {
  const response = await fetch('/api/jobs/trade-engine', {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error('Failed to fetch trade-engine job');
  }
  const data: JobResponse = await response.json();
  return data.job;
}

async function setTradeEngineEnabled(enabled: boolean): Promise<TradeEngineJob> {
  const response = await fetch('/api/jobs/trade-engine', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) {
    throw new Error('Failed to update trade-engine job');
  }
  const data: JobResponse = await response.json();
  return data.job;
}

export function useTradeEngineJob() {
  const queryClient = useQueryClient();

  const { data: job, isLoading, error } = useQuery({
    queryKey: ['trade-engine-job'],
    queryFn: fetchTradeEngineJob,
    staleTime: 30000,
  });

  const mutation = useMutation({
    mutationFn: setTradeEngineEnabled,
    onSuccess: (updatedJob) => {
      queryClient.setQueryData(['trade-engine-job'], updatedJob);
    },
  });

  return {
    job,
    isLoading,
    error,
    isEnabled: job?.enabled ?? false,
    setEnabled: mutation.mutate,
    isUpdating: mutation.isPending,
  };
}
```

**Step 2: Verify file created**

Run: `ls -la client/src/hooks/useTradeEngineJob.ts`
Expected: File exists

**Step 3: Commit**

```bash
git add client/src/hooks/useTradeEngineJob.ts
git commit -m "feat: add useTradeEngineJob hook for automation toggle"
```

---

### Task 2: Add Automation Toggle to Engine Page

**Files:**
- Modify: `client/src/pages/Engine.tsx`

**Step 1: Add import for the new hook**

At top of file, add:
```typescript
import { useTradeEngineJob } from '@/hooks/useTradeEngineJob';
```

**Step 2: Use the hook in the component**

Inside the `Engine` component function, after existing hooks (around line 50), add:
```typescript
  // Automation toggle - controls scheduled 11:00 AM trade-engine job
  const { isEnabled: automationEnabled, setEnabled: setAutomationEnabled, isUpdating: isUpdatingAutomation } = useTradeEngineJob();
```

**Step 3: Find the settings section in the JSX**

Search for the Risk Tier, Stop Multiplier, Strategy dropdowns in the JSX. They are in a grid layout. Add the automation toggle after the Strategy dropdown.

**Step 4: Add the toggle UI after Strategy dropdown**

Add this after the Strategy `<select>` wrapper div:
```tsx
            {/* Automation Toggle */}
            <div>
              <label className="block text-xs text-silver/70 mb-1">Automation</label>
              <button
                onClick={() => setAutomationEnabled(!automationEnabled)}
                disabled={isUpdatingAutomation}
                className={`w-full px-3 py-2 rounded text-sm font-medium transition-colors ${
                  automationEnabled
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-zinc-800 text-silver/70 border border-white/10'
                } ${isUpdatingAutomation ? 'opacity-50 cursor-wait' : 'hover:bg-white/5'}`}
              >
                {isUpdatingAutomation ? 'Updating...' : automationEnabled ? '11:00 AM Auto' : 'Manual Only'}
              </button>
            </div>
```

**Step 5: Verify TypeScript compiles**

Run: `cd client && npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add client/src/pages/Engine.tsx
git commit -m "feat: add automation toggle to Engine page settings"
```

---

### Task 3: Test End-to-End

**Step 1: Start dev server**

Run: `npm run dev`
Expected: Server starts without errors

**Step 2: Open Engine page in browser**

Navigate to: http://localhost:3000/engine
Expected: Page loads, see "Automation" toggle in settings section

**Step 3: Test toggle functionality**

1. Click the toggle - should show "Updating..." briefly
2. State should flip between "11:00 AM Auto" and "Manual Only"
3. Refresh page - state should persist

**Step 4: Verify API call works**

Check browser DevTools Network tab:
- PUT request to /api/jobs/trade-engine with { enabled: true/false }
- Response 200 OK

**Step 5: Deploy to production**

Run: `npm run deploy:prod`
Expected: Deployment succeeds

---

### Task 4: Cleanup (Optional)

**Step 1: Remove any unused imports**

Check Engine.tsx for unused imports and remove them.

**Step 2: Final commit**

```bash
git add -A
git commit -m "chore: cleanup automation toggle implementation"
```
