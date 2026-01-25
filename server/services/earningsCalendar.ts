/**
 * Earnings Calendar Service
 *
 * Fetches earnings announcement dates from the Alpha Vantage API.
 * Used to populate the calendar with upcoming earnings for tracked symbols.
 *
 * API Documentation: https://www.alphavantage.co/documentation/#earnings-calendar
 *
 * Required environment variable: ALPHA_VANTAGE_API_KEY
 * Get a free key at: https://www.alphavantage.co/support/#api-key
 */

import { db } from '../db';
import { earningsCalendar, type InsertEarningsCalendarEvent } from '../../shared/schema';
import { TRACKED_EARNINGS_SYMBOLS, COMPANY_NAMES } from '../config/earningsConfig';
import { and, gte, lte, eq } from 'drizzle-orm';

// Alpha Vantage API configuration
const ALPHA_VANTAGE_BASE_URL = 'https://www.alphavantage.co/query';

/**
 * Get Alpha Vantage API key from environment
 */
export function getAlphaVantageApiKey(): string | undefined {
  return process.env.ALPHA_VANTAGE_API_KEY;
}

/**
 * Check if Alpha Vantage API is configured
 */
export function isAlphaVantageConfigured(): boolean {
  return !!process.env.ALPHA_VANTAGE_API_KEY;
}

/**
 * Parse a single CSV line handling quoted fields
 */
export function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  // Push the last field
  result.push(current.trim());

  return result;
}

/**
 * Parse Alpha Vantage CSV response into earnings events
 */
export function parseEarningsCSV(csv: string): InsertEarningsCalendarEvent[] {
  const lines = csv.trim().split('\n');

  if (lines.length < 2) {
    console.log('[Earnings] No data in CSV response');
    return [];
  }

  // Parse header
  const headers = parseCSVLine(lines[0]);
  console.log('[Earnings] CSV headers:', headers);

  // Expected headers: symbol,name,reportDate,fiscalDateEnding,estimate,currency
  const symbolIdx = headers.indexOf('symbol');
  const nameIdx = headers.indexOf('name');
  const reportDateIdx = headers.indexOf('reportDate');
  const fiscalDateEndingIdx = headers.indexOf('fiscalDateEnding');
  const estimateIdx = headers.indexOf('estimate');
  const currencyIdx = headers.indexOf('currency');

  if (symbolIdx === -1 || reportDateIdx === -1) {
    console.error('[Earnings] Missing required columns in CSV');
    return [];
  }

  const events: InsertEarningsCalendarEvent[] = [];
  const trackedSymbolsSet = new Set(TRACKED_EARNINGS_SYMBOLS as readonly string[]);

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const fields = parseCSVLine(line);
    const symbol = fields[symbolIdx];

    // Only include tracked symbols
    if (!trackedSymbolsSet.has(symbol)) {
      continue;
    }

    const reportDate = fields[reportDateIdx];
    const fiscalDateEnding = fiscalDateEndingIdx !== -1 ? fields[fiscalDateEndingIdx] : undefined;
    const estimate = estimateIdx !== -1 ? fields[estimateIdx] : undefined;
    const currency = currencyIdx !== -1 ? fields[currencyIdx] : 'USD';
    const name = nameIdx !== -1 ? fields[nameIdx] : COMPANY_NAMES[symbol] || symbol;

    // Derive fiscal quarter from fiscalDateEnding
    const fiscalQuarter = fiscalDateEnding ? getFiscalQuarter(fiscalDateEnding) : undefined;

    events.push({
      symbol,
      companyName: name || COMPANY_NAMES[symbol] || symbol,
      reportDate,
      fiscalQuarter,
      estimate: estimate && estimate !== '' ? estimate : undefined,
      currency: currency || 'USD',
      source: 'alpha_vantage',
    });
  }

  console.log(`[Earnings] Parsed ${events.length} tracked earnings events`);
  return events;
}

/**
 * Derive fiscal quarter (Q1/Q2/Q3/Q4) from fiscal date ending
 * Fiscal date ending format: YYYY-MM-DD
 */
export function getFiscalQuarter(fiscalDateEnding: string): string {
  const parts = fiscalDateEnding.split('-');
  if (parts.length < 2) return '';

  const year = parts[0];
  const month = parseInt(parts[1], 10);

  let quarter: string;
  if (month >= 1 && month <= 3) {
    quarter = 'Q1';
  } else if (month >= 4 && month <= 6) {
    quarter = 'Q2';
  } else if (month >= 7 && month <= 9) {
    quarter = 'Q3';
  } else {
    quarter = 'Q4';
  }

  return `${quarter} ${year}`;
}

/**
 * Fetch earnings calendar from Alpha Vantage API
 */
export async function fetchEarningsCalendar(): Promise<InsertEarningsCalendarEvent[]> {
  const apiKey = getAlphaVantageApiKey();

  if (!apiKey) {
    throw new Error('ALPHA_VANTAGE_API_KEY environment variable not set');
  }

  const url = `${ALPHA_VANTAGE_BASE_URL}?function=EARNINGS_CALENDAR&horizon=3month&apikey=${apiKey}`;

  console.log('[Earnings] Fetching earnings calendar from Alpha Vantage...');

  const response = await fetch(url);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Alpha Vantage API error ${response.status}: ${errorText}`);
  }

  const csv = await response.text();

  // Check for API error messages in the response
  if (csv.includes('Error Message') || csv.includes('Note:')) {
    console.error('[Earnings] Alpha Vantage API error:', csv);
    throw new Error(`Alpha Vantage API error: ${csv}`);
  }

  return parseEarningsCSV(csv);
}

/**
 * Clear future earnings from database (preserves historical data)
 */
export async function clearFutureEarnings(): Promise<number> {
  if (!db) {
    console.warn('[Earnings] Database not configured');
    return 0;
  }

  const today = new Date().toISOString().split('T')[0];

  const result = await db
    .delete(earningsCalendar)
    .where(gte(earningsCalendar.reportDate, today))
    .returning({ id: earningsCalendar.id });

  console.log(`[Earnings] Cleared ${result.length} future earnings events`);
  return result.length;
}

/**
 * Insert earnings events into database, handling duplicates
 */
export async function insertEarnings(
  earnings: InsertEarningsCalendarEvent[]
): Promise<number> {
  if (!db) {
    console.warn('[Earnings] Database not configured');
    return 0;
  }

  if (earnings.length === 0) return 0;

  let insertedCount = 0;

  for (const earning of earnings) {
    try {
      await db
        .insert(earningsCalendar)
        .values({
          ...earning,
          fetchedAt: new Date(),
        })
        .onConflictDoNothing();
      insertedCount++;
    } catch (error) {
      // Log but continue with other inserts
      console.error(`[Earnings] Error inserting ${earning.symbol}:`, error);
    }
  }

  console.log(`[Earnings] Inserted ${insertedCount} earnings events`);
  return insertedCount;
}

/**
 * Full refresh of earnings calendar from Alpha Vantage API
 */
export async function refreshEarningsCalendar(): Promise<{
  cleared: number;
  inserted: number;
  total: number;
  symbols: string[];
}> {
  console.log('[Earnings] Starting earnings calendar refresh...');

  // Step 1: Fetch all earnings from Alpha Vantage
  const earnings = await fetchEarningsCalendar();

  // Step 2: Clear future earnings
  const cleared = await clearFutureEarnings();

  // Step 3: Insert new earnings
  const inserted = await insertEarnings(earnings);

  // Extract unique symbols that were processed
  const symbols = [...new Set(earnings.map(e => e.symbol))];

  console.log(`[Earnings] Refresh complete: cleared=${cleared}, inserted=${inserted}, symbols=${symbols.length}`);

  return {
    cleared,
    inserted,
    total: earnings.length,
    symbols,
  };
}

/**
 * Get upcoming earnings from database
 */
export async function getUpcomingEarnings(
  days: number = 60
): Promise<typeof earningsCalendar.$inferSelect[]> {
  if (!db) {
    console.warn('[Earnings] Database not configured');
    return [];
  }

  const today = new Date().toISOString().split('T')[0];
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + days);
  const endDateStr = endDate.toISOString().split('T')[0];

  const events = await db.query.earningsCalendar.findMany({
    where: and(
      gte(earningsCalendar.reportDate, today),
      lte(earningsCalendar.reportDate, endDateStr)
    ),
    orderBy: (events, { asc }) => [asc(events.reportDate), asc(events.symbol)],
  });

  return events;
}

/**
 * Get earnings for a specific symbol
 */
export async function getEarningsForSymbol(
  symbol: string,
  days: number = 90
): Promise<typeof earningsCalendar.$inferSelect[]> {
  if (!db) {
    console.warn('[Earnings] Database not configured');
    return [];
  }

  const today = new Date().toISOString().split('T')[0];
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + days);
  const endDateStr = endDate.toISOString().split('T')[0];

  const events = await db.query.earningsCalendar.findMany({
    where: and(
      eq(earningsCalendar.symbol, symbol.toUpperCase()),
      gte(earningsCalendar.reportDate, today),
      lte(earningsCalendar.reportDate, endDateStr)
    ),
    orderBy: (events, { asc }) => [asc(events.reportDate)],
  });

  return events;
}
