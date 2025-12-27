/**
 * Macro Data Service
 *
 * Fetches macroeconomic data (DXY, 10Y yield) from Yahoo Finance
 * for use in the research context assembly.
 */

import yahooFinance from 'yahoo-finance2';

// ============================================
// Types
// ============================================

export interface MacroData {
  dxy: { price: number; change: number; changePct: number } | null;
  tenYear: { yield: number; change: number } | null;
  fetchedAt: string;
}

// ============================================
// Fetcher
// ============================================

/**
 * Fetch macro data from Yahoo Finance
 * DXY (US Dollar Index) and 10Y Treasury Yield
 */
export async function fetchMacroData(): Promise<MacroData> {
  const result: MacroData = {
    dxy: null,
    tenYear: null,
    fetchedAt: new Date().toISOString(),
  };

  // Fetch DXY (US Dollar Index)
  try {
    const dxyQuote = await yahooFinance.quote('DX-Y.NYB');
    if (dxyQuote) {
      result.dxy = {
        price: dxyQuote.regularMarketPrice || 0,
        change: dxyQuote.regularMarketChange || 0,
        changePct: dxyQuote.regularMarketChangePercent || 0,
      };
    }
  } catch (error: any) {
    console.error('[MacroData] DXY fetch failed:', error.message);
  }

  // Fetch 10-Year Treasury Yield (^TNX)
  try {
    const tnxQuote = await yahooFinance.quote('^TNX');
    if (tnxQuote) {
      result.tenYear = {
        yield: tnxQuote.regularMarketPrice || 0,
        change: tnxQuote.regularMarketChange || 0,
      };
    }
  } catch (error: any) {
    console.error('[MacroData] TNX fetch failed:', error.message);
  }

  return result;
}
