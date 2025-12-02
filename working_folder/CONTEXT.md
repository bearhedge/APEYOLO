# APEYOLO Session Context

**Purpose**: Enables Claude Code to resume work across sessions with full context.

---

## CURRENT OBJECTIVE (2025-12-01)

### Goal: Complete IBKR Data Integration

Plug IBKR into the system for:
1. **Historical candlestick data** - Chart bars from IBKR (not Yahoo Finance)
2. **Real-time WebSocket streaming** - Live price updates pushed to browser

### Current IBKR Connection Status: CONNECTED

```
Authentication Pipeline Status:
- OAuth Token:           Connected (200)
- SSO Session:           Active (200)
- Session Validation:    Validated (200)
- Brokerage Init:        Ready (200)

Environment: paper
Account ID:  DU9807013
```

---

## ARCHITECTURE OVERVIEW

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        IBKR DATA INTEGRATION                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     BROWSER (Data.tsx)                              │    │
│  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐  │    │
│  │  │ DeterminChart│    │ OptionChain  │    │ Price Display        │  │    │
│  │  │ (candlestick)│    │ (PUT/CALL)   │    │ ($XXX.XX + change)   │  │    │
│  │  └──────────────┘    └──────────────┘    └──────────────────────┘  │    │
│  │         ↑                   ↑                      ↑               │    │
│  │         │                   │                      │               │    │
│  │  ┌──────┴───────────────────┴──────────────────────┴─────────┐    │    │
│  │  │              WebSocket Connection (useWebSocket)          │    │    │
│  │  │              - underlying_price_update                    │    │    │
│  │  │              - option_chain_update                        │    │    │
│  │  └───────────────────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    ↑                                         │
│                                    │ WebSocket                               │
│                                    ↓                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     EXPRESS SERVER (/api)                           │    │
│  │                                                                     │    │
│  │  HTTP ENDPOINTS:                                                    │    │
│  │  ├── /api/chart/history/:symbol     → ibkrHistoricalService.ts     │    │
│  │  ├── /api/broker/test-market/:sym   → ibkr.ts getMarketData()      │    │
│  │  ├── /api/broker/test-options/:sym  → ibkr.ts getOptionChain()     │    │
│  │  └── /api/broker/stream/*           → optionChainStreamer.ts       │    │
│  │                                                                     │    │
│  │  WEBSOCKET SERVER:                                                  │    │
│  │  └── /ws                            → broadcasts to browser         │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    ↑                                         │
│                                    │                                         │
│                                    ↓                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     IBKR INTEGRATION LAYER                          │    │
│  │                                                                     │    │
│  │  ┌───────────────────────┐    ┌────────────────────────────────┐   │    │
│  │  │ ibkrWebSocket.ts      │    │ ibkr.ts                        │   │    │
│  │  │ - Real-time streaming │    │ - HTTP snapshot requests       │   │    │
│  │  │ - wss://api.ibkr.com  │    │ - Option chain, market data    │   │    │
│  │  │ - Pushes to cache     │    │ - Symbol → conid resolution    │   │    │
│  │  └───────────────────────┘    └────────────────────────────────┘   │    │
│  │                                                                     │    │
│  │  ┌───────────────────────┐    ┌────────────────────────────────┐   │    │
│  │  │ ibkrHistoricalService │    │ optionChainStreamer.ts         │   │    │
│  │  │ - OHLCV bar data      │    │ - Option chain cache           │   │    │
│  │  │ - Timeframes: 1m-1D   │    │ - Auto-start at market open    │   │    │
│  │  │ - Curated bars        │    │ - Broadcasts to browser WS     │   │    │
│  │  └───────────────────────┘    └────────────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    ↑                                         │
│                                    │ HTTPS/WSS                               │
│                                    ↓                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                     IBKR CLIENT PORTAL API                          │    │
│  │  Base URL: https://api.ibkr.com                                     │    │
│  │  WebSocket: wss://api.ibkr.com/v1/api/ws                           │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## KEY FILES

### Server - IBKR Integration

| File | Purpose |
|------|---------|
| `server/broker/ibkr.ts` | Core IBKR client - auth, market data, option chains |
| `server/broker/ibkrWebSocket.ts` | WebSocket streaming to IBKR for real-time data |
| `server/broker/optionChainStreamer.ts` | Option chain cache with browser broadcast |
| `server/services/ibkrHistoricalService.ts` | Historical OHLCV bars from IBKR |
| `server/routes.ts` | All API endpoints |

### Client - Data Display

| File | Purpose |
|------|---------|
| `client/src/pages/Data.tsx` | Main data page - chart + option chain |
| `client/src/components/DeterministicChart.tsx` | Canvas-based candlestick chart |
| `client/src/engine/ChartEngine.ts` | Low-level chart rendering engine |
| `client/src/hooks/use-websocket.ts` | WebSocket connection hook |

---

## DATA FLOW: HISTORICAL BARS (CHART)

```
User selects SPY + 5m timeframe
        │
        ▼
DeterministicChart.tsx
        │
        ▼ fetch()
/api/chart/history/SPY?timeframe=5m
        │
        ▼
routes.ts → ibkrHistoricalService.fetchHistoricalBars()
        │
        ▼
ensureIbkrReady() → resolveSymbolConid(SPY) → 756733
        │
        ▼
fetchIbkrHistoricalData(756733, {period: '2d', bar: '5mins'})
        │
        ▼
IBKR: GET /iserver/marketdata/history?conid=756733&period=2d&bar=5mins
        │
        ▼
Returns: [{t: timestamp, o: open, h: high, l: low, c: close, v: volume}, ...]
        │
        ▼
sanitizeBars() → CuratedBar[] with provenance {source: 'ibkr', fetchedAt, version}
        │
        ▼
Cache (60s TTL) → Return to client
        │
        ▼
ChartEngine renders candlesticks on Canvas
```

---

## DATA FLOW: REAL-TIME WEBSOCKET

```
Server starts
        │
        ▼
IbkrWebSocketManager.connect() → wss://api.ibkr.com/v1/api/ws
        │
        ▼
subscribe('smd+756733+{"fields":["31","84","86"]}')  // SPY: last, bid, ask
        │
        ▼
IBKR pushes price updates
        │
        ▼
handleMarketDataUpdate() → parses fields 31/84/86
        │
        ▼
optionChainStreamer.broadcastOptionChainUpdate()
        │
        ▼
Express WS server → wsClients.forEach(client.send())
        │
        ▼
Browser useWebSocket hook receives message
        │
        ▼
Data.tsx updates: liveOptionChain, liveUnderlyingPrice
        │
        ▼
UI shows live price with "WS Connected" indicator
```

---

## API ENDPOINTS

### Historical Data (Chart)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/chart/history/:symbol` | GET | IBKR historical OHLCV bars |
| Query: `timeframe` | - | `1m`, `5m`, `15m`, `1h`, `1D` |
| Query: `count` | - | Number of bars (default: 200) |

### Market Data (Snapshot)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/broker/test-market/:symbol` | GET | Current price snapshot from IBKR |
| `/api/broker/test-options/:symbol` | GET | Option chain from IBKR |

### WebSocket Streaming

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/broker/ws/start` | POST | Connect to IBKR WebSocket |
| `/api/broker/ws/stop` | POST | Disconnect from IBKR WebSocket |
| `/api/broker/ws/subscribe` | POST | Subscribe to symbol `{symbol, type}` |
| `/api/broker/ws/status` | GET | Connection status |

### Option Chain Streamer (Cache)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/broker/stream/start` | POST | Start streaming for symbol |
| `/api/broker/stream/stop` | POST | Stop streaming |
| `/api/broker/stream/status` | GET | Streamer status |
| `/api/broker/stream/chain/:symbol` | GET | Get cached option chain |

### IBKR Status

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ibkr/status` | GET | Auth pipeline status (4 steps) |
| `/api/ibkr/test` | POST | Force re-authenticate |

---

## CRITICAL BUGS (Dec 1, 2025)

### BUG 1: BLACK CHART (Debugging in progress)

**Status**: Added debug logging and validation. Deployed.

**What was added**:
- `ChartEngine.ts`: Explicit guards for empty visibleBars and NaN price values
- `DeterministicChart.tsx`: Console logging of fetched bar data

**Next steps**:
1. Open https://apeyolo.com/data in browser
2. Open browser console (F12)
3. Look for:
   - `[DeterministicChart] Fetched bars:` - shows raw data from API
   - `[Chart] Rendering` - shows render attempt
   - `[ChartEngine]` errors - shows why rendering fails
4. If still black with no errors, the issue is CSS or canvas initialization

**API confirmed working**:
```bash
curl "https://apeyolo.com/api/chart/history/SPY?timeframe=5m&count=10"
# Returns valid OHLCV: {"bars":[{"time":1764601560,"open":680.93,"high":681.25,"low":680.83,"close":681.07},...]}
```

---

### BUG 2: "Market Closed" shows when market is OPEN

**Root cause**: `Data.tsx` uses `isMarketClosed = ibkrPrice === 0 && lastClosePrice !== null`

**Fix needed**: Replace with actual market hours check (9:30 AM - 4 PM ET weekdays)

---

### BUG 3: "Start Streaming" button hangs forever

**Root cause**: `POST /api/broker/stream/start` → `getOptionChainWithStrikes()` makes many IBKR HTTP calls with NO TIMEOUT

**Fix needed**: Add 30-second timeout to endpoint, per-request timeouts to IBKR calls

---

## LEGACY ISSUES (Lower Priority)

### Issue 1: Silent Yahoo Finance Fallback

**Problem**: When IBKR returns price=0 (session expired), UI silently falls back to Yahoo Finance without indication.

**Location**: `Data.tsx` line ~339
```typescript
const displayPrice = ibkrPrice > 0 ? ibkrPrice : (lastClosePrice || 0);
```

**Fix Needed**:
- Add data source indicator showing "IBKR Live" vs "Yahoo Fallback"
- Show "IBKR Disconnected" banner when auth fails
- Add "Reconnect" button to trigger `/api/ibkr/test`

### Issue 2: WebSocket Disconnects

**Problem**: Browser WebSocket shows "Disconnected" intermittently.

**Possible Causes**:
- Cloud Run cold starts (container restarts)
- IBKR session expiry (typically 1-24 hours)
- Network issues

**Fix Needed**:
- Auto-reconnect logic in `useWebSocket` hook
- Session keepalive (call `/v1/api/tickle` every 5 min)
- Better connection state management

### Issue 3: No Auto-Reauthentication

**Problem**: When IBKR session expires, market data returns 0 instead of re-authenticating.

**Location**: `server/broker/ibkr.ts`

**Fix Needed**:
- Add retry logic in `getMarketData()` - if returns 0/error, call `ensureReady()` and retry once
- Log: "IBKR session expired, reauthenticating..."

---

## TESTING COMMANDS

### Verify IBKR Connection
```bash
curl -s https://apeyolo.com/api/ibkr/status | jq .
# Expected: connected: true, all steps: Connected/200
```

### Test Historical Bars
```bash
curl -s "https://apeyolo.com/api/chart/history/SPY?timeframe=5m&count=5" | jq .
# Expected: bars with source: 'ibkr', real OHLCV data
```

### Test Market Snapshot
```bash
curl -s https://apeyolo.com/api/broker/test-market/SPY | jq .
# Expected: price > 0 (e.g., 680.00)
```

### Test Option Chain
```bash
curl -s https://apeyolo.com/api/broker/test-options/SPY | jq .
# Expected: puts/calls with strikes, deltas, Greeks
```

### Force Re-authenticate
```bash
curl -X POST https://apeyolo.com/api/ibkr/test | jq .
```

---

## PRODUCTION

- **URL**: https://apeyolo.com
- **Cloud Run Service**: `apeyolo` (asia-east1)
- **Project**: fabled-cocoa-443004-n3

### Deploy
```bash
./scripts/deploy.sh prod
```

---

## CONID REFERENCE

| Symbol | Conid | Type |
|--------|-------|------|
| SPY | 756733 | US Stock |
| VIX | 13455763 | Index |

---

**Last Updated**: 2025-12-01
