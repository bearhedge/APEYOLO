## 2025-11-29

### UI Restructuring (NEW)
- **Added**: New Data page (`/data`)
  - Ticker search functionality
  - Live stock chart with sparkline visualization
  - Full option chain viewer with PUT/CALL tables
  - WebSocket streaming integration for real-time updates
  - Shows data source indicator (WebSocket Cache vs HTTP Snapshot)
- **Merged**: Portfolio + Trades pages
  - Portfolio now has tabs: [Positions] [History]
  - Trades content moved to History tab
  - `/trades` route redirects to `/portfolio`
- **Refactored**: Engine Step 2 (Direction)
  - Replaced full SPY chart with compact MiniPriceWidget
  - Shows current price, change %, and mini sparkline
  - Link to Data page for full chart
  - VIX chart remains in Step 1 (special case for market regime)
- **Updated**: Navigation
  - Replaced Trades with Data in LeftNav
  - New icon (BarChart2) for Data page

### Files Modified
- `client/src/pages/Data.tsx` - NEW market data exploration page
- `client/src/components/MiniPriceWidget.tsx` - NEW compact price widget
- `client/src/pages/Portfolio.tsx` - Added tabs, merged Trades content
- `client/src/pages/Engine.tsx` - Use MiniPriceWidget in Step 2
- `client/src/components/StepCard.tsx` - Added useMiniWidget prop to DirectionContent
- `client/src/components/LeftNav.tsx` - Updated nav items
- `client/src/App.tsx` - Added Data route, /trades redirect

---

### Option Chain Streamer - WebSocket Cache Layer (NEW)
- **Added**: WebSocket cache layer for engine strike selection
  - Engine Step 3 now reads from cache first (instant, no HTTP latency)
  - Falls back to HTTP snapshot if cache is stale (>5s) or unavailable
  - Maintains live option chain in memory, updated via WebSocket
- **Added**: Auto-start at market open (9:30 AM ET)
  - Server automatically schedules streaming on startup
  - Streaming starts when market opens on trading days
  - Cache ready before 11:00 AM ET trading window
- **Added**: New module `server/broker/optionChainStreamer.ts`
  - `OptionChainStreamer` class with cache management
  - Subscribes to all option conids within 2σ strike range
  - Periodic refresh every 5 minutes as backup
- **Added**: New API endpoints for Option Chain Streamer:
  - `POST /api/broker/stream/start` - Start streaming for symbol
  - `POST /api/broker/stream/stop` - Stop streaming
  - `GET /api/broker/stream/status` - Get streamer status
  - `GET /api/broker/stream/chain/:symbol` - Get cached option chain
  - `POST /api/broker/stream/schedule` - Schedule auto-start at market open
- **Modified**: `server/engine/step3.ts` - Now tries WebSocket cache before HTTP

### Files Modified
- `server/broker/optionChainStreamer.ts` - NEW cache layer module
- `server/engine/step3.ts` - Integrated cache-first data fetching
- `server/routes.ts` - Added streamer endpoints and auto-schedule at startup

---

### IBKR WebSocket Streaming (NEW)
- **Added**: Real-time WebSocket streaming from IBKR API
  - Connects directly to `wss://api.ibkr.com/v1/api/ws` for continuous market data
  - Replaces polling (snapshot every 5s) with instant push updates
  - Automatic heartbeat (every 25s) to keep connection alive
  - Reconnection with exponential backoff on disconnect
- **Added**: New API endpoints for WebSocket control:
  - `POST /api/broker/ws/start` - Start WebSocket connection
  - `POST /api/broker/ws/stop` - Stop WebSocket connection
  - `POST /api/broker/ws/subscribe` - Subscribe to a symbol
  - `POST /api/broker/ws/subscribe-options` - Subscribe to option conids
  - `DELETE /api/broker/ws/subscribe/:symbol` - Unsubscribe from symbol
  - `GET /api/broker/ws/status` - Get connection status and subscriptions
- **Added**: New module `server/broker/ibkrWebSocket.ts`
  - `IbkrWebSocketManager` class with connection management
  - Broadcasts IBKR updates to browser clients via existing `/ws` endpoint
  - Field parsing for price, Greeks, IV, and open interest
- **Added**: `getCookieString()` method to IbkrClient for WebSocket auth
- **Added**: `resolveSymbolConid()` export for external conid lookups

### Files Modified
- `server/broker/ibkrWebSocket.ts` - NEW WebSocket streaming module
- `server/broker/ibkr.ts` - Added getCookieString(), made resolveConid public
- `server/routes.ts` - Added WebSocket streaming endpoints

---

### IBKR Option Chain Enhancement
- **Added**: VIX-based σ strike range filtering
  - Fetches real-time VIX from IBKR
  - Calculates expected move: `spot × (VIX/100) × √(days/252)`
  - Filters strikes to 2σ range around ATM (more relevant for 0DTE)
- **Added**: Real Greeks from IBKR (delta, gamma, theta, vega)
  - Fetches fields 7308/7309/7310/7633 from snapshot API
  - Falls back to moneyness-based estimates if unavailable
- **Added**: Real IV and Open Interest from IBKR
  - Fetches fields 7283 (IV) and 7311 (OI) from snapshot API
- **Added**: Debug endpoint `/api/broker/test-options/:symbol`
  - Returns full option chain with Greeks, OI, IV
  - Shows VIX, expected move, and strike range calculation

### Files Modified
- `server/broker/ibkr.ts` - Enhanced `getOptionChainWithStrikes()` with VIX, Greeks, OI, IV
- `server/routes.ts` - Added `/api/broker/test-options/:symbol` endpoint
- `server/engine/step3.ts` - Updated Strike interface and fetch logic for new fields

### Verification
- Test URL: `https://apeyolo.com/api/broker/test-options/SPY`
- Returns 0 data on weekends (expected - IBKR only returns data during market hours)

---

### IBKR Market Data Fix (Earlier)
- **Fixed**: `TypeError: broker.api.getMarketData is not a function`
  - Root cause: `createIbkrProvider()` was missing `getMarketData` in the returned object
  - Added `getMarketData: (symbol) => client.getMarketData(symbol)` to provider export
- **Fixed**: SPY resolving to wrong contract ID (ASX instead of US)
  - `resolveConid()` now prefers US exchanges (ARCA, NYSE, NASDAQ) over foreign (ASX, LSE)
  - SPY now resolves to conid `756733` (US) instead of `237937002` (ASX)
- **Added**: Debug endpoint `/api/broker/test-market/:symbol` for IBKR market data testing
- **Added**: Verbose logging for IBKR snapshot API responses

### Verification
- Test URL: `https://apeyolo.com/api/broker/test-market/SPY`
- Logs confirm: `Found US conid=756733 exchange=ARCA`
- Price shows 0 on weekends (expected - IBKR only returns real-time data during market hours)

---

## 2025-11-28

### Engine Page & Trading Window Overhaul
- **Removed**: `/api/engine/status` endpoint entirely - was causing 401 errors due to auth middleware
- **Moved**: Trading window calculation to client-side in `useEngine.ts`
  - Trading window: 11:00 AM - 1:00 PM ET, Mon-Fri
  - Uses `Intl.DateTimeFormat` for accurate NY timezone conversion
  - No longer depends on server endpoint
- **Added**: `SymbolChart` component for individual symbol price charts
- **Enhanced**: `StepCard` component with improved layout and data display
- **Added**: `server/engine/adapter.ts` - Engine analysis adapter for IBKR integration
- **Added**: `shared/types/engine.ts` - Type definitions for engine analysis flow
- **Updated**: Market data service with real VIX/SPY data integration
- **Improved**: Engine page layout and step visualization

### Docker & Deployment
- **Added**: `.dockerignore` file for optimized builds
- **Updated**: Dockerfile with improved caching and build steps

### Dev/Deploy Workflow Cleanup
- **Added**: `server/config.ts` - Centralized configuration layer
  - Environment-aware (development/staging/production)
  - Auto-detects Google OAuth redirect URIs per environment
  - Unified cookie and JWT settings
- **Added**: Concurrent dev scripts
  - `npm run dev` - Runs server and client in parallel
  - `npm run dev:server` - Server only with hot reload
  - `npm run dev:client` - Vite dev server with API proxy
- **Added**: Deploy scripts
  - `npm run deploy:staging` - Deploy to apeyolo-staging
  - `npm run deploy:prod` - Deploy to production apeyolo
  - `scripts/deploy.sh` - Unified deployment script
- **Added**: Environment example files
  - `.env.development.example`
  - `.env.staging.example`
  - `.env.production.example`
- **Updated**: `vite.config.ts` with API proxy for local dev
- **Updated**: `server/auth.ts` to use centralized config

### Infrastructure Notes
- Cloud Run service remains in `asia-east1`
- Artifact Registry in `us-central1` (storage location, not runtime)

## 2025-11-23

### Settings Page Improvements
- **Fixed**: `getSessionFromRequest` undefined error when clicking "Clear All Open Orders" button
- **Added**: JWT verification helper function in `routes.ts` to properly extract session from cookies
- **Implemented**: Auto-refresh for IBKR connection status using adaptive polling:
  - 3-second intervals when connecting
  - 30-second intervals when connection is stable
  - No manual page refresh required
- **UI**: Changed Clear Orders button styling from red (`btn-danger`) to black/white (`btn-secondary`) for consistency
- **Enhanced**: Added mutation callbacks for immediate status refresh after user actions

## 2025-11-22

Milestone: IBKR OAuth 2.0 end-to-end on Cloud Run (paper), orders submit successfully.

- Fixed egress IP for Cloud Run via Serverless VPC Access connector + Cloud NAT (Standard tier).
- Backend asserts `IBKR_ALLOWED_IP` in SSO JWT; matches Cloud NAT static IP.
- Hardened IBKR pipeline: OAuth → SSO → Validate → Init, with cookie persistence and just‑in‑time re‑init.
- Verified from production at https://apeyolo.com:
  - `/api/broker/warm` → all 200
  - `POST /api/ibkr/test` → success: true
  - `POST /api/broker/paper/order` → ok: true, orderId returned (SPY test order).
- Frontend flow: onboarding skipped; Google OAuth returns to `/agent`; Settings page “Test Connection” reflects pipeline.

Next:
- Keep session warm (Cloud Scheduler tickle every 2m) and set Cloud Run min instances = 1 for reliability.
- Optional: add post‑deploy smoke test in Cloud Build to assert `/api/ibkr/test` success.

### Patches (later on 2025-11-22)

- Fix: Detect open orders reliably and clear them
  - `server/broker/ibkr.ts#getOpenOrders` now ensures ready + account selection, queries both `/v1/api/iserver/account/orders` and `/v1/api/iserver/account/{acct}/orders`, normalizes shapes, and filters active statuses (Submitted, PreSubmitted, PendingSubmit, PendingCancel, Working).
  - `cancelOrder` uses account-qualified DELETE with proper URL encoding.
  - Logging shows normalized_count and first bytes of responses for diagnosis.
- UX: Hybrid auto‑reconnect in Settings
  - `client/src/pages/Settings.tsx` adds gentle auto warm/reconnect with exponential backoff while disconnected, keeping the manual button.
