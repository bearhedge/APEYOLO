# RLHF: Earned Autonomy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an AI that earns trading autonomy by learning from your decisions and proving accuracy.

**Architecture:** Three-layer system: (1) Indicator Engine computes market features, (2) Your decisions override/confirm indicators, (3) Edge Learning captures your disagreements and learns when to apply your intuition.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL, Yahoo Finance API, Vertex AI

---

## Phase 1: Foundation - Track Everything

### Task 1: Add Engine Runs Table

**Files:**
- Modify: `/Users/home/Desktop/APE YOLO/APE-YOLO/shared/schema.ts`

**Step 1: Add the engineRuns table to schema**

```typescript
// Add after existing table definitions

export const engineRuns = pgTable("engine_runs", {
  id: varchar("id", { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: varchar("user_id", { length: 36 }).references(() => users.id),

  // Trade setup
  symbol: text("symbol").notNull(),
  direction: text("direction").notNull(), // PUT | CALL | STRANGLE
  expirationMode: text("expiration_mode"), // 0DTE | WEEKLY

  // Original engine output (before your adjustments)
  originalPutStrike: doublePrecision("original_put_strike"),
  originalCallStrike: doublePrecision("original_call_strike"),
  originalPutDelta: doublePrecision("original_put_delta"),
  originalCallDelta: doublePrecision("original_call_delta"),

  // Your final adjustments
  finalPutStrike: doublePrecision("final_put_strike"),
  finalCallStrike: doublePrecision("final_call_strike"),
  adjustmentCount: integer("adjustment_count").default(0),

  // Market context at time of decision
  underlyingPrice: doublePrecision("underlying_price"),
  vix: doublePrecision("vix"),

  // Computed indicators (what AI sees)
  indicators: jsonb("indicators"), // { rsi: 65, macd: 0.5, sma20: 450, ... }

  // Full engine output for reference
  engineOutput: jsonb("engine_output"),

  // Outcome (filled when trade closes)
  tradeId: varchar("trade_id", { length: 36 }),
  realizedPnl: doublePrecision("realized_pnl"),
  exitReason: text("exit_reason"),
  wasWinner: boolean("was_winner"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  closedAt: timestamp("closed_at"),
});

export const engineRunsRelations = relations(engineRuns, ({ one }) => ({
  user: one(users, { fields: [engineRuns.userId], references: [users.id] }),
  trade: one(trades, { fields: [engineRuns.tradeId], references: [trades.id] }),
}));
```

**Step 2: Run to verify syntax**

Run: `cd "/Users/home/Desktop/APE YOLO/APE-YOLO" && npx tsc --noEmit shared/schema.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add shared/schema.ts
git commit -m "feat: add engine_runs table for RLHF tracking"
```

---

### Task 2: Add Direction Predictions Table

**Files:**
- Modify: `/Users/home/Desktop/APE YOLO/APE-YOLO/shared/schema.ts`

**Step 1: Add the directionPredictions table**

```typescript
export const directionPredictions = pgTable("direction_predictions", {
  id: varchar("id", { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  engineRunId: varchar("engine_run_id", { length: 36 }).references(() => engineRuns.id),

  // What indicators suggested
  indicatorSignal: text("indicator_signal"), // PUT | CALL | STRANGLE | NEUTRAL
  indicatorConfidence: doublePrecision("indicator_confidence"),
  indicatorReasoning: jsonb("indicator_reasoning"), // { rsi: "overbought", macd: "bearish cross", ... }

  // What AI suggested (learned model)
  aiSuggestion: text("ai_suggestion"),
  aiConfidence: doublePrecision("ai_confidence"),

  // What you actually chose
  userChoice: text("user_choice").notNull(),

  // Did you agree with AI?
  agreedWithAi: boolean("agreed_with_ai"),
  agreedWithIndicators: boolean("agreed_with_indicators"),

  // This is your edge - when you disagree and are right
  wasOverride: boolean("was_override"), // You disagreed with AI
  overrideWasCorrect: boolean("override_was_correct"), // And you were right

  // Outcome
  pnl: doublePrecision("pnl"),
  wasCorrect: boolean("was_correct"), // Did the chosen direction make money?

  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

**Step 2: Verify syntax**

Run: `cd "/Users/home/Desktop/APE YOLO/APE-YOLO" && npx tsc --noEmit shared/schema.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add shared/schema.ts
git commit -m "feat: add direction_predictions table for learning your edge"
```

---

### Task 3: Add Indicator Snapshots Table

**Files:**
- Modify: `/Users/home/Desktop/APE YOLO/APE-YOLO/shared/schema.ts`

**Step 1: Add indicator_snapshots table**

```typescript
export const indicatorSnapshots = pgTable("indicator_snapshots", {
  id: varchar("id", { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  symbol: text("symbol").notNull(),

  // Price data
  price: doublePrecision("price").notNull(),
  open: doublePrecision("open"),
  high: doublePrecision("high"),
  low: doublePrecision("low"),
  volume: doublePrecision("volume"),

  // Trend indicators
  sma20: doublePrecision("sma_20"),
  sma50: doublePrecision("sma_50"),
  ema9: doublePrecision("ema_9"),
  ema21: doublePrecision("ema_21"),

  // Momentum indicators
  rsi14: doublePrecision("rsi_14"),
  macd: doublePrecision("macd"),
  macdSignal: doublePrecision("macd_signal"),
  macdHistogram: doublePrecision("macd_histogram"),

  // Volatility
  atr14: doublePrecision("atr_14"),
  bollingerUpper: doublePrecision("bollinger_upper"),
  bollingerLower: doublePrecision("bollinger_lower"),

  // Market context
  vix: doublePrecision("vix"),

  // Derived signals
  trendDirection: text("trend_direction"), // UP | DOWN | SIDEWAYS
  momentumSignal: text("momentum_signal"), // BULLISH | BEARISH | NEUTRAL
  volatilityRegime: text("volatility_regime"), // LOW | NORMAL | HIGH

  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("indicator_snapshots_symbol_idx").on(table.symbol),
  index("indicator_snapshots_created_idx").on(table.createdAt),
]);
```

**Step 2: Verify and commit**

```bash
npx tsc --noEmit shared/schema.ts
git add shared/schema.ts
git commit -m "feat: add indicator_snapshots table"
```

---

### Task 4: Run Database Migration

**Step 1: Push schema to database**

Run: `cd "/Users/home/Desktop/APE YOLO/APE-YOLO" && npx drizzle-kit push`
Expected: Tables created successfully

**Step 2: Verify tables exist**

Run: `npx drizzle-kit studio` (or check via psql)
Expected: See engine_runs, direction_predictions, indicator_snapshots tables

**Step 3: Commit migration**

```bash
git add drizzle/
git commit -m "chore: add RLHF tables migration"
```

---

## Phase 2: Indicator Engine

### Task 5: Create Indicator Calculator Service

**Files:**
- Create: `/Users/home/Desktop/APE YOLO/APE-YOLO/server/services/indicators/calculator.ts`

**Step 1: Create the indicator calculator**

```typescript
/**
 * Calculates technical indicators from price data
 * This is what the AI "sees" - your job is to teach it when to trust/ignore these
 */

export interface PriceBar {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorSnapshot {
  // Price
  price: number;

  // Trend
  sma20: number;
  sma50: number;
  ema9: number;
  ema21: number;

  // Momentum
  rsi14: number;
  macd: number;
  macdSignal: number;
  macdHistogram: number;

  // Volatility
  atr14: number;
  bollingerUpper: number;
  bollingerLower: number;

  // Derived
  trendDirection: 'UP' | 'DOWN' | 'SIDEWAYS';
  momentumSignal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  volatilityRegime: 'LOW' | 'NORMAL' | 'HIGH';

  // Direction suggestion based on indicators only
  indicatorSuggestion: 'PUT' | 'CALL' | 'STRANGLE' | 'NO_TRADE';
  indicatorConfidence: number;
}

// Simple Moving Average
function sma(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1];
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

// Exponential Moving Average
function ema(prices: number[], period: number): number {
  if (prices.length < period) return sma(prices, prices.length);
  const k = 2 / (period + 1);
  let ema = sma(prices.slice(0, period), period);
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

// Relative Strength Index
function rsi(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 50;

  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }

  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

// Average True Range
function atr(bars: PriceBar[], period: number = 14): number {
  if (bars.length < period + 1) return 0;

  const trueRanges: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const tr = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close)
    );
    trueRanges.push(tr);
  }

  return sma(trueRanges.slice(-period), period);
}

// MACD
function macd(prices: number[]): { macd: number; signal: number; histogram: number } {
  const ema12 = ema(prices, 12);
  const ema26 = ema(prices, 26);
  const macdLine = ema12 - ema26;

  // Signal line (9-period EMA of MACD)
  // Simplified: just use current MACD as approximation
  const signal = macdLine * 0.9; // Rough approximation

  return {
    macd: macdLine,
    signal,
    histogram: macdLine - signal,
  };
}

// Bollinger Bands
function bollingerBands(prices: number[], period: number = 20): { upper: number; lower: number } {
  const middle = sma(prices, period);
  const slice = prices.slice(-period);
  const variance = slice.reduce((sum, p) => sum + Math.pow(p - middle, 2), 0) / period;
  const stdDev = Math.sqrt(variance);

  return {
    upper: middle + 2 * stdDev,
    lower: middle - 2 * stdDev,
  };
}

export function calculateIndicators(bars: PriceBar[], vix?: number): IndicatorSnapshot {
  const closes = bars.map(b => b.close);
  const price = closes[closes.length - 1];

  const sma20Val = sma(closes, 20);
  const sma50Val = sma(closes, 50);
  const ema9Val = ema(closes, 9);
  const ema21Val = ema(closes, 21);
  const rsi14Val = rsi(closes, 14);
  const macdResult = macd(closes);
  const atr14Val = atr(bars, 14);
  const bb = bollingerBands(closes, 20);

  // Derive trend direction
  let trendDirection: 'UP' | 'DOWN' | 'SIDEWAYS';
  if (price > sma20Val && sma20Val > sma50Val) trendDirection = 'UP';
  else if (price < sma20Val && sma20Val < sma50Val) trendDirection = 'DOWN';
  else trendDirection = 'SIDEWAYS';

  // Derive momentum signal
  let momentumSignal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  if (rsi14Val > 60 && macdResult.histogram > 0) momentumSignal = 'BULLISH';
  else if (rsi14Val < 40 && macdResult.histogram < 0) momentumSignal = 'BEARISH';
  else momentumSignal = 'NEUTRAL';

  // Derive volatility regime
  const atrPercent = (atr14Val / price) * 100;
  let volatilityRegime: 'LOW' | 'NORMAL' | 'HIGH';
  if (vix && vix > 25) volatilityRegime = 'HIGH';
  else if (vix && vix < 15) volatilityRegime = 'LOW';
  else if (atrPercent > 2) volatilityRegime = 'HIGH';
  else if (atrPercent < 0.8) volatilityRegime = 'LOW';
  else volatilityRegime = 'NORMAL';

  // Derive indicator-based direction suggestion
  let indicatorSuggestion: 'PUT' | 'CALL' | 'STRANGLE' | 'NO_TRADE';
  let indicatorConfidence: number;

  if (volatilityRegime === 'HIGH') {
    indicatorSuggestion = 'NO_TRADE';
    indicatorConfidence = 0.3;
  } else if (trendDirection === 'SIDEWAYS') {
    indicatorSuggestion = 'STRANGLE';
    indicatorConfidence = 0.6;
  } else if (trendDirection === 'UP' && momentumSignal === 'BULLISH') {
    indicatorSuggestion = 'PUT'; // Sell puts in uptrend
    indicatorConfidence = 0.7;
  } else if (trendDirection === 'DOWN' && momentumSignal === 'BEARISH') {
    indicatorSuggestion = 'CALL'; // Sell calls in downtrend
    indicatorConfidence = 0.7;
  } else {
    indicatorSuggestion = 'STRANGLE';
    indicatorConfidence = 0.5;
  }

  return {
    price,
    sma20: sma20Val,
    sma50: sma50Val,
    ema9: ema9Val,
    ema21: ema21Val,
    rsi14: rsi14Val,
    macd: macdResult.macd,
    macdSignal: macdResult.signal,
    macdHistogram: macdResult.histogram,
    atr14: atr14Val,
    bollingerUpper: bb.upper,
    bollingerLower: bb.lower,
    trendDirection,
    momentumSignal,
    volatilityRegime,
    indicatorSuggestion,
    indicatorConfidence,
  };
}
```

**Step 2: Verify syntax**

Run: `npx tsc --noEmit server/services/indicators/calculator.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add server/services/indicators/
git commit -m "feat: add indicator calculator service"
```

---

### Task 6: Create Yahoo Finance Data Fetcher

**Files:**
- Create: `/Users/home/Desktop/APE YOLO/APE-YOLO/server/services/indicators/yahooFetcher.ts`

**Step 1: Create the Yahoo Finance fetcher**

```typescript
import yahooFinance from 'yahoo-finance2';
import { PriceBar, calculateIndicators, IndicatorSnapshot } from './calculator';

export async function fetchPriceBars(symbol: string, days: number = 60): Promise<PriceBar[]> {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const result = await yahooFinance.historical(symbol, {
    period1: startDate,
    period2: endDate,
    interval: '1d',
  });

  return result.map(bar => ({
    date: bar.date,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  }));
}

export async function fetchVix(): Promise<number> {
  try {
    const quote = await yahooFinance.quote('^VIX');
    return quote.regularMarketPrice || 20;
  } catch {
    return 20; // Default if VIX fetch fails
  }
}

export async function getIndicatorSnapshot(symbol: string): Promise<IndicatorSnapshot> {
  const [bars, vix] = await Promise.all([
    fetchPriceBars(symbol, 60),
    fetchVix(),
  ]);

  return calculateIndicators(bars, vix);
}
```

**Step 2: Commit**

```bash
git add server/services/indicators/
git commit -m "feat: add Yahoo Finance data fetcher"
```

---

### Task 7: Create Indicator API Endpoint

**Files:**
- Create: `/Users/home/Desktop/APE YOLO/APE-YOLO/server/routes/indicatorRoutes.ts`
- Modify: `/Users/home/Desktop/APE YOLO/APE-YOLO/server/index.ts` (register routes)

**Step 1: Create indicator routes**

```typescript
import { Router } from 'express';
import { getIndicatorSnapshot } from '../services/indicators/yahooFetcher';
import { db } from '../db';
import { indicatorSnapshots } from '../../shared/schema';

const router = Router();

// Get current indicators for a symbol
router.get('/indicators/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const snapshot = await getIndicatorSnapshot(symbol.toUpperCase());

    // Save to database for historical tracking
    await db.insert(indicatorSnapshots).values({
      symbol: symbol.toUpperCase(),
      price: snapshot.price,
      sma20: snapshot.sma20,
      sma50: snapshot.sma50,
      ema9: snapshot.ema9,
      ema21: snapshot.ema21,
      rsi14: snapshot.rsi14,
      macd: snapshot.macd,
      macdSignal: snapshot.macdSignal,
      macdHistogram: snapshot.macdHistogram,
      atr14: snapshot.atr14,
      bollingerUpper: snapshot.bollingerUpper,
      bollingerLower: snapshot.bollingerLower,
      trendDirection: snapshot.trendDirection,
      momentumSignal: snapshot.momentumSignal,
      volatilityRegime: snapshot.volatilityRegime,
    });

    res.json(snapshot);
  } catch (error) {
    console.error('Failed to fetch indicators:', error);
    res.status(500).json({ error: 'Failed to fetch indicators' });
  }
});

// Get AI direction suggestion
router.get('/indicators/:symbol/suggestion', async (req, res) => {
  try {
    const { symbol } = req.params;
    const snapshot = await getIndicatorSnapshot(symbol.toUpperCase());

    res.json({
      suggestion: snapshot.indicatorSuggestion,
      confidence: snapshot.indicatorConfidence,
      reasoning: {
        trend: snapshot.trendDirection,
        momentum: snapshot.momentumSignal,
        volatility: snapshot.volatilityRegime,
        rsi: snapshot.rsi14,
        macd: snapshot.macdHistogram > 0 ? 'bullish' : 'bearish',
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get suggestion' });
  }
});

export default router;
```

**Step 2: Register routes in server/index.ts**

Add to imports and route registration.

**Step 3: Commit**

```bash
git add server/routes/indicatorRoutes.ts server/index.ts
git commit -m "feat: add indicator API endpoints"
```

---

## Phase 3: Engine Run Logging

### Task 8: Modify Engine to Log Runs

**Files:**
- Modify: `/Users/home/Desktop/APE YOLO/APE-YOLO/server/engine/index.ts`

**Step 1: Add engine run logging**

At the end of engine.run(), save the run to database:

```typescript
// Add to engine run completion
import { db } from '../db';
import { engineRuns } from '../../shared/schema';
import { getIndicatorSnapshot } from '../services/indicators/yahooFetcher';

// Inside the run method, after all steps complete:
const indicators = await getIndicatorSnapshot(this.config.symbol);

const engineRunRecord = await db.insert(engineRuns).values({
  userId: this.config.userId,
  symbol: this.config.symbol,
  direction: this.config.direction,
  expirationMode: this.config.expirationMode,
  originalPutStrike: result.strikes?.put?.strike,
  originalCallStrike: result.strikes?.call?.strike,
  originalPutDelta: result.strikes?.put?.delta,
  originalCallDelta: result.strikes?.call?.delta,
  underlyingPrice: result.marketData?.lastPrice,
  vix: indicators.vix,
  indicators: indicators,
  engineOutput: result,
}).returning();

// Return the engineRunId so UI can track adjustments
return {
  ...result,
  engineRunId: engineRunRecord[0].id,
};
```

**Step 2: Commit**

```bash
git add server/engine/
git commit -m "feat: log engine runs for RLHF tracking"
```

---

### Task 9: Track Strike Adjustments

**Files:**
- Modify: Wherever strike adjustments happen in the UI/API

**Step 1: Create adjustment tracking endpoint**

```typescript
// POST /api/engine-runs/:id/adjustments
router.post('/engine-runs/:id/adjustments', async (req, res) => {
  const { id } = req.params;
  const { finalPutStrike, finalCallStrike, adjustmentCount } = req.body;

  await db.update(engineRuns)
    .set({
      finalPutStrike,
      finalCallStrike,
      adjustmentCount,
    })
    .where(eq(engineRuns.id, id));

  res.json({ success: true });
});
```

**Step 2: Call this from UI when user adjusts strikes**

**Step 3: Commit**

```bash
git commit -m "feat: track strike adjustments"
```

---

### Task 10: Link Trade Outcomes

**Files:**
- Modify: Trade close handler

**Step 1: When trade closes, update engine run**

```typescript
// When a trade closes, find its engine run and update outcome
async function linkTradeOutcome(tradeId: string, pnl: number, exitReason: string) {
  const run = await db.select()
    .from(engineRuns)
    .where(eq(engineRuns.tradeId, tradeId))
    .limit(1);

  if (run.length > 0) {
    await db.update(engineRuns)
      .set({
        realizedPnl: pnl,
        exitReason,
        wasWinner: pnl > 0,
        closedAt: new Date(),
      })
      .where(eq(engineRuns.id, run[0].id));
  }
}
```

**Step 2: Commit**

```bash
git commit -m "feat: link trade outcomes to engine runs"
```

---

## Phase 4: Direction Predictions

### Task 11: Create Direction Prediction Service

**Files:**
- Create: `/Users/home/Desktop/APE YOLO/APE-YOLO/server/services/rlhf/directionPredictor.ts`

**Step 1: Create the predictor**

```typescript
import { db } from '../../db';
import { engineRuns, directionPredictions } from '../../../shared/schema';
import { getIndicatorSnapshot } from '../indicators/yahooFetcher';
import { desc, and, isNotNull } from 'drizzle-orm';

interface DirectionPrediction {
  suggestion: 'PUT' | 'CALL' | 'STRANGLE' | 'NO_TRADE';
  confidence: number;
  reasoning: Record<string, string>;
  indicatorBased: boolean;
}

export async function predictDirection(symbol: string, userId?: string): Promise<DirectionPrediction> {
  // Get current indicators
  const indicators = await getIndicatorSnapshot(symbol);

  // Get historical patterns for this user (if enough data)
  const history = await db.select()
    .from(engineRuns)
    .where(and(
      isNotNull(engineRuns.realizedPnl),
      userId ? eq(engineRuns.userId, userId) : undefined,
    ))
    .orderBy(desc(engineRuns.createdAt))
    .limit(50);

  // If not enough history, use pure indicator-based suggestion
  if (history.length < 10) {
    return {
      suggestion: indicators.indicatorSuggestion,
      confidence: indicators.indicatorConfidence,
      reasoning: {
        trend: indicators.trendDirection,
        momentum: indicators.momentumSignal,
        note: 'Based on indicators only (building history)',
      },
      indicatorBased: true,
    };
  }

  // Learn from history: what worked in similar conditions?
  const similarConditions = history.filter(run => {
    const runIndicators = run.indicators as any;
    if (!runIndicators) return false;

    // Similar if same trend direction and volatility regime
    return runIndicators.trendDirection === indicators.trendDirection
      && runIndicators.volatilityRegime === indicators.volatilityRegime;
  });

  if (similarConditions.length < 3) {
    // Not enough similar conditions, use indicators
    return {
      suggestion: indicators.indicatorSuggestion,
      confidence: indicators.indicatorConfidence * 0.8,
      reasoning: {
        trend: indicators.trendDirection,
        momentum: indicators.momentumSignal,
        note: 'Limited similar conditions in history',
      },
      indicatorBased: true,
    };
  }

  // Find what direction worked best in similar conditions
  const directionResults: Record<string, { wins: number; total: number }> = {};

  for (const run of similarConditions) {
    const dir = run.direction;
    if (!directionResults[dir]) {
      directionResults[dir] = { wins: 0, total: 0 };
    }
    directionResults[dir].total++;
    if (run.wasWinner) {
      directionResults[dir].wins++;
    }
  }

  // Find best direction
  let bestDirection = indicators.indicatorSuggestion;
  let bestWinRate = 0;

  for (const [dir, stats] of Object.entries(directionResults)) {
    const winRate = stats.wins / stats.total;
    if (winRate > bestWinRate && stats.total >= 3) {
      bestWinRate = winRate;
      bestDirection = dir as any;
    }
  }

  return {
    suggestion: bestDirection,
    confidence: bestWinRate,
    reasoning: {
      trend: indicators.trendDirection,
      momentum: indicators.momentumSignal,
      history: `${bestDirection} has ${Math.round(bestWinRate * 100)}% win rate in similar conditions`,
      sampleSize: `Based on ${similarConditions.length} similar trades`,
    },
    indicatorBased: false,
  };
}

export async function getAccuracyStats(userId?: string) {
  const predictions = await db.select()
    .from(directionPredictions)
    .where(isNotNull(directionPredictions.wasCorrect))
    .orderBy(desc(directionPredictions.createdAt))
    .limit(50);

  const total = predictions.length;
  const correct = predictions.filter(p => p.wasCorrect).length;
  const overrides = predictions.filter(p => p.wasOverride).length;
  const overrideCorrect = predictions.filter(p => p.wasOverride && p.overrideWasCorrect).length;

  return {
    total,
    accuracy: total > 0 ? correct / total : 0,
    overrideRate: total > 0 ? overrides / total : 0,
    overrideAccuracy: overrides > 0 ? overrideCorrect / overrides : 0,
    canAutoRun: total >= 50 && (correct / total) >= 0.8,
  };
}
```

**Step 2: Commit**

```bash
git add server/services/rlhf/
git commit -m "feat: add direction prediction service with history learning"
```

---

### Task 12: Add Direction Suggestion to UI

**Files:**
- Modify: Direction selector component in frontend

**Step 1: Show AI suggestion badge**

```typescript
// In direction selector component
const { data: suggestion } = useQuery({
  queryKey: ['direction-suggestion', symbol],
  queryFn: () => fetch(`/api/indicators/${symbol}/suggestion`).then(r => r.json()),
});

// Render suggestion badge
{suggestion && (
  <div className="ai-suggestion">
    <span>AI suggests: {suggestion.suggestion}</span>
    <span className="confidence">({Math.round(suggestion.confidence * 100)}%)</span>
  </div>
)}
```

**Step 2: Track when user agrees/disagrees**

```typescript
// When user selects direction
const handleDirectionSelect = async (direction: string) => {
  const agreedWithAi = direction === suggestion?.suggestion;

  // Record the prediction
  await fetch('/api/direction-predictions', {
    method: 'POST',
    body: JSON.stringify({
      engineRunId,
      suggestedDirection: suggestion?.suggestion,
      confidence: suggestion?.confidence,
      userChoice: direction,
      agreedWithAi,
    }),
  });
};
```

**Step 3: Commit**

```bash
git commit -m "feat: add direction suggestion UI"
```

---

## Phase 5: Accuracy Dashboard & Auto-Run

### Task 13: Add Accuracy Dashboard

**Files:**
- Create: `/Users/home/Desktop/APE YOLO/APE-YOLO/client/src/components/AccuracyDashboard.tsx`

**Step 1: Create dashboard component**

```typescript
import { useQuery } from '@tanstack/react-query';

export function AccuracyDashboard() {
  const { data: stats } = useQuery({
    queryKey: ['accuracy-stats'],
    queryFn: () => fetch('/api/rlhf/accuracy').then(r => r.json()),
  });

  if (!stats) return null;

  return (
    <div className="accuracy-dashboard">
      <h3>AI Performance</h3>

      <div className="stat">
        <span>Direction Accuracy</span>
        <span className={stats.accuracy >= 0.8 ? 'text-green-500' : 'text-yellow-500'}>
          {Math.round(stats.accuracy * 100)}%
        </span>
      </div>

      <div className="stat">
        <span>Your Override Accuracy</span>
        <span>{Math.round(stats.overrideAccuracy * 100)}%</span>
      </div>

      <div className="stat">
        <span>Trades Analyzed</span>
        <span>{stats.total}/50</span>
      </div>

      {stats.canAutoRun ? (
        <div className="auto-run-unlocked">
          AI Auto-Run Unlocked (80%+ accuracy)
        </div>
      ) : (
        <div className="progress">
          {50 - stats.total} more trades to unlock auto-run
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git commit -m "feat: add accuracy dashboard"
```

---

### Task 14: Add Auto-Run Toggle

**Files:**
- Modify: Engine control UI

**Step 1: Add auto-run toggle (only visible when unlocked)**

```typescript
const { data: stats } = useQuery(['accuracy-stats']);

{stats?.canAutoRun && (
  <div className="auto-run-toggle">
    <label>
      <input
        type="checkbox"
        checked={autoRunEnabled}
        onChange={(e) => setAutoRunEnabled(e.target.checked)}
      />
      Enable AI Auto-Direction
    </label>
    <p className="text-sm text-gray-500">
      AI will select direction automatically (you still approve final trade)
    </p>
  </div>
)}
```

**Step 2: When auto-run enabled, skip direction selection**

```typescript
const runEngine = async () => {
  let direction = selectedDirection;

  if (autoRunEnabled) {
    const prediction = await predictDirection(symbol);
    direction = prediction.suggestion;

    // Show what AI chose
    toast(`AI selected: ${direction} (${Math.round(prediction.confidence * 100)}% confidence)`);
  }

  // Continue with engine run...
};
```

**Step 3: Commit**

```bash
git commit -m "feat: add auto-run toggle for earned autonomy"
```

---

## Success Criteria

- [ ] Engine runs are logged with original strikes
- [ ] Strike adjustments are tracked (original vs final)
- [ ] Trade outcomes are linked back to engine runs
- [ ] Indicators are computed and stored
- [ ] Direction suggestions appear before selection
- [ ] User agreement/disagreement is tracked
- [ ] Accuracy dashboard shows AI performance
- [ ] Auto-run unlocks at 80% accuracy over 50 trades
- [ ] AI learns from your edge (when you override and are right)

---

**Plan complete and saved to `docs/plans/2026-01-03-rlhf-earned-autonomy.md`.**

**Two execution options:**

1. **Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

2. **Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
