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

