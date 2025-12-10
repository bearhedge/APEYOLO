/**
 * Test IBKR Trades API
 * Run: npx tsx scripts/test-ibkr-trades.ts
 */

import "dotenv/config";
import { createIbkrProvider } from "../server/broker/ibkr";

async function testTrades() {
  console.log("=== Testing IBKR Trades Endpoint ===\n");

  // Create IBKR provider
  console.log("1. Creating IBKR provider...");
  const provider = createIbkrProvider({ env: "paper" });

  // Check if getTrades exists
  console.log("2. Checking getTrades exists:", typeof provider.getTrades === "function" ? "✅ YES" : "❌ NO");

  if (typeof provider.getTrades !== "function") {
    console.error("\n❌ FAILED: getTrades is not exported from provider!");
    process.exit(1);
  }

  // Call getTrades
  console.log("3. Calling getTrades()...\n");

  try {
    const trades = await provider.getTrades();
    console.log(`✅ SUCCESS! Got ${trades.length} trades from IBKR:\n`);

    if (trades.length === 0) {
      console.log("   No trades in the past 7 days");
    } else {
      trades.slice(0, 10).forEach((trade, i) => {
        console.log(`   [${i + 1}] ${trade.symbol}`);
        console.log(`       Strategy: ${trade.strategy}`);
        console.log(`       Qty: ${trade.quantity}`);
        console.log(`       Status: ${trade.status}`);
        console.log(`       Submitted: ${trade.submittedAt}`);
        console.log(`       Fill Price: ${trade.entryFillPrice}`);
        console.log(`       Commission: ${trade.entryCommission}`);
        console.log(`       Net P&L: ${trade.netPnl}`);
        console.log("");
      });

      if (trades.length > 10) {
        console.log(`   ... and ${trades.length - 10} more trades`);
      }
    }
  } catch (err: any) {
    console.error("❌ ERROR calling getTrades:", err.message);
    console.error("\nFull error:", err);
    process.exit(1);
  }
}

testTrades();
