// server/lib/agent/data-fetcher.ts
// Step 2 of 3-step agent: Fetch all required data in parallel

import { IntentNeeds } from './intent-extractor';
import { toolRegistry } from '../agent-tools';
import { webBrowse } from './tools/web-browse';

export interface FetchedData {
  current_time?: { hkt: string; nyt: string; utc: string };
  market_status?: { isOpen: boolean; status: string; nextChange: string; reason?: string };
  spy_price?: { price: number; change: number; changePercent: number };
  vix?: { value: number; regime?: string };
  positions?: {
    summary: { totalPositions: number; optionCount: number; stockCount: number; totalUnrealizedPnL: number };
    positions: any[];
  };
  web_content?: { content: string; url: string; screenshot?: string };
  errors: string[];
}

const TIMEOUT_MS = 15000; // 15 seconds per source (web can be slow)

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  name: string
): Promise<T | null> {
  try {
    const result = await Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`${name} timed out after ${ms}ms`)), ms)
      ),
    ]);
    return result;
  } catch (e: any) {
    console.error(`[DataFetcher] ${name} failed:`, e.message);
    return null;
  }
}

export async function fetchData(needs: IntentNeeds): Promise<FetchedData> {
  const errors: string[] = [];
  const result: FetchedData = { errors };

  console.log(`[DataFetcher] Fetching data for needs:`, needs);

  // Build array of promises for parallel execution
  const tasks: Promise<void>[] = [];

  // Current time - always succeeds (local computation)
  if (needs.current_time) {
    tasks.push((async () => {
      const now = new Date();
      result.current_time = {
        utc: now.toISOString(),
        hkt: now.toLocaleString('en-US', { timeZone: 'Asia/Hong_Kong', hour12: true }),
        nyt: now.toLocaleString('en-US', { timeZone: 'America/New_York', hour12: true }),
      };
      console.log(`[DataFetcher] Time fetched`);
    })());
  }

  // Market status and SPY/VIX - use getMarketData tool
  if (needs.market_status || needs.spy_price || needs.vix) {
    tasks.push((async () => {
      const data = await withTimeout(
        toolRegistry.getMarketData.execute({}),
        TIMEOUT_MS,
        'market_data'
      );

      if (data?.success && data.data) {
        const d = data.data;

        if (needs.market_status && d.market) {
          result.market_status = {
            isOpen: d.market.isOpen,
            status: d.market.isOpen ? 'open' : 'closed',
            nextChange: d.market.currentTime || 'unknown',
            reason: d.market.reason,
          };
        }

        if (needs.spy_price && d.spy) {
          result.spy_price = {
            price: d.spy.price,
            change: d.spy.change || 0,
            changePercent: d.spy.changePercent || 0,
          };
        }

        if (needs.vix && d.vix) {
          result.vix = {
            value: d.vix.level,
            regime: d.vix.regime,
          };
        }

        console.log(`[DataFetcher] Market data fetched`);
      } else {
        if (needs.market_status) errors.push('Could not fetch market status');
        if (needs.spy_price) errors.push('Could not fetch SPY price');
        if (needs.vix) errors.push('Could not fetch VIX');
      }
    })());
  }

  // Positions - use getPositions tool
  if (needs.positions) {
    tasks.push((async () => {
      const data = await withTimeout(
        toolRegistry.getPositions.execute({}),
        TIMEOUT_MS,
        'positions'
      );

      if (data?.success && data.data) {
        result.positions = {
          summary: data.data.summary || {
            totalPositions: 0,
            optionCount: 0,
            stockCount: 0,
            totalUnrealizedPnL: 0,
          },
          positions: data.data.positions || [],
        };
        console.log(`[DataFetcher] Positions fetched: ${result.positions.summary.totalPositions} positions`);
      } else {
        errors.push('Could not fetch positions - broker may be disconnected');
      }
    })());
  }

  // Web search - use webBrowse tool
  if (needs.web_search) {
    tasks.push((async () => {
      console.log(`[DataFetcher] Starting web search: "${needs.web_search}"`);
      const data = await withTimeout(
        webBrowse({ query: needs.web_search! }),
        TIMEOUT_MS,
        'web_search'
      );

      if (data?.content) {
        result.web_content = {
          content: data.content.slice(0, 5000), // Limit content size
          url: data.url,
          screenshot: data.screenshot,
        };
        console.log(`[DataFetcher] Web search complete: ${result.web_content.url}`);
      } else {
        errors.push('Web search failed or returned no content');
      }
    })());
  }

  // Execute all tasks in parallel
  await Promise.all(tasks);

  console.log(`[DataFetcher] Complete. Errors: ${errors.length > 0 ? errors.join(', ') : 'none'}`);

  return result;
}
