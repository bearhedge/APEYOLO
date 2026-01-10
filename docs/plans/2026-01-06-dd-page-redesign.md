# DD Page Redesign - Live / Train / Research

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unified DD page with three modes - Live (real-time market), Train (realistic replay), Research (pattern mining)

**Architecture:** Single page with tab navigation, shared chart component with 3-day historical context, mode-specific controls and data flows

**Tech Stack:** React, lightweight-charts, IBKR WebSocket, PostgreSQL

---

## Page Structure

```
┌─────────────────────────────────────────────────────────────┐
│ [LeftNav]  │  [Live]  [Train]  [Research]                   │
│            │─────────────────────────────────────────────────│
│  Agent     │                                                 │
│  Engine    │  ┌─────────────────────────────────────────┐   │
│  Portfolio │  │  Chart (3-day context + current day)    │   │
│  DD ←      │  │  - Date separators, Yahoo Finance style │   │
│  Jobs      │  │  - Building candle + live price line    │   │
│  Settings  │  └─────────────────────────────────────────┘   │
│            │                                                 │
│            │  ┌─────────────────────────────────────────┐   │
│            │  │  Options Chain                          │   │
│            │  └─────────────────────────────────────────┘   │
│            │                                                 │
│            │  [Decision Panel / Observation Log]            │
└─────────────────────────────────────────────────────────────┘
```

## Three Tabs

| Tab | Purpose | Chart | Options Chain | User Action |
|-----|---------|-------|---------------|-------------|
| **Live** | Real-time market monitoring + data capture | Real-time (2-3s display updates) | Real-time streaming | Watch + Capture |
| **Train** | Realistic replay training (no time travel) | Progressive reveal (90m windows) | Frozen at window time | Decide or Pass |
| **Research** | Pattern mining (jump to any time) | Jump to any timestamp | At selected timestamp | Log observations |

---

## Live Mode

**Purpose:** Watch real-time market, capture data for future analysis

**Features:**
- Live chart showing today + 3 previous days context
- Building candle (current candle grows in real-time)
- Live price line (horizontal line showing exact current price)
- Real-time options chain (streaming updates every 2-3s)
- Market context strip (SPY, VIX, DXY, 10Y yield)
- Capture status indicator

**Data Flow:**
- Display: 2-3 second updates from IBKR WebSocket (in-memory)
- Storage: 1-minute snapshots to database

---

## Train Mode

**Purpose:** Realistic decision-making training with no time travel

**Flow:**
```
[Select Random Day] → See 3-day context + First 90 min (9:30-11:00)
                    ↓
              [Decide] or [Pass to Next Window]
                    ↓
         If Pass → Reveal Next 90 min (11:00-12:30)
                    ↓
              [Decide] or [Pass to End]
                    ↓
         If Pass → Reveal Rest of Day (12:30-16:00)
                    ↓
              [Decide] or [No Trade]
                    ↓
              See Outcome + Score
```

**Key Constraints:**
- Once you reveal next window, cannot go back
- Decision locks you in - no changing after
- Captures WHEN you decided (early edge vs needed more data)

**UI Elements:**
- Time window indicator: "Window 1: 9:30-11:00"
- Decision Panel: Direction (PUT/CALL/STRANGLE/NO TRADE) + Reasoning textarea
- "Next Window →" button (disabled after decision)
- Outcome reveal after decision

**Data Captured:**
- Which window decision was made in
- User reasoning at decision point
- Outcome (win/loss, P&L)

---

## Research Mode

**Purpose:** Pattern mining - study historical data from multiple angles

**Flow:**
```
[Select Day] → Full 3-day context visible
            ↓
[Jump to Timestamp] → 10:00, 10:30, 11:00, 11:30...
            ↓
Chart shows data UP TO that timestamp (future hidden)
            ↓
[Log Observation] → What do you see? What would you do?
            ↓
Jump to another timestamp, log again (unlimited)
            ↓
[Next Day] when done
```

**UI Elements:**
- Timestamp picker (30-min increments)
- Observation log form:
  - "At [time], I see: ___"
  - "I would: PUT / CALL / STRANGLE / WAIT / NO TRADE"
  - "Confidence: Low / Medium / High"
- Observation history sidebar

**Data Captured:**
- Multiple observations per day
- Patterns noticed at different timestamps
- No outcome scoring (research, not training)

---

## Chart Component (Shared)

**Style:** Yahoo Finance-like continuous chart

**Features:**
- 3 previous days + current day (4 days total)
- Vertical date separator lines with date labels on x-axis
- Scrollable left to see more history
- 1-minute candles

**Live Mode Additions:**
- Building candle (current candle updates in real-time)
- Live price line (horizontal line at current price)

**Train/Research Mode:**
- Static historical data
- Time-filtered based on current window/timestamp

---

## Options Chain Component (Shared)

**Columns:** Strike, Bid, Ask, Delta, IV, Volume, OI

**Live Mode:**
- Real-time streaming (2-3s display updates)
- Highlight changes (green/red flash on bid/ask changes)
- "As of [time]" indicator

**Train Mode:**
- Frozen at current window's end time
- Updates when window advances

**Research Mode:**
- Shows chain at selected timestamp
- Updates when timestamp changes

---

## Data Architecture

**Display vs Storage:**

| Layer | Frequency | Purpose |
|-------|-----------|---------|
| Display | 2-3 seconds | Real-time UX (in-memory only) |
| Storage | 1 minute | Historical dataset (~1 GB/year) |

**Database Tables:**

```sql
-- 1-minute candles
live_candles (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(10),
  date DATE,
  timestamp TIMESTAMP,
  open DECIMAL,
  high DECIMAL,
  low DECIMAL,
  close DECIMAL,
  volume BIGINT,
  UNIQUE(symbol, timestamp)
)

-- 1-minute options snapshots
live_options (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(10),
  timestamp TIMESTAMP,
  strike DECIMAL,
  right VARCHAR(4), -- PUT/CALL
  bid DECIMAL,
  ask DECIMAL,
  delta DECIMAL,
  iv DECIMAL,
  volume INT,
  open_interest INT,
  UNIQUE(symbol, timestamp, strike, right)
)
```

**Capture Reliability:**
- IBKR WebSocket with auto-reconnect
- Queue + retry for missed minutes
- Unique constraints prevent duplicates
- Market hours only (9:30-16:00 ET)

---

## Implementation Priority

1. **Phase 1:** Add LeftNav to existing ReplayTrainer, rename to DD
2. **Phase 2:** Add tab structure (Live/Train/Research)
3. **Phase 3:** Enhance chart with 3-day context + date separators
4. **Phase 4:** Implement Train mode with fixed windows
5. **Phase 5:** Implement Research mode with timestamp jumping
6. **Phase 6:** Implement Live mode with real-time updates
7. **Phase 7:** Add 1-minute data capture infrastructure

---

## Files to Modify/Create

**Modify:**
- `client/src/pages/ReplayTrainer.tsx` → Rename and restructure as DD.tsx
- `client/src/components/replay/HistoricalChart.tsx` → Add 3-day context, date separators
- `server/replayRoutes.ts` → Add multi-day data fetching

**Create:**
- `client/src/components/dd/LiveTab.tsx`
- `client/src/components/dd/TrainTab.tsx`
- `client/src/components/dd/ResearchTab.tsx`
- `client/src/components/dd/ObservationLog.tsx`
- `server/services/liveCapture.ts` → 1-minute capture service

**Schema:**
- `shared/schema.ts` → Add live_candles, live_options tables
