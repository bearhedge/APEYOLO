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

