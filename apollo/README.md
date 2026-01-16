# Apollo - IBKR Connection Fix Log

This folder documents fixes for IBKR connection issues. Each time we fix a connection/auth/WebSocket problem, document it here.

## Naming Convention

`NNN-short-description.md`

- `001-websocket-auth-false-fix.md`
- `002-oauth-token-expiry.md`
- etc.

## Index

| # | Date | Issue | File |
|---|------|-------|------|
| 001 | 2026-01-17 | WebSocket ignoring `authenticated: false` | [001-websocket-auth-false-fix.md](./001-websocket-auth-false-fix.md) |

## Quick Troubleshooting

### No Market Data
1. Check WebSocket status in logs: `[IbkrWS]`
2. Look for `authenticated=false` in `sts` message
3. Check OAuth token expiry (10 min)
4. Check SSO session expiry (9 min)

### Orders Not Executing
1. Check if WebSocket is authenticated
2. Look for `rejected_no_order_id` in logs
3. Check IBKR account margin/buying power
4. Verify CONID resolution worked

### Connection Loop
1. Check for 401 errors in logs
2. Force clear session: call `clearIbkrSession()`
3. Restart the Cloud Run instance
