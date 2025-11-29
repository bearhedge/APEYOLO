# APEYOLO Session Context

**Purpose**: Enables Claude Code to resume work across sessions with full context.

---

## CURRENT STATUS (2025-11-29 Late Evening)

### ✅ WebSocket Cache Layer Implemented

| Component | Status | Notes |
|-----------|--------|-------|
| **IBKR Market Data** | ✅ Ready | SPY resolves to US conid 756733 |
| **Option Chain + VIX σ** | ✅ Ready | 2σ strike filtering, Greeks, OI, IV |
| **WebSocket Streaming** | ✅ Ready | Real-time push updates from IBKR |
| **Option Chain Cache** | ✅ NEW | Engine reads from cache for instant strike selection |
| **Auto-Start at Market Open** | ✅ NEW | Streaming auto-starts at 9:30 AM ET |

### Why Engine Shows "Mock Data" Right Now

When you run the engine on weekends, Step 3 shows:
```
PUT (mock): Strike $431... Data source: mock estimates. Underlying: $450.00
```

**This is EXPECTED** - IBKR returns no data when market is closed, so the engine falls back to mock data.

---

## What to Expect Monday (Market Open)

### Engine Step 3 Will Show:
```
PUT (IBKR): Strike $595 with delta 0.18
CALL (IBKR): Strike $605 with delta 0.18
Data source: IBKR real-time. Underlying: $600.00.
```

| Field | Weekend (Now) | Monday (Expected) |
|-------|---------------|-------------------|
| Data source | "mock estimates" | "IBKR real-time" |
| Underlying | $450.00 (hardcoded) | ~$600 (real SPY) |
| Strikes | Random mock | Real IBKR strikes |
| Delta | ~0.39 (calculated) | ~0.15-0.20 (from IBKR) |

---

## Architecture: WebSocket Cache Layer (NEW)

```
┌─────────────────────────────────────────────────────────────────┐
│                     TRADING SYSTEM LAYERS                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Layer 3: ENGINE (Decision Making)                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Step 1: Market Regime → Step 2: Direction →              │   │
│  │ Step 3: Strike Selection → Step 4: Sizing → Step 5: Exit │   │
│  │         ↓                                                │   │
│  │    Reads from OptionChainCache (instant, no HTTP)        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                         ↑                                       │
│  Layer 2: OPTION CHAIN CACHE (Live Data Store)                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ OptionChainStreamer                                      │   │
│  │ - Maintains live option chain in memory                  │   │
│  │ - Updates on every WebSocket push                        │   │
│  │ - Provides instant reads for engine                      │   │
│  │ - Falls back to HTTP if cache stale/empty                │   │
│  └─────────────────────────────────────────────────────────┘   │
│                         ↑                                       │
│  Layer 1: WEBSOCKET STREAMING (Data Transport)                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ IbkrWebSocketManager (already built)                     │   │
│  │ - Connects to wss://api.ibkr.com/v1/api/ws               │   │
│  │ - Subscribes to SPY + option conids                      │   │
│  │ - Pushes updates to Layer 2 cache                        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                         ↑                                       │
│                    IBKR WebSocket API                           │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

**Monday 9:30 AM ET - Market Opens:**
1. Server auto-starts `OptionChainStreamer`
2. Fetches initial option chain via HTTP (gets conids)
3. Subscribes all option conids via WebSocket
4. Cache populates with real-time updates

**11:00 AM ET - Trading Window Opens:**
1. Engine runs
2. Step 3 reads from cache (instant, already populated)
3. Gets real-time bid/ask/delta
4. Selects optimal strike

### Fallback Strategy

```
Engine needs option chain
        ↓
    Cache available?
    /            \
  YES             NO
   ↓               ↓
Read cache    HTTP snapshot
(instant)     (200-500ms latency)
```

---

## API Endpoints

### Option Chain Streamer (NEW - for Engine)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/broker/stream/start` | POST | Start streaming for symbol (default: SPY) |
| `/api/broker/stream/stop` | POST | Stop streaming (all or specific symbol) |
| `/api/broker/stream/status` | GET | Get streamer status |
| `/api/broker/stream/chain/:symbol` | GET | Get cached option chain |
| `/api/broker/stream/schedule` | POST | Schedule auto-start at market open |

### WebSocket Streaming (for UI)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/broker/ws/start` | POST | Start WebSocket connection to IBKR |
| `/api/broker/ws/stop` | POST | Stop WebSocket connection |
| `/api/broker/ws/subscribe` | POST | Subscribe to a symbol `{symbol, type}` |
| `/api/broker/ws/subscribe-options` | POST | Subscribe to option conids `{symbol, conids}` |
| `/api/broker/ws/subscribe/:symbol` | DELETE | Unsubscribe from a symbol |
| `/api/broker/ws/status` | GET | Get connection status |

---

## Monday Verification Checklist

### 1. Test SPY Price
```bash
curl -s https://apeyolo.com/api/broker/test-market/SPY | jq .
# Expected: price ~$600, not 0
```

### 2. Test Option Chain
```bash
curl -s https://apeyolo.com/api/broker/test-options/SPY | jq .
# Expected: Real strikes, Greeks, IV, OI
```

### 3. Check Streamer Status
```bash
# Check if auto-scheduled
curl -s https://apeyolo.com/api/broker/stream/status | jq .
# Expected: isStreaming: true (after 9:30 AM)
```

### 4. Run Engine
- Click "Run Engine" in the UI
- Step 3 should show "Using WebSocket cache" or "IBKR real-time"
- Strikes should be real (within 2σ of SPY price)

### 5. Test Cached Chain (Optional)
```bash
curl -s https://apeyolo.com/api/broker/stream/chain/SPY | jq .
# Expected: cached: true, with puts and calls
```

---

## Key Files

| File | Purpose |
|------|---------|
| `server/broker/optionChainStreamer.ts` | NEW - Cache layer for engine |
| `server/broker/ibkrWebSocket.ts` | WebSocket streaming module |
| `server/broker/ibkr.ts` | IBKR client, option chain, Greeks |
| `server/routes.ts` | API endpoints (HTTP + WebSocket + Streamer) |
| `server/engine/step3.ts` | Strike selection (now uses cache first) |

---

## Session Changes (2025-11-29 Late Evening)

### 1. Option Chain Streamer Module (NEW)
   - Created `server/broker/optionChainStreamer.ts`
   - Maintains live option chain cache in memory
   - Auto-starts at market open (9:30 AM ET)
   - Falls back to HTTP when cache is stale (>5s)

### 2. Engine Step 3 Integration
   - Modified `server/engine/step3.ts` to try cache first
   - Uses `getOptionChainStreamer().getOptionChain(symbol)`
   - Falls back to HTTP if cache unavailable

### 3. New API Endpoints
   - `/api/broker/stream/start` - Manual start
   - `/api/broker/stream/stop` - Stop streaming
   - `/api/broker/stream/status` - Check status
   - `/api/broker/stream/chain/:symbol` - View cached data
   - `/api/broker/stream/schedule` - Schedule for market open

### 4. Auto-Start at Server Startup
   - Server automatically schedules streaming for 9:30 AM ET
   - No manual intervention needed on production

---

## Production Status

- **URL**: https://apeyolo.com
- **Cloud Run Service**: `apeyolo` (asia-east1)
- **IBKR Status**: All 4 phases returning 200 (oauth, sso, validate, init)

---

**Last Updated**: 2025-11-29T23:30:00Z
