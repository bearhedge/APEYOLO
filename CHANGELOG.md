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
