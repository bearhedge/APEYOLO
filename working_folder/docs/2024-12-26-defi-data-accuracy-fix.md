# DeFi Trade Log Data Accuracy Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all data accuracy issues in the DeFi Trade Log where P&L doesn't match NAV delta and trades are stuck as "Open".

**Architecture:**
1. Fix trade monitor to properly close expired trades (Dec 23, 24 stuck as Open)
2. Recalculate P&L from NAV delta as the source of truth (NAV is from IBKR, P&L was calculated wrong)
3. Add validation to ensure P&L ≈ NAV delta going forward

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL, IBKR API

---

## Issues Identified

| Date | Issue | P&L Shown | NAV Delta | Status |
|------|-------|-----------|-----------|--------|
| Dec 24 | Trade stuck as Open, P&L missing | — | -$296 | 🔴 |
| Dec 23 | Trade stuck as Open, P&L missing | — | +$124 | 🔴 |
| Dec 22 | P&L ≠ NAV delta | +$374 | +$336 | 🟡 Off by $38 |
| Dec 19 | P&L ≠ NAV delta | +$608 | +$568 | 🟡 Off by $40 |
| Dec 18 | P&L shows GAIN, NAV shows LOSS | +$936 | -$857 | 🔴 WRONG SIGN |
| Dec 17 | P&L huge, NAV flat | +$1,693 | -$3 | 🔴 MASSIVE GAP |
| Dec 16 | P&L ≠ NAV delta | +$577 | +$352 | 🟡 Off by $225 |
| Dec 15 | Close match | +$616 | +$630 | ✅ Off by $14 |

---

## Task 1: Fix Trade Monitor - Close Expired Trades

**Files:**
- Modify: `/server/services/tradeMonitor.ts`
- Test: Manual - run monitor job

**Step 1: Read current trade monitor code**

```bash
cat server/services/tradeMonitor.ts | head -100
```

**Step 2: Identify why Dec 23/24 trades not closed**

The trade monitor checks if `now > expiration`. For 0DTE options, expiration is the same day at 4 PM ET. If the job didn't run, trades stay open.

**Step 3: Run trade monitor job manually**

```bash
curl -X POST https://apeyolo.com/api/jobs/trade-monitor
```

Expected: Dec 23, 24 trades should be marked as expired.

**Step 4: Verify trades are now expired**

Check the DeFi page - trades should show "Expired" status.

**Step 5: Commit if code changes needed**

```bash
git add server/services/tradeMonitor.ts
git commit -m "fix: Ensure trade monitor closes expired 0DTE trades"
```

---

## Task 2: Fix P&L Calculation - Use NAV Delta as Source of Truth

**Files:**
- Modify: `/server/defiRoutes.ts:207-235`

**Step 1: Read current P&L calculation**

Current code (line 208):
```typescript
const pnl = parseFloat(t.realizedPnl as any) || 0;
```

This uses stored `realizedPnl` which is WRONG for many trades.

**Step 2: Write the fix - calculate P&L from NAV delta**

Replace line 208 with:
```typescript
// For closed/expired trades, use NAV delta as source of truth
// NAV delta = Closing NAV - Opening NAV = actual account P&L for that day
const storedPnl = parseFloat(t.realizedPnl as any) || 0;
const navDelta = openingNav && closingNav ? closingNav - openingNav : null;

// Use NAV delta for closed/expired trades if available, otherwise use stored P&L
const pnl = (t.status === 'closed' || t.status === 'expired') && navDelta !== null
  ? navDelta
  : storedPnl;
```

**Step 3: Update the return object to show both values for debugging**

Add to return object:
```typescript
storedPnl: storedPnl * USD_TO_HKD,  // Original stored value
navDeltaPnl: navDelta,              // Calculated from NAV
pnlSource: navDelta !== null ? 'nav' : 'stored',
```

**Step 4: Deploy and verify**

```bash
npm run deploy:prod
```

**Step 5: Commit**

```bash
git add server/defiRoutes.ts
git commit -m "fix: Use NAV delta as P&L source of truth for closed trades"
```

---

## Task 3: Validate Fix with Playwright Screenshot

**Step 1: Navigate to DeFi page**

```typescript
await page.goto('https://apeyolo.com/defi');
```

**Step 2: Take screenshot of Trade Log**

```typescript
await page.screenshot({ path: 'defi-trade-log-fixed.png' });
```

**Step 3: Verify each row**

| Date | Expected P&L | Status |
|------|-------------|--------|
| Dec 24 | Should show NAV delta (-$296) or be Expired | ✅/🔴 |
| Dec 23 | Should show NAV delta (+$124) or be Expired | ✅/🔴 |
| Dec 22 | Should match NAV delta (+$336) | ✅/🔴 |
| Dec 19 | Should match NAV delta (+$568) | ✅/🔴 |
| Dec 18 | Should match NAV delta (-$857) | ✅/🔴 |
| Dec 17 | Should match NAV delta (-$3) | ✅/🔴 |
| Dec 16 | Should match NAV delta (+$352) | ✅/🔴 |
| Dec 15 | Should match NAV delta (+$630) | ✅/🔴 |

---

## Task 4: Fix Historical Data in Database (Optional)

**Files:**
- Modify: `/server/services/backfillTrades.ts`

**Step 1: Create function to recalculate P&L from NAV**

```typescript
export async function recalculatePnlFromNav(): Promise<BackfillResult> {
  // For each closed/expired trade:
  // 1. Look up NAV for that date
  // 2. Calculate navDelta = closingNav - openingNav
  // 3. Update realizedPnl = navDelta
}
```

**Step 2: Add endpoint to run recalculation**

```typescript
router.post('/recalculate-pnl', async (req, res) => {
  const result = await recalculatePnlFromNav();
  res.json({ success: true, data: result });
});
```

**Step 3: Run recalculation**

```bash
curl -X POST https://apeyolo.com/api/defi/recalculate-pnl
```

**Step 4: Commit**

```bash
git add server/services/backfillTrades.ts server/defiRoutes.ts
git commit -m "feat: Add P&L recalculation from NAV delta"
```

---

## Validation Checklist

After all tasks complete, verify:

- [ ] Dec 24 trade: Status = Expired, P&L matches NAV delta
- [ ] Dec 23 trade: Status = Expired, P&L matches NAV delta
- [ ] Dec 22 trade: P&L = NAV delta (+$336)
- [ ] Dec 19 trade: P&L = NAV delta (+$568)
- [ ] Dec 18 trade: P&L = NAV delta (-$857) - should show LOSS
- [ ] Dec 17 trade: P&L = NAV delta (-$3) - should be flat
- [ ] Dec 16 trade: P&L = NAV delta (+$352)
- [ ] Dec 15 trade: P&L = NAV delta (+$630)
- [ ] Period Summary totals are correct
- [ ] Take final screenshot as evidence

---

## Notes

**Root Cause:** The `realizedPnl` stored in `paper_trades` was calculated incorrectly:
- For expired trades: Set to `entryPremiumTotal` (assumed full premium kept)
- But this doesn't account for actual market movements affecting NAV

**Why NAV Delta is Correct:** NAV snapshots come directly from IBKR account value at market open/close. The delta represents the ACTUAL change in account value, which is the true P&L.

**Currency:** All values in HKD (as per "TRADE LOG (HKD)" header).
