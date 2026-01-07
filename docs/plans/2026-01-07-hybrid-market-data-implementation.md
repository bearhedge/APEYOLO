# Hybrid Market Data Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Display accurate SPY/VIX prices on Engine page using IBKR WebSocket for market hours with Yahoo Finance fallback for extended hours.

**Architecture:** Modify existing `/api/broker/stream/snapshot` endpoint to try IBKR first, fall back to existing `yahooFinanceService.ts`. Client adjusts polling rate based on market state.

**Tech Stack:** Express, yahoo-finance2 (already installed), existing IbkrWebSocketManager

---

## Task 1: Add Yahoo Finance fallback to snapshot endpoint

**Files:**
- Modify: `server/routes.ts:1666-1710` (existing snapshot endpoint)

**Step 1: Import Yahoo Finance service**

At top of `server/routes.ts`, add import:

```typescript
import { fetchMarketSnapshot as fetchYahooSnapshot } from "./services/yahooFinanceService.js";
```

**Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: No new errors from import

**Step 3: Replace snapshot endpoint with hybrid logic**

Replace the existing `/api/broker/stream/snapshot` endpoint (lines 1666-1710) with:

```typescript
app.get('/api/broker/stream/snapshot', requireAuth, async (req, res) => {
  try {
    // Determine market state
    const now = new Date();
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hours = et.getHours();
    const minutes = et.getMinutes();
    const day = et.getDay();
    const totalMinutes = hours * 60 + minutes;

    // Market hours: 9:30 AM - 4:00 PM ET (Mon-Fri)
    const marketOpen = 9 * 60 + 30;
    const marketClose = 16 * 60;
    // Extended hours: 4:00 AM - 8:00 PM ET
    const extendedOpen = 4 * 60;
    const extendedClose = 20 * 60;

    let marketState: 'PRE' | 'REGULAR' | 'POST' | 'CLOSED';
    if (day === 0 || day === 6) {
      marketState = 'CLOSED';
    } else if (totalMinutes >= marketOpen && totalMinutes < marketClose) {
      marketState = 'REGULAR';
    } else if (totalMinutes >= extendedOpen && totalMinutes < marketOpen) {
      marketState = 'PRE';
    } else if (totalMinutes >= marketClose && totalMinutes < extendedClose) {
      marketState = 'POST';
    } else {
      marketState = 'CLOSED';
    }

    // Try IBKR WebSocket first during market hours
    if (marketState === 'REGULAR') {
      const wsManager = getIbkrWebSocketManager();
      if (wsManager?.connected) {
        const SPY_CONID = 756733;
        const VIX_CONID = 13455763;
        const spyData = wsManager.getCachedMarketData(SPY_CONID);
        const vixData = wsManager.getCachedMarketData(VIX_CONID);

        if (spyData?.last && spyData.last > 0) {
          return res.json({
            ok: true,
            available: true,
            source: 'ibkr',
            marketState,
            snapshot: {
              spyPrice: spyData.last,
              spyChange: 0, // IBKR WebSocket doesn't provide change
              spyChangePct: 0,
              vix: vixData?.last || 0,
              vixChange: 0,
              vixChangePct: 0,
              timestamp: new Date().toISOString()
            }
          });
        }
      }
    }

    // Fall back to Yahoo Finance for extended hours or when IBKR unavailable
    if (marketState !== 'CLOSED') {
      try {
        const yahoo = await fetchYahooSnapshot();
        return res.json({
          ok: true,
          available: true,
          source: 'yahoo',
          marketState,
          snapshot: {
            spyPrice: yahoo.spy.price,
            spyChange: yahoo.spy.change,
            spyChangePct: yahoo.spy.changePercent,
            vix: yahoo.vix.current,
            vixChange: yahoo.vix.change,
            vixChangePct: yahoo.vix.changePercent,
            timestamp: yahoo.timestamp.toISOString()
          }
        });
      } catch (yahooErr) {
        console.error('[Snapshot] Yahoo Finance fallback failed:', yahooErr);
      }
    }

    // Market closed - no data available
    return res.json({
      ok: true,
      available: false,
      source: 'none',
      marketState,
      message: marketState === 'CLOSED' ? 'Market is closed' : 'No data source available'
    });

  } catch (err: any) {
    console.error('[Snapshot] Error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});
```

**Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS (no errors)

**Step 5: Commit**

```bash
git add server/routes.ts
git commit -m "feat: add Yahoo Finance fallback to market snapshot endpoint"
```

---

## Task 2: Update useMarketSnapshot hook for dynamic polling

**Files:**
- Modify: `client/src/hooks/useMarketSnapshot.ts`

**Step 1: Update MarketSnapshot interface**

Replace the interface with:

```typescript
export interface MarketSnapshot {
  spyPrice: number;
  spyChange: number;
  spyChangePct: number;
  vix: number;
  vixChange: number;
  vixChangePct: number;
  marketState: 'PRE' | 'REGULAR' | 'POST' | 'CLOSED';
  source: 'ibkr' | 'yahoo' | 'none';
  timestamp: string;
}
```

**Step 2: Update fetchSnapshot to use new response format**

Replace the fetchSnapshot callback:

```typescript
const fetchSnapshot = useCallback(async (isInitial = false) => {
  try {
    if (isInitial) {
      setLoading(true);
    }
    setError(null);

    const response = await fetch('/api/broker/stream/snapshot', {
      credentials: 'include',
    });

    if (!response.ok) {
      console.log('[useMarketSnapshot] API error:', response.status);
      setLoading(false);
      return;
    }

    const data = await response.json();

    if (data.ok && data.available && data.snapshot) {
      setSnapshot({
        spyPrice: data.snapshot.spyPrice,
        spyChange: data.snapshot.spyChange || 0,
        spyChangePct: data.snapshot.spyChangePct || 0,
        vix: data.snapshot.vix || 0,
        vixChange: data.snapshot.vixChange || 0,
        vixChangePct: data.snapshot.vixChangePct || 0,
        marketState: data.marketState || 'CLOSED',
        source: data.source || 'none',
        timestamp: data.snapshot.timestamp || new Date().toISOString(),
      });
    } else {
      // Market closed or no data - clear snapshot
      setSnapshot(null);
    }
  } catch (err: any) {
    console.error('[useMarketSnapshot] Error:', err);
    setError(err.message || 'Failed to fetch market snapshot');
  } finally {
    setLoading(false);
  }
}, []);
```

**Step 3: Update polling logic based on market state**

Replace the useEffect:

```typescript
useEffect(() => {
  // Fetch immediately on mount
  fetchSnapshot(true);

  // Determine poll interval based on time of day
  const getPollInterval = () => {
    const now = new Date();
    const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hours = et.getHours();
    const minutes = et.getMinutes();
    const day = et.getDay();
    const totalMinutes = hours * 60 + minutes;

    // Weekend - no polling
    if (day === 0 || day === 6) return null;

    // Market hours (9:30 AM - 4:00 PM): 2 second polling
    const marketOpen = 9 * 60 + 30;
    const marketClose = 16 * 60;
    if (totalMinutes >= marketOpen && totalMinutes < marketClose) {
      return 2000;
    }

    // Extended hours (4:00 AM - 8:00 PM): 15 second polling
    const extendedOpen = 4 * 60;
    const extendedClose = 20 * 60;
    if (totalMinutes >= extendedOpen && totalMinutes < extendedClose) {
      return 15000;
    }

    // Overnight - no polling
    return null;
  };

  const interval = getPollInterval();
  if (!interval) {
    return; // No polling during closed hours
  }

  const pollInterval = setInterval(() => {
    fetchSnapshot(false);
  }, interval);

  return () => clearInterval(pollInterval);
}, [fetchSnapshot]);
```

**Step 4: Remove the old isMarketOpen function**

Delete the `isMarketOpen()` function at the top of the file (lines 21-31) - it's no longer needed.

**Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 6: Commit**

```bash
git add client/src/hooks/useMarketSnapshot.ts
git commit -m "feat: update useMarketSnapshot for hybrid data with dynamic polling"
```

---

## Task 3: Update Engine page to display source and change %

**Files:**
- Modify: Component that displays market snapshot (need to identify)

**Step 1: Find the Engine page component**

Run: `grep -r "useMarketSnapshot" client/src --include="*.tsx" -l`

**Step 2: Update the component to show:**
- SPY price with change % (green/red)
- VIX value with change %
- Source indicator (small badge: "LIVE" or "DELAYED")
- Timestamp

(Specific code depends on existing component structure)

**Step 3: Verify build**

Run: `npm run build`
Expected: PASS

**Step 4: Commit**

```bash
git add client/src/
git commit -m "feat: display source indicator and change % on Engine page"
```

---

## Task 4: Deploy and verify

**Step 1: Deploy to production**

Run: `npm run deploy:prod`
Expected: Successful deployment

**Step 2: Verify with Playwright**

Create test script and run during extended hours to verify Yahoo Finance fallback works.

**Step 3: Final commit (if any cleanup needed)**

```bash
git add .
git commit -m "chore: cleanup after hybrid market data implementation"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add Yahoo Finance fallback to endpoint | server/routes.ts |
| 2 | Update hook for dynamic polling | client/src/hooks/useMarketSnapshot.ts |
| 3 | Update Engine UI for source/change display | client/src/pages/Engine.tsx (TBD) |
| 4 | Deploy and verify | - |
