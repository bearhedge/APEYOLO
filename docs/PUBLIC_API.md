# APE-YOLO Public API

Base URL: `https://apeyolo.com/api/public`

## Endpoints

### GET /track-record

Returns daily P&L history and cumulative stats for track record display.

**Response:**
```json
{
  "ok": true,
  "daily": [
    { "date": "2025-12-27", "pnl": "69.00", "trades": "2", "contracts": "4" },
    { "date": "2025-12-22", "pnl": "48.00", "trades": "1", "contracts": "2" }
  ],
  "totals": {
    "totalPnl": "685.00",
    "totalTrades": "8",
    "winRate": 100
  },
  "generatedAt": "2026-01-01T..."
}
```

### GET /trades

Returns recent trades with details.

**Query Parameters:**
- `limit` (optional): Number of trades to return (default: 20, max: 100)

**Response:**
```json
{
  "ok": true,
  "trades": [
    {
      "id": "uuid",
      "symbol": "SPY",
      "strategy": "put_credit_spread",
      "bias": "bullish",
      "contracts": 2,
      "entryPremiumTotal": "120.00",
      "realizedPnl": "69.00",
      "status": "expired",
      "expiration": "2025-12-27",
      "createdAt": "2025-12-27T...",
      "closedAt": "2025-12-27T...",
      "leg1Strike": "585",
      "leg2Strike": "580"
    }
  ],
  "count": 10
}
```

### GET /stats

Returns aggregate stats for projects section display.

**Response:**
```json
{
  "ok": true,
  "users": 1,
  "totalTrades": "10",
  "totalTurnover": "905.00",
  "totalPnl": "685.00"
}
```

### GET /option-bars/:symbol

Returns option bar OHLC data for charts.

**Path Parameters:**
- `symbol`: Stock symbol (e.g., SPY, QQQ)

**Query Parameters:**
- `hours` (optional): Hours of data to return (default: 6, max: 24)

**Response:**
```json
{
  "ok": true,
  "symbol": "SPY",
  "bars": [
    {
      "id": "uuid",
      "symbol": "SPY",
      "intervalStart": "2025-12-27T14:00:00.000Z",
      "open": "1.25",
      "high": "1.50",
      "low": "1.20",
      "close": "1.45",
      "volume": 1500
    }
  ],
  "count": 72
}
```

## CORS Configuration

Allowed origins:
- `https://bearhedge.com`
- `http://localhost:3000`
- `http://localhost:5173`

Allowed methods: `GET` only

## Usage Example (JavaScript)

```javascript
// Fetch track record for bearhedge.com
async function getTrackRecord() {
  const response = await fetch('https://apeyolo.com/api/public/track-record');
  const data = await response.json();

  if (data.ok) {
    console.log('Total P&L:', data.totals.totalPnl);
    console.log('Win Rate:', data.totals.winRate + '%');
    console.log('Daily Records:', data.daily);
  }
}

// Fetch aggregate stats
async function getStats() {
  const response = await fetch('https://apeyolo.com/api/public/stats');
  const data = await response.json();

  if (data.ok) {
    console.log('Total Trades:', data.totalTrades);
    console.log('Total Turnover:', data.totalTurnover);
  }
}
```

## Rate Limits

No explicit rate limits. Cloud Run will auto-scale.

## Authentication

None required. Public endpoints.
