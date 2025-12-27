# DD Research Terminal Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform DD page into a research terminal with AI-generated market narratives + historical option chain data collection for future backtesting.

**Architecture:** Two engines - (1) Live Context Engine for narratives, (2) Hybrid Data Collection with WebSocket OHLC + HTTP fallback. Event-driven IBKR connection that auto-starts when authenticated during market hours.

**Tech Stack:** React, Express, PostgreSQL, IBKR WebSocket + HTTP, Yahoo Finance, Anthropic Claude

---

## Data Volume Estimates

**Only capture liquid strikes:** ATM ± $7 (roughly 1% from SPY price)
- ~14 strikes × 2 (puts + calls) = **28 options per snapshot**
- 78 snapshots/day (6.5 hours ÷ 5 min)
- **~440 KB/day, ~110 MB/year** - trivial for PostgreSQL

**Filtering logic:** Only capture options where:
- Strike is within ±$7 of current underlying price, OR
- Open Interest > 1000, OR
- Volume > 100 (if available)

---

## Phase 1: Bulletproof Data Collection

### Task 1: Add OHLC Tracking to Option Chain Streamer

**Files:**
- Modify: `server/broker/optionChainStreamer.ts`

**Changes:**
1. Add OHLC fields to `CachedStrike` interface:
```typescript
interface CachedStrike {
  // ... existing fields ...
  intervalOpen?: number;
  intervalHigh?: number;
  intervalLow?: number;
  intervalClose?: number;
  intervalStart?: Date;
  tickCount?: number;  // Track how many ticks received
}
```

2. In `handleMarketDataUpdate()`, track OHLC:
```typescript
if (update.last != null) {
  const now = new Date();
  const intervalStart = getIntervalStart(now, 5); // Round to 5-min boundary

  // New interval? Reset OHLC
  if (!strike.intervalStart || strike.intervalStart < intervalStart) {
    strike.intervalOpen = update.last;
    strike.intervalHigh = update.last;
    strike.intervalLow = update.last;
    strike.intervalStart = intervalStart;
    strike.tickCount = 0;
  }

  // Update running OHLC
  strike.intervalHigh = Math.max(strike.intervalHigh!, update.last);
  strike.intervalLow = Math.min(strike.intervalLow!, update.last);
  strike.intervalClose = update.last;
  strike.tickCount!++;
}
```

**Commit:** `feat(dd): add OHLC tracking to option chain streamer`

---

### Task 2: Event-Driven IBKR Connection

**Files:**
- Modify: `server/broker/ibkr.ts` (add auth event)
- Modify: `server/broker/optionChainStreamer.ts` (listen for auth)

**Changes:**

1. Add auth event emitter to IBKR client:
```typescript
import { EventEmitter } from 'events';
export const ibkrEvents = new EventEmitter();

// In authenticate() success path:
ibkrEvents.emit('authenticated');
```

2. Streamer listens and auto-starts:
```typescript
import { ibkrEvents } from './ibkr';

export function initOptionChainStreamer() {
  const streamer = getOptionChainStreamer();

  ibkrEvents.on('authenticated', async () => {
    if (isMarketOpen()) {
      console.log('[Streamer] IBKR authenticated, starting streaming...');
      await startWithRetry(streamer, 'SPY');
    }
  });

  return streamer;
}

async function startWithRetry(streamer: OptionChainStreamer, symbol: string) {
  for (let i = 0; i < 10; i++) {
    try {
      await streamer.startStreaming(symbol);
      return;
    } catch (err) {
      console.log(`[Streamer] Attempt ${i+1} failed, retrying in 30s...`);
      await new Promise(r => setTimeout(r, 30000));
    }
  }
}
```

**Commit:** `feat(dd): event-driven IBKR connection with retry`

---

### Task 3: Create Option Bars Table

**Files:**
- Modify: `shared/schema.ts`

**Schema:**
```typescript
export const optionBars = pgTable('option_bars', {
  id: uuid('id').primaryKey().defaultRandom(),
  symbol: text('symbol').notNull(),
  strike: numeric('strike', { precision: 10, scale: 2 }).notNull(),
  expiry: text('expiry').notNull(),
  optionType: text('option_type').notNull(), // 'PUT' | 'CALL'
  intervalStart: timestamp('interval_start').notNull(),

  // OHLC
  open: numeric('open', { precision: 10, scale: 4 }),
  high: numeric('high', { precision: 10, scale: 4 }),
  low: numeric('low', { precision: 10, scale: 4 }),
  close: numeric('close', { precision: 10, scale: 4 }),

  // Snapshot data (always captured)
  bidClose: numeric('bid_close', { precision: 10, scale: 4 }),
  askClose: numeric('ask_close', { precision: 10, scale: 4 }),

  // Greeks at close
  delta: numeric('delta', { precision: 8, scale: 6 }),
  gamma: numeric('gamma', { precision: 8, scale: 6 }),
  theta: numeric('theta', { precision: 8, scale: 6 }),
  vega: numeric('vega', { precision: 8, scale: 6 }),
  iv: numeric('iv', { precision: 8, scale: 6 }),
  openInterest: integer('open_interest'),

  // Data quality
  dataQuality: text('data_quality').notNull(), // 'complete', 'partial', 'snapshot_only'
  tickCount: integer('tick_count').default(0),

  // Underlying context
  underlyingPrice: numeric('underlying_price', { precision: 10, scale: 4 }),
  vix: numeric('vix', { precision: 8, scale: 4 }),

  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  // Prevent duplicates
  uniqueIdx: uniqueIndex('idx_option_bars_unique').on(
    table.symbol, table.strike, table.expiry, table.optionType, table.intervalStart
  ),
  // Query performance
  symbolTimeIdx: index('idx_option_bars_symbol_time').on(table.symbol, table.intervalStart),
}));
```

**Run:** `npm run db:push`

**Commit:** `feat(dd): add option_bars table for OHLC storage`

---

### Task 4: Hybrid Data Capture Job

**Files:**
- Rewrite: `server/services/jobs/optionChainCapture.ts`

**Logic:**
```typescript
export async function captureOptionBars(): Promise<void> {
  const streamer = getOptionChainStreamer();
  const chain = streamer.getOptionChain('SPY');
  const intervalStart = getIntervalStart(new Date(), 5);

  // Determine data quality
  const wsConnected = streamer.getStatus().wsConnected;

  const bars: InsertOptionBar[] = [];

  for (const option of [...chain.puts, ...chain.calls]) {
    const hasOHLC = option.tickCount && option.tickCount > 0;

    bars.push({
      symbol: 'SPY',
      strike: option.strike,
      expiry: chain.expiry,
      optionType: option.optionType,
      intervalStart,

      // OHLC from WebSocket (if available)
      open: hasOHLC ? option.intervalOpen : null,
      high: hasOHLC ? option.intervalHigh : null,
      low: hasOHLC ? option.intervalLow : null,
      close: hasOHLC ? option.intervalClose : option.last,

      // Always capture current bid/ask
      bidClose: option.bid,
      askClose: option.ask,

      // Greeks
      delta: option.delta,
      gamma: option.gamma,
      theta: option.theta,
      vega: option.vega,
      iv: option.iv,
      openInterest: option.openInterest,

      // Quality tracking
      dataQuality: hasOHLC ? 'complete' : (wsConnected ? 'partial' : 'snapshot_only'),
      tickCount: option.tickCount || 0,

      underlyingPrice: chain.underlyingPrice,
      vix: chain.vix,
    });
  }

  // Batch insert with conflict handling
  await db.insert(optionBars).values(bars).onConflictDoNothing();

  // Reset OHLC accumulators for next interval
  streamer.resetIntervalTracking('SPY');
}
```

**Commit:** `feat(dd): hybrid data capture with OHLC + HTTP fallback`

---

### Task 5: 5-Minute Scheduler with Status Tracking

**Files:**
- Create: `server/services/jobs/fiveMinuteDataCapture.ts`
- Modify: `shared/schema.ts` (add continuous_job_status table)

**Schema for status tracking:**
```typescript
export const continuousJobStatus = pgTable('continuous_job_status', {
  id: text('id').primaryKey(), // 'option-data-capture'
  isRunning: boolean('is_running').default(false),
  lastCaptureAt: timestamp('last_capture_at'),
  lastCaptureResult: text('last_capture_result'), // 'success', 'error'
  lastError: text('last_error'),
  captureCountToday: integer('capture_count_today').default(0),
  completeCount: integer('complete_count').default(0),
  partialCount: integer('partial_count').default(0),
  snapshotOnlyCount: integer('snapshot_only_count').default(0),
  wsConnected: boolean('ws_connected').default(false),
  marketDay: text('market_day'),
  updatedAt: timestamp('updated_at').defaultNow(),
});
```

**Scheduler with status updates:**
```typescript
const JOB_ID = 'option-data-capture';

export function startFiveMinuteCapture(): void {
  if (captureInterval) return;

  // Mark as running
  updateJobStatus({ isRunning: true });

  // Align to next 5-minute boundary
  const now = new Date();
  const msToNextInterval = (5 - (now.getMinutes() % 5)) * 60 * 1000 - now.getSeconds() * 1000;

  setTimeout(() => {
    runCapture();
    captureInterval = setInterval(runCapture, 5 * 60 * 1000);
  }, msToNextInterval);
}

async function runCapture(): Promise<void> {
  if (!getMarketStatus().isOpen) return;

  try {
    const result = await captureOptionBars();
    await updateJobStatus({
      lastCaptureAt: new Date(),
      lastCaptureResult: 'success',
      captureCountToday: sql`capture_count_today + 1`,
      completeCount: sql`complete_count + ${result.completeCount}`,
      partialCount: sql`partial_count + ${result.partialCount}`,
      snapshotOnlyCount: sql`snapshot_only_count + ${result.snapshotOnlyCount}`,
      wsConnected: result.wsConnected,
    });
  } catch (err) {
    await updateJobStatus({
      lastCaptureAt: new Date(),
      lastCaptureResult: 'error',
      lastError: err.message,
    });
  }
}

// Reset counts at start of each market day
async function resetDailyCounts(): Promise<void> {
  const today = getETDateString();
  const status = await getJobStatus(JOB_ID);
  if (status?.marketDay !== today) {
    await updateJobStatus({
      marketDay: today,
      captureCountToday: 0,
      completeCount: 0,
      partialCount: 0,
      snapshotOnlyCount: 0,
    });
  }
}
```

**Commit:** `feat(dd): 5-minute scheduler with status tracking`

---

### Task 6: Data Capture Status API

**Files:**
- Create: `server/routes/dataCaptureRoutes.ts`

**Endpoints:**
```typescript
// GET /api/data-capture/status
// Returns current status of continuous data capture job
router.get('/status', async (req, res) => {
  const status = await db.select().from(continuousJobStatus)
    .where(eq(continuousJobStatus.id, 'option-data-capture'))
    .limit(1);

  const streamer = getOptionChainStreamer();
  const wsStatus = streamer.getStatus();

  res.json({
    ok: true,
    status: status[0] || null,
    streaming: {
      wsConnected: wsStatus.wsConnected,
      isStreaming: wsStatus.isStreaming,
      subscriptionCount: wsStatus.subscriptionCount,
    },
  });
});

// GET /api/data-capture/history?date=2024-12-27
// Returns capture history for a specific day
router.get('/history', async (req, res) => {
  const date = req.query.date as string || getETDateString();
  const bars = await db.select({
    intervalStart: optionBars.intervalStart,
    dataQuality: optionBars.dataQuality,
    count: sql<number>`count(*)`,
  })
  .from(optionBars)
  .where(sql`DATE(${optionBars.intervalStart}) = ${date}`)
  .groupBy(optionBars.intervalStart, optionBars.dataQuality)
  .orderBy(optionBars.intervalStart);

  res.json({ ok: true, date, captures: bars });
});
```

**Commit:** `feat(dd): add data capture status API`

---

## Phase 2: Live Context Engine

### Task 7: Macro Data Service

**Files:**
- Create: `server/services/macroDataService.ts`

Fetch DXY and 10Y yield from Yahoo Finance. (See previous plan for full code)

**Commit:** `feat(dd): add macro data fetcher`

---

### Task 8: Narrative Generation Service

**Files:**
- Create: `server/services/narrativeService.ts`

AI-generated market analysis using assembled context. (See previous plan for full code)

**Commit:** `feat(dd): add AI narrative generation`

---

### Task 9: Research API Endpoints

**Files:**
- Create: `server/researchRoutes.ts`

Endpoints: `GET /api/research/context`, `GET /api/research/narrative`

**Commit:** `feat(dd): add research API endpoints`

---

### Task 10: Rebuild DD Page UI

**Files:**
- Rewrite: `client/src/pages/DD.tsx`

Minimal research terminal: metrics strip + narrative block + data collection status.

**Commit:** `feat(dd): rebuild DD page as research terminal`

---

## Phase 3: Future - Backtest Engine

Deferred until sufficient data collected (~2-4 weeks of 5-min option bars).

Will include:
- Strategy definition for options (entry/exit on delta, IV, price levels)
- Historical query service
- Simulation engine iterating through option bars
- P&L and performance metrics

---

## Summary

| Phase | Tasks | Outcome |
|-------|-------|---------|
| 1 | 1-6 | Bulletproof OHLC data collection with status tracking |
| 2 | 7-10 | Live research terminal with AI narrative |
| 3 | Future | Backtest engine |

**Data collected:** Liquid strikes only (ATM ± $7), OHLC bars every 5 min with data quality tracking. ~440 KB/day.

**Job observability:** Status API shows WebSocket connection, last capture, data quality breakdown (complete/partial/snapshot-only).
