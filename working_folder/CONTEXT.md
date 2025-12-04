# APEYOLO Session Context

**Purpose**: Enables Claude Code to resume work across sessions with full context.

---

## CURRENT OBJECTIVE (2025-12-03)

### Priority 1: Engine Trade Execution (ACTIVE)

**Goal**: Run engine Steps 1-5 and execute smart 0DTE options trades via IBKR.

**Status**:
- ✅ IBKR connected to paper trading
- ✅ All 5 engine steps complete
- ✅ NAV showing in header
- 🔧 Option chain data quality issues (see below)

**Known Issues Found** (from engine test output):
1. **SPY Price = $0.00 in Step 1** - Price fetch timing issue
2. **CALL uses mock data** - PUT uses IBKR but CALL falls back to mock
3. **PUT bid/ask = 0** - Greeks present but prices missing
4. **CALL delta too high** - Mock delta 0.394 (should be 0.15-0.20)
5. **Inconsistent SPY price** - Step 2 shows $680.71, Step 3 shows $445

**Files to Fix**:
- `server/engine/step3.ts` - Fix CALL chain fetch
- `server/engine/step1.ts` - Fix SPY price capture
- `server/broker/ibkr.ts` - Verify bid/ask prices return

---

### Priority 2: Chart/Data Page (DEFERRED)

**Goal**: Chart Pan/Zoom + Live Data Pipeline

**Completed**:
1. Fixed chart rendering (dynamic candle width)
2. Data audit completed - understand what data we have
3. IBKR limits documented
4. ✅ Chart zoom in/out controls (buttons + trackpad pinch)
5. ✅ Chart pan/drag feature (trackpad two-finger scroll + mouse drag)
6. ✅ Fixed zoom button bug causing blank chart
7. ✅ Increased MAX_CANDLE_WIDTH from 20 to 50 for better zoom-in visuals

**Deferred Until Engine Complete**:
1. Live data pipeline for market open
2. Data ingestion triggered for full historical data
3. Option chain wiring optimization

---

## ENGINE ARCHITECTURE

### Trading Strategy: 0DTE Credit Options

**The Strategy**:
- Sell options that expire the same day (0DTE = zero days to expiration)
- Target delta 0.15-0.20 (80-85% probability of expiring worthless)
- Collect premium upfront, keep it if options expire OTM
- Stop loss at 3x premium to limit downside

### 5-Step Decision Process

| Step | Name | Description | Key Output |
|------|------|-------------|------------|
| 1 | Market Regime | VIX check, trading window | `canExecute`, `volatilityRegime` |
| 2 | Direction | SPY trend analysis | `PUT`, `CALL`, or `STRANGLE` |
| 3 | Strike Selection | Find delta 0.15-0.20 strikes | `putStrike`, `callStrike` |
| 4 | Position Size | Risk-based sizing | `contracts`, `marginRequired` |
| 5 | Exit Rules | Stop loss, time stop | `stopLossPrice`, `timeStop` |

### VIX Thresholds

| VIX Level | Regime | Risk Multiplier | Action |
|-----------|--------|-----------------|--------|
| < 17 | LOW | 1.0 | Full size |
| 17-20 | NORMAL | 1.0 | Full size |
| 20-35 | HIGH | 0.5 | Reduce size 50% |
| > 35 | EXTREME | 0.0 | No trade |

### Risk Profiles

| Profile | Max Contracts | BP Usage | NAV Risk |
|---------|---------------|----------|----------|
| CONSERVATIVE | 2 | 50% | 5% |
| BALANCED | 3 | 70% | 10% |
| AGGRESSIVE | 5 | 100% | 20% |

### Trading Window

- **Open**: 11:00 AM - 1:00 PM ET, Monday-Friday only
- **Analysis**: Runs anytime (all 5 steps complete)
- **Execution**: Only during trading window

### Engine Files

| File | Purpose |
|------|---------|
| `server/engine/index.ts` | TradingEngine class, orchestrates 5 steps |
| `server/engine/step1.ts` | VIX fetch, market regime determination |
| `server/engine/step2.ts` | SPY trend analysis, direction selection |
| `server/engine/step3.ts` | IBKR option chain fetch, strike selection |
| `server/engine/step4.ts` | Position sizing based on account/risk |
| `server/engine/step5.ts` | Exit rules (stop loss, time stop) |
| `server/engine/adapter.ts` | Transforms TradingDecision → EngineAnalyzeResponse |
| `server/engineRoutes.ts` | API endpoints (/analyze, /execute-paper) |
| `client/src/hooks/useEngine.ts` | React hook for engine API |
| `client/src/pages/Engine.tsx` | Engine UI page |

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/engine/analyze` | GET | Run 5-step analysis, return trade proposal |
| `/api/engine/execute-paper` | POST | Execute trade proposal via IBKR |
| `/api/engine/config` | GET/PUT | Get/update engine configuration |

---

## RECENT CHANGES (Dec 2-3, 2025)

### FEATURE: Chart Zoom + Pan (DEPLOYED)

**Implemented Features**:
1. **Zoom buttons** (+/-/Reset) in chart header via `EngineBoundsChart.tsx`
2. **Trackpad pinch zoom** - Pinch outward to zoom in, inward to zoom out
3. **Two-finger scroll** - Pan through historical data
4. **Mouse drag** - Click and drag to pan through data

**Implementation Details**:

`DeterministicChart.tsx`:
- Added `zoomLevel` state (1.0 = default, <1 = zoomed in, >1 = zoomed out)
- Added `viewOffset` state for panning
- Zoom range: MIN_ZOOM=0.2 to MAX_ZOOM=3.0
- `useImperativeHandle` exposes `zoomIn()`, `zoomOut()`, `resetZoom()` methods

`ChartEngine.ts`:
- Increased `MAX_CANDLE_WIDTH` from 20 to 50 for better zoom-in visuals
- Dynamic candle width calculation based on visible bar count

**Bug Fix**: Zoom buttons were causing blank chart when clicked multiple times.
- **Root Cause**: `useImperativeHandle` was placed BEFORE `visibleBars` and `baseVisibleBars` useMemo hooks, causing "temporal dead zone" error (`ReferenceError: Cannot access 'V' before initialization`)
- **Fix**: Moved `useImperativeHandle` AFTER the useMemo hooks that define variables it depends on
- **Additional Fix**: Zoom button handlers now properly adjust `viewOffset` when `zoomLevel` changes (same logic as wheel handler)

---

### FIX: Dynamic Candle Width (DEPLOYED)

**Problem**: Charts had massive empty space on the left side with candles compressed to the right.
- 1D chart with 63 bars: ~60% empty space on left
- 5D chart with 42 bars: ~60% empty space on left

**Root Cause**: `ChartEngine.ts` line 220-222 had `rightAlignOffset` that pushed bars to the right:
```typescript
const rightAlignOffset = visibleCount < maxBarsInChart
  ? (maxBarsInChart - visibleCount) * candleTotalWidth
  : 0;
```

**Fix**: Made candle width DYNAMIC based on number of visible bars:
```typescript
const rawCandleTotalWidth = chartArea.width / visibleCount;
const MIN_CANDLE_WIDTH = 2;   // Minimum for visibility
const MAX_CANDLE_WIDTH = 20;  // Maximum for aesthetics
const SPACING_RATIO = 0.2;    // 20% spacing between candles
```

**Commit**: `94ac6e8` - "fix: Dynamic candle width to fill chart area"

**Files Changed**:
- `client/src/engine/ChartEngine.ts`:
  - Updated `CoordinateSystem` interface to include `candleWidth` and `candleSpacing`
  - Rewrote `createCoordinateSystem()` with dynamic calculation
  - Updated `renderCandles()` to use `coords.candleWidth`

---

## DATA AUDIT (Dec 2-3, 2025)

### Current Data Coverage in PostgreSQL

| Interval | Total Bars | Date Range | Coverage |
|----------|------------|------------|----------|
| **1m** | 1,002 | Dec 1-2 | 2 days only (partial) |
| **5m** | 1,404 | Oct 21 - Dec 2 | 42 days |
| **15m** | 1,896 | Sep 9 - Dec 2 | 84 days |
| **1D** | 1,000 | Dec 2021 - Dec 2025 | 4 years |
| **1W** | 249 | Jan 2020 - Dec 2025 | 5 years |
| **1M** | 53 | Feb 2020 - Dec 2025 | 5 years |

### IBKR Historical Data Limits (from IBKR API)

| Interval | Max Lookback | Bars per Trading Day |
|----------|--------------|---------------------|
| **1m** | 7 days | 390 bars (9:30-4:00) |
| **5m** | 30 days | 78 bars |
| **15m** | 60 days | 26 bars |
| **1h** | 1 year | 7 bars |
| **1D** | 5 years | 1 bar |
| **1W** | 10 years | ~0.2 bars |
| **1M** | 20 years | ~0.05 bars |

### Extended Hours Data

IBKR provides extended hours data with `outsideRth=true`:
- Pre-market: 4:00 AM - 9:30 AM ET
- Regular Trading Hours (RTH): 9:30 AM - 4:00 PM ET
- After-hours: 4:00 PM - 8:00 PM ET

Currently fetching extended hours data.

### Data Ingestion Pipeline

**Issue**: Data ingestion is NOT AUTOMATED. It runs as one-time job when manually triggered.

**API Endpoint**: `POST /api/admin/ingest/:symbol`
```bash
curl -X POST "https://apeyolo.com/api/admin/ingest/SPY" \
  -H "Content-Type: application/json" \
  -d '{"intervals": ["1m", "5m"]}'
```

**Known Issues**:
- IBKR returns 503 errors during off-hours
- Timeout issues (60s) for large data requests
- No scheduled/automated ingestion

---

## CHART ARCHITECTURE

### ChartEngine.ts Key Structures

```typescript
interface CoordinateSystem {
  priceToY: (price: number) => number;
  yToPrice: (y: number) => number;
  indexToX: (index: number) => number;
  xToIndex: (x: number) => number;
  priceMin: number;
  priceMax: number;
  candleWidth: number;      // Dynamic candle width
  candleSpacing: number;    // Dynamic spacing
  chartArea: {
    left: number;
    right: number;
    top: number;
    bottom: number;
    width: number;
    height: number;
  };
}

interface Viewport {
  startIndex: number;  // First visible bar index
  endIndex: number;    // Last visible bar index
}
```

### Viewport Calculation (for pan/zoom)

Current logic in `ChartEngine.ts`:
```typescript
// Show most recent bars (right-aligned)
const viewport: Viewport = {
  startIndex: Math.max(0, bars.length - maxBarsInChart),
  endIndex: bars.length - 1,
};
```

**For Pan/Zoom Feature**:
- Need to track `viewportOffset` - how many bars scrolled back from "now"
- Need to track `zoomLevel` - affects `maxBarsInChart`
- Viewport becomes: `startIndex = bars.length - maxBarsInChart - viewportOffset`

---

## PLANNED FEATURE: PAN/ZOOM

### Requirements

1. **Pan/Drag Left**: Scroll back through historical data
   - Drag chart left to see older bars
   - Load more historical data when reaching edge

2. **Zoom In/Out**: Change number of visible bars
   - Zoom in: Show fewer bars (larger candles)
   - Zoom out: Show more bars (smaller candles)

### Implementation Plan

1. **Add state to DeterministicChart.tsx**:
   - `viewportOffset: number` - bars scrolled from "now"
   - `zoomLevel: number` - multiplier for visible bar count

2. **Add mouse/touch event handlers**:
   - `onMouseDown` + `onMouseMove` + `onMouseUp` for drag
   - `onWheel` for zoom (scroll wheel)
   - Touch events for mobile

3. **Update ChartEngine.ts**:
   - Accept `viewportOffset` and `zoomLevel` parameters
   - Adjust viewport calculation accordingly

4. **Add UI controls**:
   - Zoom +/- buttons
   - Reset button (jump to "now")

---

## ARCHITECTURE OVERVIEW

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        DATA PIPELINE                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     POSTGRESQL DATABASE                             │    │
│  │  market_data table:                                                 │    │
│  │  - symbol: VARCHAR                                                  │    │
│  │  - interval: VARCHAR (1m, 5m, 15m, 1h, 1D, 1W, 1M)                 │    │
│  │  - timestamp: TIMESTAMP                                             │    │
│  │  - open, high, low, close, volume: NUMERIC                         │    │
│  │                                                                     │    │
│  │  ~6,000 total bars across all intervals                            │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    ↑                                         │
│                                    │ INSERT (ingestion)                      │
│                                    ↓                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                 HISTORICAL DATA INGESTION                           │    │
│  │  server/services/historicalDataIngestion.ts                        │    │
│  │  - Fetches from IBKR API                                           │    │
│  │  - Upserts to PostgreSQL                                           │    │
│  │  - Manual trigger: POST /api/admin/ingest/:symbol                  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    ↑                                         │
│                                    │ HTTP                                    │
│                                    ↓                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     IBKR CLIENT PORTAL API                          │    │
│  │  Historical: /iserver/marketdata/history                           │    │
│  │  Streaming: wss://api.ibkr.com/v1/api/ws                          │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                        CHART RENDERING                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     BROWSER                                         │    │
│  │                                                                     │    │
│  │  EngineBoundsChart.tsx                                             │    │
│  │    └── DeterministicChart.tsx                                      │    │
│  │          └── ChartEngine.ts (Canvas 2D rendering)                  │    │
│  │                - Dynamic candle width                              │    │
│  │                - Coordinate system                                 │    │
│  │                - Price/time axis                                   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    ↑                                         │
│                                    │ REST API                                │
│                                    ↓                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     EXPRESS SERVER                                  │    │
│  │                                                                     │    │
│  │  GET /api/chart/data/:symbol?range=1D&interval=1m                  │    │
│  │    → Queries PostgreSQL                                            │    │
│  │    → Applies RTH filter (9:30-4:00 ET)                            │    │
│  │    → Returns bars array                                            │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## KEY FILES

### Server - Data Pipeline

| File | Purpose |
|------|---------|
| `server/services/historicalDataIngestion.ts` | Bulk fetch from IBKR, persist to PostgreSQL |
| `server/routes.ts` | API endpoints including `/api/chart/data/:symbol` |
| `server/broker/ibkr.ts` | IBKR HTTP client |
| `server/broker/ibkrWebSocket.ts` | IBKR WebSocket streaming |
| `server/broker/optionChainStreamer.ts` | Option chain cache + market open scheduling |

### Client - Chart

| File | Purpose |
|------|---------|
| `client/src/pages/Data.tsx` | Main data page |
| `client/src/components/EngineBoundsChart.tsx` | Chart wrapper with range/interval selectors |
| `client/src/components/DeterministicChart.tsx` | Chart component with data fetching |
| `client/src/engine/ChartEngine.ts` | Canvas rendering engine |

---

## API ENDPOINTS

### Chart Data (from PostgreSQL)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/chart/data/:symbol` | GET | Fetch bars from database |
| Query: `range` | - | `1D`, `5D`, `1M`, `3M`, `6M`, `YTD`, `1Y`, `5Y`, `MAX` |
| Query: `interval` | - | `1m`, `5m`, `15m`, `1h`, `1D`, `1W`, `1M` |
| Query: `rth` | - | `true` (default) - Regular Trading Hours only |

### Data Ingestion (Admin)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/ingest/:symbol` | POST | Trigger IBKR data ingestion |
| `/api/admin/ingest/status` | GET | All active ingestions |
| `/api/admin/ingest/status/:symbol` | GET | Status for specific symbol |
| `/api/chart/stats` | GET | Database storage statistics |

---

## TESTING COMMANDS

### Check Database Stats
```bash
curl -s "https://apeyolo.com/api/chart/stats" | jq .
```

### Fetch Chart Data
```bash
curl -s "https://apeyolo.com/api/chart/data/SPY?range=1D&interval=1m" | jq '{count: .count, first: .bars[0], last: .bars[-1]}'
```

### Trigger Data Ingestion
```bash
curl -X POST "https://apeyolo.com/api/admin/ingest/SPY" \
  -H "Content-Type: application/json" \
  -d '{"intervals": ["1m", "5m"]}' | jq .
```

### Check Ingestion Status
```bash
curl -s "https://apeyolo.com/api/admin/ingest/status/SPY" | jq .
```

### Direct Database Query
```bash
PGPASSWORD='DOMRD7x7ECUny4Pc615y9w==' psql -h 35.194.142.132 -U postgres -d apeyolo -c "
SELECT interval, COUNT(*), MIN(timestamp), MAX(timestamp)
FROM market_data WHERE symbol='SPY'
GROUP BY interval ORDER BY interval;"
```

---

## PRODUCTION

- **URL**: https://apeyolo.com
- **Cloud Run Service**: `apeyolo` (asia-east1)
- **Project**: fabled-cocoa-443004-n3
- **Database**: Cloud SQL PostgreSQL (apeyolo-db)

### Deploy
```bash
./scripts/deploy.sh prod
```

---

## NEXT STEPS

1. ~~**Implement Chart Pan/Zoom Feature**~~ ✅ DONE
   - ~~Add mouse drag to scroll through history~~
   - ~~Add zoom in/out controls~~
   - Load more data when reaching edge (TODO - fetch more historical data on pan)

2. **Automate Data Ingestion**
   - Schedule job at market open (9:30 AM ET)
   - Continuous updates during market hours
   - Backfill on service startup

3. **Live Data Pipeline**
   - WebSocket updates to current candle
   - Append new bars as they form
   - Visual indicator for live data

4. **Time-Based X-Axis** (Future Enhancement)
   - X-axis shows expected time range (e.g., 9:30-4:00 for 1D)
   - Data fills from left side
   - Empty space shows unfilled time
   - See plan file: `.claude/plans/tranquil-discovering-eagle.md`

---

**Last Updated**: 2025-12-03 (Session: Zoom/Pan fix deployed)
