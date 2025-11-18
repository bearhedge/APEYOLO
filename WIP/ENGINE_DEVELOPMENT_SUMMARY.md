# ENGINE DEVELOPMENT SUMMARY
*Created: 2025-11-17*
*Status: Paused for IBKR Infrastructure Work*

## Overview
Built a 5-step trading decision engine for automated options trading. The engine is deployed and visible on apeyolo.com but currently runs on mock data. Core logic is complete, but needs IBKR plumbing to function with real trading.

## What Was Built

### 1. Five-Step Trading Engine (`/server/engine/`)
Complete decision-making pipeline implemented in TypeScript:

#### Step 1: Market Regime Check (`step1.ts`)
- Trading window: 12:00 PM - 2:00 PM EST
- VIX thresholds: 10-35 acceptable range
- Returns: `shouldTrade` boolean with reasoning

#### Step 2: Direction Selection (`step2.ts`)
- Options: PUT, CALL, or STRANGLE
- Default: STRANGLE for diversification
- Placeholder for trend/momentum analysis

#### Step 3: Strike Selection (`step3.ts`)
- Delta targeting: 0.15-0.20 range (ideal 0.18)
- **MOCK DATA**: Currently generates fake option chains
- **NEEDS**: Real IBKR option chain retrieval
- Expected premium calculation included

#### Step 4: Position Sizing (`step4.ts`)
- Risk profiles: CONSERVATIVE (2 contracts, 50% BP), BALANCED (3 contracts, 70% BP), AGGRESSIVE (5 contracts, 100% BP)
- Portfolio margin calculations: 12% for strangles, 18% for naked
- **MOCK DATA**: Uses fake account with $100K cash, $666K buying power
- **NEEDS**: Real IBKR account data

#### Step 5: Exit Rules (`step5.ts`)
- Stop loss: 200% of premium received
- No take profit (let expire worthless)
- Time-based exits for near-expiration ITM options
- Position monitoring with P&L tracking

#### Orchestrator (`index.ts`)
- `TradingEngine` class coordinates all 5 steps
- `executeTradingDecision()` runs full pipeline
- Returns complete trading decision with all parameters

### 2. Frontend Engine Dashboard (`/client/src/pages/Engine.tsx`)
- Clean dark theme UI matching existing design
- Displays 5-step decision process with StatCards
- Navigation integrated (between Agent and Portfolio)
- **LIMITATION**: Just displays data, no interactivity yet
- **NEEDS**: Configuration inputs, execute button functionality

### 3. API Endpoints (`/server/routes.ts`)
```typescript
GET /api/engine/status    // Returns current engine decision (working)
POST /api/engine/execute  // Placeholder for real execution (NOT IMPLEMENTED)
```

### 4. Deployment Infrastructure
- Successfully deployed to GCP Cloud Run
- Project ID: `fabled-cocoa-443004-n3`
- Manual deployment command documented:
  ```bash
  gcloud builds submit --config cloudbuild.yaml --project fabled-cocoa-443004-n3 --substitutions=COMMIT_SHA=latest .
  ```

## What's NOT Working (Needs IBKR Plumbing)

### Critical Gaps
1. **Option Chain Data**: `getOptionChain()` in `/server/broker/ibkr.ts` returns empty array
2. **Real Prices**: SPY price hardcoded to 450, needs market data
3. **Order Execution**: `/api/engine/execute` not wired to `placeOrder()`
4. **Multi-leg Orders**: Current `placeOrder()` only handles single options
5. **Account Data**: Using mock $100K/$666K instead of real account
6. **Position Monitoring**: No real-time P&L or exit execution

### IBKR Integration Status
- ✅ OAuth 2.0 authentication working
- ✅ Basic account/positions retrieval working
- ❌ Option chains not implemented
- ❌ Market data snapshots not implemented
- ❌ Multi-leg order placement not working
- ❌ Real-time position monitoring missing

## Design Decisions Made

### Core Principles
- **No emojis** in production UI (user requirement)
- **Minimal design** - clean, dark, professional
- **Baby steps** - incremental changes with approval
- **Top-down approach** - smart contracts first, then plumbing

### Trading Rules (Hardcoded)
- Naked options only (no spreads initially)
- 0.15-0.20 delta targeting
- 200% stop loss, no take profit
- No overnight positions
- 12-2PM EST trading window

### Risk Management
- Portfolio margin calculations implemented
- Position sizing based on risk profiles
- Maximum contracts limited by profile
- Buying power utilization limits

## Files Created/Modified

### New Files
```
/server/engine/
├── step1.ts    (139 lines) - Market regime check
├── step2.ts    (158 lines) - Direction selection
├── step3.ts    (252 lines) - Strike selection
├── step4.ts    (256 lines) - Position sizing
├── step5.ts    (253 lines) - Exit rules
└── index.ts    (195 lines) - Main orchestrator

/client/src/pages/
└── Engine.tsx  (146 lines) - Dashboard UI

/SESSION_CONTEXT.md         - Deployment reference
/DEPLOY_TRIGGER.md         - GCP trigger file
```

### Modified Files
- `/client/src/components/LeftNav.tsx` - Added Engine navigation
- `/client/src/App.tsx` - Added Engine route
- `/server/routes.ts` - Added engine endpoints
- `/server/index.ts` - Imported engine routes

## Next Phase: IBKR Plumbing Priority

### Why Pausing Engine Work
- Engine logic is complete but can't function without real data
- IBKR infrastructure is prerequisite for any trading
- Need to validate strategies with real market data
- Original developers didn't complete IBKR integration

### IBKR Plumbing Focus Areas
1. **Authentication Flow**: Ensure OAuth persists properly
2. **Market Data**: Real-time prices, option chains, Greeks
3. **Order Management**: Multi-leg options, order tracking
4. **Account Integration**: Real buying power, positions, P&L
5. **WebSocket Streaming**: Live updates for positions

### After IBKR Plumbing Complete
1. Refactor root directory to streamline work
2. Connect Engine to real IBKR data
3. Make Engine page interactive (not just display)
4. Focus heavily on model construction
5. Run 5-day validation testing

## Testing Requirements
- 5 consecutive days of successful execution
- No errors per model's predefined standards
- Paper trading first, then live with small positions

## Known Issues
- ES module compatibility issues (fixed by removing require.main checks)
- GCP deployment needs manual trigger (auto-trigger not configured)
- Port conflicts when multiple dev servers running

## Commands Reference
```bash
# Local development
npm run dev

# Manual GCP deployment
cd ~/Projects/APEYOLO
gcloud builds submit --config cloudbuild.yaml --project fabled-cocoa-443004-n3 --substitutions=COMMIT_SHA=latest .

# Git workflow
git add .
git commit -m "message"
git push origin main
```

---

*This document captures all Engine development work as of 2025-11-17. Work is paused to focus on IBKR infrastructure plumbing. Once IBKR integration is complete, return to this document to continue Engine development with real data.*