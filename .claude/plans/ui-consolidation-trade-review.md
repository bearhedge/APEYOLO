# UI Consolidation Plan: 2-Page "Trade | Review" Structure

## Executive Summary

**Goal**: Consolidate APEYOLO from 6 primary pages to 2 pages without disrupting the Engine workflow (steps 1→5).

**Current Structure** (6 pages):
1. `/engine` - SPY options trading workflow (5 steps)
2. `/agent` - AI operator console
3. `/track-record` - Performance metrics & trade history
4. `/portfolio` - Positions & account stats
5. `/jobs` - Scheduled tasks & market events
6. `/settings` - Configuration

**Target Structure** (2 pages):
1. **Trade** (`/trade`) - Engine workflow + Agent sidebar + Position quick-view
2. **Review** (`/review`) - Tabbed interface: Track Record | Portfolio | Settings (with Jobs absorbed)

---

## Design Philosophy

### 1. Trade Page: "Task First, Operate Second"
- **Primary**: Engine workflow (5 steps) occupies center stage
- **Secondary**: Agent operator as collapsible right sidebar (300px collapsed, 400px expanded)
- **Tertiary**: Position quick-view strip at bottom (collapsible, shows P&L at a glance)

### 2. Review Page: "Full-Width Tabs for Analysis"
- **Track Record** tab: Performance metrics, NAV history, cashflows, trade history
- **Portfolio** tab: Open positions, Greeks, account stats
- **Settings** tab: Configuration + Jobs section (market events + scheduled tasks)

---

## Page 1: Trade (`/trade`)

### Layout Structure

```
┌────────────────────────────────────────────────────────────────────┐
│ Top Nav (IBKR status, NAV, Time, Wallet)                         │
├────┬────────────────────────────────────────────────┬─────────────┤
│    │                                                 │             │
│ L  │   ENGINE WIZARD (5 STEPS)                      │   AGENT     │
│ E  │   ┌─────────────────────────────────────────┐ │   SIDEBAR   │
│ F  │   │ Step 1: Market Context                   │ │             │
│ T  │   │ - SPY price, VIX, Day Range              │ │   Collapse  │
│    │   │ - Strategy selector (PUT/CALL/Strangle)  │ │   Button    │
│ N  │   │ - [Analyze] button                       │ │   ─────────  │
│ A  │   └─────────────────────────────────────────┘ │             │
│ V  │                                                 │  QuickActions│
│    │   ┌─────────────────────────────────────────┐ │  Bar         │
│    │   │ Step 2: Direction (skipped in v2)       │ │             │
│    │   └─────────────────────────────────────────┘ │  Activity    │
│    │                                                 │  Feed        │
│    │   ┌─────────────────────────────────────────┐ │             │
│    │   │ Step 3: Strike Selection                 │ │  Trade       │
│    │   │ - PUT candidates table                   │ │  Proposal    │
│    │   │ - CALL candidates table                  │ │  (when       │
│    │   │ - [Continue] button                      │ │  active)     │
│    │   └─────────────────────────────────────────┘ │             │
│    │                                                 │  Chat Input  │
│    │   ┌─────────────────────────────────────────┐ │             │
│    │   │ Step 4: Size (Risk Tier)                 │ │             │
│    │   │ - Conservative/Balanced/Aggressive       │ │             │
│    │   └─────────────────────────────────────────┘ │             │
│    │                                                 │             │
│    │   ┌─────────────────────────────────────────┐ │             │
│    │   │ Step 5: Exit (Trade Review)              │ │             │
│    │   │ - Proposal card with execute button      │ │             │
│    │   └─────────────────────────────────────────┘ │             │
├────┴────────────────────────────────────────────────┴─────────────┤
│ POSITION QUICK-VIEW (collapsible)                                 │
│ [▲ Hide] Net Delta: +12.5 | P&L: +$1,245 | 3 positions open      │
└────────────────────────────────────────────────────────────────────┘
```

### Component Breakdown

#### Engine Section (Center, Flex-1)
- **Current**: `Engine.tsx` - 567 lines
- **No changes needed to logic** - workflow stays identical
- **Layout adjustment**: Container width changes from `flex-1` to `flex-1 min-w-0` to accommodate right sidebar
- **Preservation requirement**: Steps 1→5 flow MUST work exactly as-is

#### Agent Sidebar (Right, Collapsible)
- **Current**: `Agent.tsx` - 320 lines
- **Width states**:
  - Collapsed: 60px (icon strip only)
  - Expanded: 400px (full operator console)
- **Components**:
  - QuickActionsBar (propose, manage, chat, agent-status buttons)
  - ActivityFeed (operator activities + V2 chat messages)
  - TradeProposalCard (when `activeProposal` exists)
  - AgentContextPanel (market reasoning)
  - ChatInput (conversational interface)
- **Collapse behavior**: Click icon to toggle, state persists in localStorage

#### Position Quick-View (Bottom, Collapsible)
- **New component**: 50-80 lines
- **Data source**: `/api/positions` (same as Portfolio page)
- **Display**:
  - Net Delta (sum of all position deltas)
  - Total P&L (realized + unrealized)
  - Position count
  - Click to expand → mini-table with 3 columns: Symbol, P&L, Delta
- **Collapse behavior**: [▲ Hide] / [▼ Show Positions] toggle

---

## Page 2: Review (`/review`)

### Layout Structure

```
┌────────────────────────────────────────────────────────────────────┐
│ Top Nav (IBKR status, NAV, Time, Wallet)                         │
├────┬────────────────────────────────────────────────────────────────┤
│    │                                                                 │
│ L  │   ┌───────────────────────────────────────────────────────┐  │
│ E  │   │ [Track Record] [Portfolio] [Settings]                 │  │
│ F  │   └───────────────────────────────────────────────────────┘  │
│ T  │                                                                 │
│    │   TAB CONTENT (full-width, scrollable)                         │
│ N  │   ───────────────────────────────────────────────────────────  │
│ A  │                                                                 │
│ V  │   (Track Record Tab)                                            │
│    │   - Time period filter (1M/3M/6M/YTD/All)                      │
│    │   - KPI cards (Win Rate, Profit Factor, Sharpe, etc.)          │
│    │   - Fund metrics (TVPI, RVPI, DPI)                             │
│    │   - Nested tabs: KPIs | NAV | Cashflows | Trades               │
│    │                                                                 │
│    │   (Portfolio Tab)                                               │
│    │   - Account summary cards (2 rows, 5 cols each)                │
│    │   - Position risk metrics (Max Loss, Net Delta, etc.)          │
│    │   - Open positions table with Greeks                            │
│    │                                                                 │
│    │   (Settings Tab)                                                │
│    │   - Configuration sections (IBKR, Agents, etc.)                │
│    │   - Jobs section: Market Events + Scheduled Jobs + History     │
│    │                                                                 │
└────┴────────────────────────────────────────────────────────────────┘
```

### Tab 1: Track Record
- **Current**: `TrackRecord.tsx` - 932 lines
- **Minimal changes**: Remove LeftNav, add tab container wrapper
- **Features preserved**:
  - Time period filter (1M/3M/6M/YTD/All)
  - KPI cards (Cumulative P&L, Win Rate, Profit Factor, Total Trades, Sharpe, Time-Weighted Return)
  - Fund metrics (TVPI, RVPI, DPI)
  - Nested tabs: KPIs | NAV | Cashflows | Trades

### Tab 2: Portfolio
- **Current**: `Portfolio.tsx` - 942 lines
- **Minimal changes**: Remove LeftNav, add tab container wrapper
- **Features preserved**:
  - Account summary (10 cards: Portfolio Value, Buying Power, Cash, Margin, Day P&L, etc.)
  - Position risk metrics (Max Loss, Implied Notional, DTE, Net Delta)
  - Open positions table (Type, Symbol, Side, Qty, Entry, Mark, P&L, DTE, Greeks)
  - Footer row with totals

### Tab 3: Settings (with Jobs absorbed)
- **Current**: `Settings.tsx` - ? lines
- **Current**: `Jobs.tsx` - 503 lines
- **Merge approach**:
  1. Settings content stays at top (IBKR config, agent models, API keys, etc.)
  2. Jobs section appears as collapsible accordion below settings
  3. Jobs section contains:
     - Market Events card (high-impact event alerts)
     - Scheduled Jobs table (enable/disable toggles, Run Now buttons)
     - Run History table (execution log)

---

## Routing Changes

### Current Routes (`App.tsx`)
```tsx
<Route path="/engine" component={Engine} />
<Route path="/agent" component={Agent} />
<Route path="/track-record" component={TrackRecord} />
<Route path="/portfolio" component={Portfolio} />
<Route path="/jobs" component={Jobs} />
<Route path="/settings" component={Settings} />
```

### New Routes
```tsx
<Route path="/trade" component={Trade} />
<Route path="/review" component={Review} />

{/* Redirects for old routes */}
<Route path="/engine">
  <Redirect to="/trade" />
</Route>
<Route path="/agent">
  <Redirect to="/trade" />
</Route>
<Route path="/track-record">
  <Redirect to="/review?tab=track-record" />
</Route>
<Route path="/portfolio">
  <Redirect to="/review?tab=portfolio" />
</Route>
<Route path="/jobs">
  <Redirect to="/review?tab=settings" />
</Route>
<Route path="/settings">
  <Redirect to="/review?tab=settings" />
</Route>
```

### LeftNav Updates
**Current**:
```tsx
{ name: 'Home', path: '/', icon: Home }
{ name: 'Engine', path: '/engine', icon: Gauge }
{ name: 'Agent', path: '/agent', icon: Bot }
{ name: 'Track Record', path: '/track-record', icon: LineChart }
{ name: 'Portfolio', path: '/portfolio', icon: Briefcase }
{ name: 'DeFi', path: '/defi', icon: Coins }
{ name: 'DD', path: '/dd', icon: FileText }
{ name: 'Jobs', path: '/jobs', icon: Clock }
{ name: 'Settings', path: '/settings', icon: Settings }
```

**New** (2 main items):
```tsx
{ name: 'Home', path: '/', icon: Home }
{ name: 'Trade', path: '/trade', icon: Gauge }         // Engine + Agent
{ name: 'Review', path: '/review', icon: LineChart }   // Track + Portfolio + Settings
{ name: 'DeFi', path: '/defi', icon: Coins }
{ name: 'DD', path: '/dd', icon: FileText }
```

---

## Implementation Steps

### Phase 1: Create New Components (No Breaking Changes)
1. **Create `Trade.tsx`** (new page)
   - Import `Engine.tsx` logic (no modifications to Engine internals)
   - Create `AgentSidebar.tsx` component (extract from `Agent.tsx`)
   - Create `PositionQuickView.tsx` component (new)
   - Layout: `<LeftNav /> <Engine /> <AgentSidebar /> <PositionQuickView />`

2. **Create `Review.tsx`** (new page)
   - Import `TrackRecord.tsx`, `Portfolio.tsx`, `Settings.tsx` as tab content
   - Create tab switcher with query param support (`?tab=track-record`)
   - No changes to underlying tab components yet

3. **Verify**: Both new pages work alongside old pages (routes coexist)

### Phase 2: Refactor Agent Sidebar
1. **Extract `AgentSidebar.tsx`** from `Agent.tsx`:
   - Props: `{ isCollapsed, onToggle, ...agentOperatorState }`
   - Components: QuickActionsBar, ActivityFeed, TradeProposalCard, AgentContextPanel, ChatInput
   - Width states: 60px collapsed, 400px expanded
   - Collapse icon: `<ChevronsLeft />` / `<ChevronsRight />`

2. **Create `useAgentSidebar.ts`** hook:
   - Manages collapsed state (persisted to localStorage)
   - Wraps `useAgentOperator` and `useAgentV2` hooks
   - Returns unified state for sidebar

### Phase 3: Create Position Quick-View
1. **Create `PositionQuickView.tsx`** component:
   - Fetches `/api/positions` (same as Portfolio)
   - Collapsed state: Single line with Net Delta, P&L, Position count
   - Expanded state: Mini-table (Symbol, P&L, Delta)
   - Toggle button: `[▲ Hide]` / `[▼ Show Positions]`
   - Persists state to localStorage

### Phase 4: Merge Jobs into Settings
1. **Update `Settings.tsx`**:
   - Add "Jobs & Automation" accordion section at bottom
   - Import `MarketEventsCard`, `JobsTable`, `RunHistoryTable` from `Jobs.tsx`
   - Use `useJobs` hook to fetch data
   - Maintains all Jobs functionality (enable/disable, Run Now, high-impact alerts)

### Phase 5: Update Routing & Navigation
1. **Update `App.tsx`**:
   - Add routes for `/trade` and `/review`
   - Add redirects from old routes to new routes
   - Keep old routes active during transition (optional)

2. **Update `LeftNav.tsx`**:
   - Replace 6 navigation items with 2 main items (Trade, Review)
   - Update active state detection
   - Update icons

### Phase 6: Testing & Validation
1. **Engine workflow verification**:
   - Test all 5 steps (Market → Direction → Strikes → Size → Exit)
   - Verify SSE streaming works (step 1 analysis)
   - Verify option chain streaming works (step 3)
   - Verify paper trade execution works (step 5)
   - Confirm no regressions in proposal negotiation

2. **Agent sidebar verification**:
   - Test all QuickActions (propose, manage, chat, agent-status)
   - Verify ActivityFeed shows operator activities + V2 messages
   - Test TradeProposalCard (execute, reject, strike negotiation)
   - Test collapse/expand behavior
   - Verify localStorage persistence

3. **Review tabs verification**:
   - Track Record: Test time filters, KPIs, NAV history, cashflows, trades
   - Portfolio: Test account stats, positions table, Greeks calculation
   - Settings: Test configuration sections + Jobs section

4. **Position Quick-View verification**:
   - Test Net Delta calculation
   - Test P&L aggregation
   - Test expand/collapse behavior

### Phase 7: Cleanup (Optional)
1. Remove old page files (`Engine.tsx`, `Agent.tsx`, etc.)
2. Remove old routes from `App.tsx`
3. Remove redirects (if desired)

---

## Component Files (New & Modified)

### New Files
```
client/src/pages/Trade.tsx                 (400-500 lines)
client/src/pages/Review.tsx                (200-250 lines)
client/src/components/agent/AgentSidebar.tsx (250-300 lines)
client/src/components/PositionQuickView.tsx  (100-120 lines)
client/src/hooks/useAgentSidebar.ts          (50-80 lines)
```

### Modified Files
```
client/src/App.tsx                          (add routes + redirects)
client/src/components/LeftNav.tsx           (update nav items)
client/src/pages/Settings.tsx               (absorb Jobs section)
```

### Files to Keep (No Changes)
```
client/src/pages/Engine.tsx                 (engine logic stays identical)
client/src/pages/TrackRecord.tsx            (used as tab content)
client/src/pages/Portfolio.tsx              (used as tab content)
client/src/components/engine/*.tsx          (all step components)
client/src/hooks/useEngine.ts               (no changes)
client/src/hooks/useEngineStream.ts         (no changes)
```

---

## Critical Requirements

### 1. Engine Workflow Preservation
- **Steps 1→5 MUST work exactly as-is**
- No changes to step logic, SSE streaming, or execution flow
- Only layout container changes (flex-1 → flex-1 min-w-0)
- Verify with end-to-end test: Market analysis → Strike selection → Execute trade

### 2. Agent Sidebar Independence
- Must work in collapsed state (60px icon strip)
- Must expand to full functionality (400px)
- Must not interfere with Engine workflow (separate React tree)
- Collapse state persists across page reloads (localStorage)

### 3. Responsive Behavior
- On screens < 1280px: Agent sidebar auto-collapses to 60px
- On screens < 1024px: Position Quick-View auto-hides
- Engine workflow always takes priority (never hidden)

### 4. Data Consistency
- Position Quick-View uses same `/api/positions` endpoint as Portfolio
- Net Delta calculation matches Portfolio page logic
- P&L aggregation matches Track Record calculations

---

## Migration Strategy

### Option A: Big Bang (Recommended for small team)
1. Implement all phases in a feature branch
2. Test thoroughly
3. Merge to main, deploy
4. Redirect old routes immediately

### Option B: Gradual Rollout
1. Phase 1-3: New pages coexist with old pages
2. Users can access both `/trade` and `/engine`
3. Redirect old routes after 1 week of testing
4. Remove old files after 2 weeks

---

## Risk Mitigation

### High-Risk Areas
1. **Engine workflow disruption**: Mitigate by keeping Engine.tsx unchanged, only wrapping in new container
2. **Agent sidebar state conflicts**: Mitigate by extracting to separate component with isolated state
3. **Responsive breakpoints**: Mitigate by testing on multiple screen sizes

### Rollback Plan
- Keep old routes active for 1 week
- If critical bugs found, temporarily disable redirects
- Revert to old pages via route toggle (no code removal needed)

---

## Success Metrics

1. **Engine workflow success rate**: 100% (no regressions)
2. **Page load time**: < 2s for Trade page, < 1.5s for Review page
3. **Mobile responsiveness**: All features accessible on 1024px+ screens
4. **User feedback**: Positive sentiment on navigation simplification

---

## Timeline Estimate

- **Phase 1-2**: 2-3 hours (create new pages, extract Agent sidebar)
- **Phase 3-4**: 1-2 hours (Position Quick-View, merge Jobs)
- **Phase 5**: 30 minutes (routing & navigation updates)
- **Phase 6**: 1-2 hours (testing & validation)
- **Phase 7**: 30 minutes (cleanup)

**Total**: 5-8 hours for complete implementation + testing
