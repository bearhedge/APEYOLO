# APEYOLO Session Context

**Purpose**: Enables Claude Code to resume work across sessions with full context.

---

## CURRENT SESSION (2025-12-05/06)

### What Was Fixed Today

#### 1. Engine Log Redesign (COMPLETED)
- Added Q&A reasoning format to all 5 steps
- Added timeline bar with bottleneck highlighting
- Added metrics section with status indicators
- Added nearby strikes table for Step 3
- Removed emojis, clean monospace terminal style
- Fixed UI cutoff by changing to flex layout with overflow-y-auto

#### 2. VIX Source Switch (COMPLETED)
- Changed VIX data source from Yahoo Finance to IBKR for consistency
- Updated reasoning to show "from IBKR"

#### 3. Time Display Bug (COMPLETED)
- Fixed timezone bug showing wrong time (was 7:29 AM, should be 12:30 PM)
- Root cause: `new Date(toLocaleString())` loses timezone info on Cloud Run
- Fix: Use `getETTimeComponents()` directly instead

#### 4. IBKR Market Data Priming (COMPLETED)
- Added `primeMarketData()` method to ibkr.ts
- IBKR requires first call to "subscribe", subsequent calls return actual data
- Now primes SPY/VIX during `ensureReady()`
- Increased retry delay from 500ms to 1500ms

#### 5. Missing exchange=SMART Parameter (COMPLETED)
- **ROOT CAUSE OF EMPTY STRIKES**: All 3 calls to `/iserver/secdef/strikes` were missing `exchange=SMART`
- Fixed in 3 locations:
  - Line 1090 in `getOptionChain()`
  - Line 1405 in `getOptionChainWithStrikes()`
  - Lines 2119-2123 in `resolveOptionConid()`
- Per IBKR docs: `GET /v1/api/iserver/secdef/strikes?conid=265598&exchange=SMART&sectype=OPT&month=OCT24`

#### 6. Trading Window Disabled (TEMPORARY)
- `isWithinTradingHours()` now always returns `true`
- Original code commented out with TODO to re-enable
- This allows testing at any time until trade execution is working

### Current Issue (NEEDS FIX)

**Trading Window UI still shows "Closed"** even though backend returns `withinTradingWindow: true`.

The header shows "Trading Window: Closed" and "Trading only allowed between 11:00 AM and 1:00 PM ET" even though:
- Backend Step 1 returns withinTradingWindow: true
- Time shows 1:09 PM (within window even if it wasn't disabled)

**Root cause**: There's likely a separate frontend check in `Engine.tsx` or `adapter.ts` that still enforces the trading window check.

**Files to investigate**:
- `client/src/pages/Engine.tsx` - May have frontend trading window check
- `server/engine/adapter.ts` - Has `getTradingWindowStatus()` function at line 496

---

## FILES MODIFIED TODAY

| File | Changes |
|------|---------|
| `server/engine/step1.ts` | VIX attribution "from IBKR", time display fix, trading window disabled |
| `server/broker/ibkr.ts` | Added `primeMarketData()`, added `exchange=SMART` to 3 strikes URLs |
| `server/services/marketDataService.ts` | Switched VIX to IBKR, increased retry delay to 1500ms |
| `client/src/components/EngineLog.tsx` | Redesigned with Q&A reasoning, timeline, flex layout |
| `client/src/pages/Engine.tsx` | Removed Trading Decision box |
| `shared/types/engineLog.ts` | Added `reason` field to summary |
| `server/engine/index.ts` | Populate reason in enhancedLog summary |

---

## KEY IBKR FINDINGS

### Market Data Priming
IBKR Client Portal API requires "priming" - first snapshot call subscribes to data, subsequent calls return actual values. Need ~1.5s delay between calls.

### Strikes Endpoint
**MUST include `exchange=SMART`** parameter:
```
GET /v1/api/iserver/secdef/strikes?conid=756733&exchange=SMART&sectype=OPT&month=DEC25
```

Without it, API returns HTTP 200 with empty arrays `{"call":[],"put":[]}`.

### Option Greeks
Real Greeks (delta, gamma, theta, vega, IV) are available during market hours via field codes:
- 7308 = delta
- 7309 = gamma
- 7310 = theta
- 7633 = vega
- 7283 = IV
- 7311 = open interest

Off-hours: Greeks are estimated using `estimateDeltaFromMoneyness()`.

---

## ENGINE 5-STEP STATUS

| Step | Name | Status | Notes |
|------|------|--------|-------|
| 1 | Market Regime | WORKING | VIX from IBKR, SPY from IBKR, time fixed |
| 2 | Direction | WORKING | MA calculation, trend detection |
| 3 | Strike Selection | NEEDS TEST | Fixed exchange=SMART, should work now |
| 4 | Position Sizing | Depends on 3 | Will run if Step 3 passes |
| 5 | Exit Rules | Depends on 3 | Will run if Step 3 passes |

---

## NEXT SESSION TODO

1. **Fix Trading Window UI** - Frontend still shows "Closed" even though backend disabled
   - Check `Engine.tsx` and `adapter.ts` for separate frontend checks
   - May need to update `getTradingWindowStatus()` in adapter.ts

2. **Test Step 3 with exchange=SMART fix** - Should now return actual strikes

3. **Test Full Engine Run** - All 5 steps should complete during market hours

4. **Commit changes** - Current changes not committed:
   ```
   M server/engine/step1.ts
   M server/broker/ibkr.ts
   M server/services/marketDataService.ts
   ```

---

## DEPLOYMENT

- **URL**: https://apeyolo.com
- **Latest Deploy**: apeyolo-00283-gq9
- **Time**: 2025-12-05 ~18:05 UTC

---

## ENGINE ARCHITECTURE (Reference)

### Trading Strategy: 0DTE Credit Options
- Sell options that expire same day (0DTE)
- Target delta 0.25-0.35 (65-75% probability OTM)
- Collect premium upfront
- Stop loss at 3x premium

### VIX Thresholds
| VIX | Regime | Action |
|-----|--------|--------|
| < 17 | LOW | Full size |
| 17-20 | NORMAL | Full size |
| 20-35 | HIGH | Reduce 50% |
| > 35 | EXTREME | No trade |

### Key Engine Files
| File | Purpose |
|------|---------|
| `server/engine/index.ts` | Orchestrates 5 steps |
| `server/engine/step1.ts` | VIX, market regime |
| `server/engine/step2.ts` | SPY trend, direction |
| `server/engine/step3.ts` | Option chain, strikes |
| `server/engine/step4.ts` | Position sizing |
| `server/engine/step5.ts` | Exit rules |
| `server/broker/ibkr.ts` | IBKR API client |

---

**Last Updated**: 2025-12-06 02:10 HKT
