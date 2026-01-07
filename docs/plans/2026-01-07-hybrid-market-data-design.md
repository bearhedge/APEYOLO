# Hybrid Market Data Design

## Overview

Display accurate, real-time SPY and VIX prices on the Engine page using a hybrid data source approach: IBKR WebSocket for market hours, Yahoo Finance for extended hours.

## Requirements

- **Accuracy**: Show actual current SPY price (not stale data)
- **Real-time updates**: Price updates continuously without page refresh
- **Extended hours support**: Pre-market (4 AM - 9:30 AM ET) and after-hours (4 PM - 8 PM ET)
- **Data points**: SPY price + VIX + change % with timestamp
- **Fallback**: Use futures (ES=F) when regular symbols unavailable

## Data Source Architecture

### Three-tier priority

1. **IBKR WebSocket** (highest priority)
   - Real-time streaming during market hours
   - SPY conid: 756733, VIX conid: 13455763

2. **Yahoo Finance** (fallback for extended hours)
   - Polls every 15 seconds
   - Symbols: SPY, ^VIX
   - Free, no API key needed

3. **Futures fallback** (when regular symbols unavailable)
   - ES=F (S&P 500 futures) instead of SPY
   - ^VIX still available most times

### Time-based source selection

| Time (ET) | Primary | Fallback |
|-----------|---------|----------|
| 9:30 AM - 4:00 PM (market hours) | IBKR WebSocket | Yahoo Finance |
| 4:00 AM - 9:30 AM (pre-market) | Yahoo Finance | Yahoo Futures |
| 4:00 PM - 8:00 PM (after-hours) | Yahoo Finance | Yahoo Futures |
| 8:00 PM - 4:00 AM (closed) | Last known price | Show "Market Closed" |

## Implementation

### New endpoint: GET /api/market/snapshot

Determines current time period, tries data sources in priority order, returns unified response:

```typescript
{
  spy: { price: 592.40, change: 1.25, changePct: 0.21 },
  vix: { price: 16.82, change: -0.45, changePct: -2.61 },
  source: 'ibkr' | 'yahoo' | 'futures',
  marketState: 'PRE' | 'REGULAR' | 'POST' | 'CLOSED',
  timestamp: '2026-01-07T14:32:15Z',
  isDelayed: false
}
```

### Yahoo Finance integration

- Use `yahoo-finance2` npm package (well-maintained, free)
- No API key required
- Supports extended hours quotes via `quote()` method
- Fields: `regularMarketPrice`, `preMarketPrice`, `postMarketPrice`, `regularMarketChange`, `regularMarketChangePercent`

### Client-side polling

- 2-second polling during market hours (IBKR is real-time)
- 15-second polling during extended hours (Yahoo Finance)
- Always display timestamp from response

## Error Handling

### Fallback chain

```
IBKR WebSocket fails → Yahoo Finance → Yahoo Futures → Last known + stale indicator
```

### Stale data indicators

- Data older than 60 seconds during active hours → Yellow "Delayed" badge
- Data older than 5 minutes → Orange "Stale" badge with timestamp
- No data available → Show "—" with "Connecting..." message

### Source indicator labels

- "LIVE" (green) - IBKR WebSocket active
- "DELAYED" (yellow) - Yahoo Finance, within 60 sec
- "STALE" (orange) - Data older than 60 sec

### Holiday/weekend handling

- Detect US market holidays
- Show "Market Closed" with previous close price
- No polling during closed periods

### Network failure

- Retry up to 3 times with exponential backoff
- After 3 failures, show last known data with error indicator
- Resume normal polling when connection restored

## Files to Modify

### New files

- `server/services/yahooFinance.ts` - Yahoo Finance API wrapper
- `server/services/marketDataService.ts` - Unified market data service

### Modified files

- `server/routes.ts` - Add GET /api/market/snapshot endpoint
- `client/src/hooks/useMarketSnapshot.ts` - Use new endpoint, adjust polling

### Dependencies

- `yahoo-finance2` - Yahoo Finance API (free, no key)

## Testing

1. Test during market hours → Verify IBKR WebSocket works
2. Test during extended hours → Verify Yahoo Finance kicks in
3. Disconnect IBKR → Verify fallback works
4. Use Playwright to screenshot and verify displayed prices match source
