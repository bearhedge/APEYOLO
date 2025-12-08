/**
 * Test IBKR Market Data for SPY
 * Run: npx tsx working_folder/test-ibkr-spy.ts
 */

import "dotenv/config";
import { createIbkrProvider } from "../server/broker/ibkr";

async function testSPYPrice() {
  console.log("=== Testing IBKR SPY Market Data ===\n");

  // Create IBKR provider
  console.log("1. Creating IBKR provider...");
  const provider = createIbkrProvider({ env: "paper" });

  // Check if getMarketData exists
  console.log("2. Checking getMarketData exists:", typeof provider.getMarketData === "function" ? "✅ YES" : "❌ NO");

  if (typeof provider.getMarketData !== "function") {
    console.error("\n❌ FAILED: getMarketData is not exported from provider!");
    process.exit(1);
  }

  // Call getMarketData
  console.log("3. Calling getMarketData('SPY')...\n");

  try {
    const data = await provider.getMarketData("SPY");
    console.log("✅ SUCCESS! SPY Market Data from IBKR:\n");
    console.log("   Symbol:   ", data.symbol);
    console.log("   Price:    $" + data.price.toFixed(2));
    console.log("   Bid:      $" + data.bid.toFixed(2));
    console.log("   Ask:      $" + data.ask.toFixed(2));
    console.log("   Volume:   ", data.volume);
    console.log("   Change:   ", (data.change >= 0 ? "+" : "") + data.change.toFixed(2));
    console.log("   Change %: ", (data.changePercent >= 0 ? "+" : "") + data.changePercent.toFixed(2) + "%");
    console.log("   Timestamp:", data.timestamp);

    if (data.price > 0) {
      console.log("\n🎉 IBKR market data is working!");
    } else {
      console.log("\n⚠️  Price is 0 - market may be closed or data unavailable");
    }
  } catch (err: any) {
    console.error("❌ ERROR calling getMarketData:", err.message);
    console.error("\nFull error:", err);
    process.exit(1);
  }
}

testSPYPrice();
