Legacy (archived) code for prior deterministic UI and workflows

This folder contains components, pages, and notes from the initial OrcaOptions
implementation that are not part of the next iteration (SDK-driven agentic
trading system). Nothing has been deleted — only relocated for clarity.

Archived items moved here:

- client pages
  - legacy/client/src/pages/trade.tsx
  - legacy/client/src/pages/portfolio.tsx
  - legacy/client/src/pages/rules.tsx
  - legacy/client/src/pages/logs.tsx

- client trade components
  - legacy/client/src/components/trade/option-chain.tsx
  - legacy/client/src/components/trade/spread-builder.tsx
  - legacy/client/src/components/trade/trade-validation-modal.tsx

Server changes:
- The following deterministic endpoints were commented out (preserved in code):
  - POST /api/trades/validate
  - GET/POST /api/rules

What remains active:
- Core backend routing and broker switch (mock|ibkr)
- Account/positions/option-chain/trades endpoints
- Broker status + diagnostics
- Client shell (Dashboard, layout, UI library) for future agent UI

