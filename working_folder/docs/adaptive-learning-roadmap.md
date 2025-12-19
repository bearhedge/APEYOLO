# APEYOLO: Discipline System & Adaptive Learning Roadmap

**Created:** 2024-12-20
**Status:** Phase 1 In Progress

## The Problem

Trading losses come from **lack of discipline**, not lack of knowledge. The system needs to:
1. Materialize strategy as code (not vibes)
2. Narrate every decision in real-time
3. Log everything for post-mortem clarity
4. Learn from outcomes over time

---

## The Roadmap: 5 Levels of Intelligence

### Level 1: Structured Capture (Foundation)
- Auto-log market context at every trade (SPY, VIX, time, indicators)
- System captures context automatically, minimal friction
- Everything in queryable database, not just notes
- *No AI learning, just comprehensive recording*

### Level 2: Pattern Surfacing (Insights)
- Query history: "Show me all winning trades when VIX > 18"
- Agent finds correlations: "Morning entries outperform afternoon by 23%"
- Visualizations, statistics, data-driven observations
- *AI summarizes, human spots patterns*

### Level 3: Hypothesis Testing (Scientific Method)
- Define rules as testable hypotheses
- System tracks each rule's performance separately
- After N trades: "Rule X has 68% win rate, Rule Y has 42%"
- *Systematic A/B testing of intuitions*

### Level 4: Recommendation Engine (Assistive AI)
- Agent: "This looks like your Nov 12 winner - similar VIX, time, trend"
- Suggests based on YOUR history, not generic advice
- Human decides, agent provides personalized context
- *AI learns your style, reflects it back*

### Level 5: Adaptive Learning (RLHF-adjacent)
- System learns from feedback loop
- Approved trade + win = reinforce factors
- Override + loss = flag pattern
- Model evolves with trading
- *Requires 200+ labeled decisions*

---

## Current Implementation: Phase 1

### Track A: Agent (Presentation Layer)

The Agent translates and presents the Engine's output.

**Target Output:**
```
-> Fetching SPY 0DTE option chain...
   45 strikes loaded (650-695)

-> Filtering by delta (0.08-0.15)...
   PUT candidates: $675 (d-0.12), $674 (d-0.14)
   CALL candidates: $686 (d0.11), $687 (d0.13)

-> Checking liquidity (bid/ask)...
   $675P: $0.62/$0.68 (good)
   $686C: $0.55/$0.61 (good)

-> Selected STRANGLE:
   SELL $675P @ $0.62 (d-0.12)
   SELL $686C @ $0.55 (d0.11)
   Premium: $1.17
```

**Files:**
- `server/agentRoutes.ts` - Agent API, propose operation
- `client/src/pages/Agent.tsx` - Agent UI
- `client/src/components/agent/ActivityFeed.tsx` - Activity display

### Track B: Engine (Logic Layer)

The Engine is the brain - directional analysis, strike selection, risk management.

**5-Step Flow:**
1. **Step 1: Market Regime** - VIX check, market hours, risk tier
2. **Step 2: Direction** - Trend analysis via 50MA on 5-min bars
3. **Step 3: Strikes** - Delta targeting, liquidity filtering, strike selection
4. **Step 4: Size** - 2% rule position sizing, margin calculation
5. **Step 5: Exit** - Stop loss (2-4x premium), time stop, take profit

**Files:**
- `server/engine/step1.ts` - Market regime analysis
- `server/engine/step2.ts` - Directional trend analysis
- `server/engine/step3.ts` - Strike selection logic
- `server/engine/step4.ts` - Position sizing
- `server/engine/step5.ts` - Exit rule calculation
- `server/engine/adapter.ts` - Orchestrates all steps

---

## Existing Infrastructure

Already built (don't rebuild):
- `trades` table with `agentReasoning`, `criticApproval` fields
- `agentTicks` table logging every agent decision
- `fills` with Greeks at execution time
- `greeksSnapshots` for position evolution
- Full track record page with KPIs
- Guard rails and mandate system

---

## Design Principles

- **Discipline over intelligence** - System enforces process, not predictions
- **Capture everything** - Data is the foundation for all future levels
- **Transparent audit trail** - Every decision reconstructable
- **Agent is the mouth, Engine is the brain** - Separate concerns
