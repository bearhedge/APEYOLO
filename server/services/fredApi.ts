// @ts-nocheck
// TODO: Add proper null checks for db
/**
 * FRED API Service
 *
 * Fetches economic event dates from the Federal Reserve Economic Data (FRED) API.
 * Used to populate the economic calendar with important macro events.
 *
 * API Documentation: https://fred.stlouisfed.org/docs/api/fred/
 *
 * Required environment variable: FRED_API_KEY
 * Get a free key at: https://fred.stlouisfed.org/docs/api/api_key.html
 */

import { db } from '../db';
import { economicEvents, type InsertEconomicEvent } from '@shared/schema';
import { gte, and, sql } from 'drizzle-orm';

// FRED API configuration
const FRED_BASE_URL = 'https://api.stlouisfed.org/fred';

// Release IDs for major economic indicators
// Full list: https://fred.stlouisfed.org/releases
export const FRED_RELEASES = {
  // ============================================
  // CRITICAL IMPACT - Market-moving events
  // ============================================
  FOMC: {
    id: 101,
    name: 'FOMC Rate Decision',
    eventType: 'fomc',
    impactLevel: 'critical' as const,
    description: 'Federal Open Market Committee monetary policy decisions',
    defaultTime: '14:00', // 2 PM ET
  },

  // ============================================
  // HIGH IMPACT - Major economic indicators
  // ============================================
  CPI: {
    id: 10,
    name: 'Consumer Price Index (CPI)',
    eventType: 'cpi',
    impactLevel: 'high' as const,
    description: 'Monthly inflation data measuring consumer prices',
    defaultTime: '08:30', // 8:30 AM ET
  },
  EMPLOYMENT: {
    id: 50,
    name: 'Nonfarm Payrolls (NFP)',
    eventType: 'employment',
    impactLevel: 'high' as const,
    description: 'Monthly employment situation - jobs added and unemployment rate',
    defaultTime: '08:30',
  },
  GDP: {
    id: 53,
    name: 'GDP Growth Rate',
    eventType: 'gdp',
    impactLevel: 'high' as const,
    description: 'Quarterly gross domestic product - economic output measurement',
    defaultTime: '08:30',
  },
  RETAIL_SALES: {
    id: 63,
    name: 'Retail Sales',
    eventType: 'retail_sales',
    impactLevel: 'high' as const,
    description: 'Monthly consumer spending at retail stores',
    defaultTime: '08:30',
  },
  DURABLE_GOODS: {
    id: 86,
    name: 'Durable Goods Orders',
    eventType: 'durable_goods',
    impactLevel: 'high' as const,
    description: 'New orders for manufactured durable goods',
    defaultTime: '08:30',
  },

  // ============================================
  // MEDIUM IMPACT - Important indicators
  // ============================================
  PCE: {
    id: 46,
    name: 'Core PCE Price Index',
    eventType: 'pce',
    impactLevel: 'medium' as const,
    description: "Fed's preferred inflation measure - Personal Consumption Expenditures",
    defaultTime: '08:30',
  },
  PPI: {
    id: 47,
    name: 'Producer Price Index (PPI)',
    eventType: 'ppi',
    impactLevel: 'medium' as const,
    description: 'Wholesale inflation data - prices received by producers',
    defaultTime: '08:30',
  },
  JOBLESS_CLAIMS: {
    id: 11,
    name: 'Initial Jobless Claims',
    eventType: 'jobless_claims',
    impactLevel: 'medium' as const,
    description: 'Weekly new unemployment insurance claims filed',
    defaultTime: '08:30',
  },
  ISM_MANUFACTURING: {
    id: 42,
    name: 'ISM Manufacturing PMI',
    eventType: 'ism_manufacturing',
    impactLevel: 'medium' as const,
    description: 'Manufacturing sector purchasing managers index - above 50 = expansion',
    defaultTime: '10:00',
  },
  ISM_SERVICES: {
    id: 43,
    name: 'ISM Services PMI',
    eventType: 'ism_services',
    impactLevel: 'medium' as const,
    description: 'Services sector purchasing managers index - above 50 = expansion',
    defaultTime: '10:00',
  },
  INDUSTRIAL_PRODUCTION: {
    id: 13,
    name: 'Industrial Production',
    eventType: 'industrial_production',
    impactLevel: 'medium' as const,
    description: 'Output of factories, mines, and utilities',
    defaultTime: '09:15',
  },
  CONSUMER_CONFIDENCE: {
    id: 20,
    name: 'Consumer Confidence Index',
    eventType: 'consumer_confidence',
    impactLevel: 'medium' as const,
    description: 'Conference Board measure of consumer optimism',
    defaultTime: '10:00',
  },
  MICHIGAN_SENTIMENT: {
    id: 481,
    name: 'Michigan Consumer Sentiment',
    eventType: 'michigan_sentiment',
    impactLevel: 'medium' as const,
    description: 'University of Michigan consumer sentiment survey',
    defaultTime: '10:00',
  },
  JOLTS: {
    id: 192,
    name: 'JOLTS Job Openings',
    eventType: 'jolts',
    impactLevel: 'medium' as const,
    description: 'Job Openings and Labor Turnover Survey - labor market demand',
    defaultTime: '10:00',
  },
  TRADE_BALANCE: {
    id: 61,
    name: 'Trade Balance',
    eventType: 'trade_balance',
    impactLevel: 'medium' as const,
    description: 'Difference between exports and imports of goods and services',
    defaultTime: '08:30',
  },
  BEIGE_BOOK: {
    id: 23,
    name: 'Fed Beige Book',
    eventType: 'beige_book',
    impactLevel: 'medium' as const,
    description: 'Federal Reserve summary of economic conditions by district',
    defaultTime: '14:00',
  },

  // ============================================
  // LOW IMPACT - Housing & other indicators
  // ============================================
  HOUSING_STARTS: {
    id: 79,
    name: 'Housing Starts',
    eventType: 'housing_starts',
    impactLevel: 'low' as const,
    description: 'New residential construction started',
    defaultTime: '08:30',
  },
  NEW_HOME_SALES: {
    id: 51,
    name: 'New Home Sales',
    eventType: 'new_home_sales',
    impactLevel: 'low' as const,
    description: 'Sales of newly constructed homes',
    defaultTime: '10:00',
  },
  EXISTING_HOME_SALES: {
    id: 49,
    name: 'Existing Home Sales',
    eventType: 'existing_home_sales',
    impactLevel: 'low' as const,
    description: 'Sales of previously owned homes',
    defaultTime: '10:00',
  },
  BUILDING_PERMITS: {
    id: 79,
    name: 'Building Permits',
    eventType: 'building_permits',
    impactLevel: 'low' as const,
    description: 'Permits issued for new residential construction',
    defaultTime: '08:30',
  },
  BUSINESS_INVENTORIES: {
    id: 69,
    name: 'Business Inventories',
    eventType: 'business_inventories',
    impactLevel: 'low' as const,
    description: 'Total value of goods held by manufacturers, wholesalers, and retailers',
    defaultTime: '10:00',
  },
  IMPORT_EXPORT_PRICES: {
    id: 55,
    name: 'Import/Export Prices',
    eventType: 'import_export_prices',
    impactLevel: 'low' as const,
    description: 'Price changes for imported and exported goods',
    defaultTime: '08:30',
  },
} as const;

export type ReleaseType = keyof typeof FRED_RELEASES;

interface FREDReleaseDatesResponse {
  release_dates: Array<{
    release_id: number;
    date: string; // YYYY-MM-DD
  }>;
}

/**
 * Get FRED API key from environment
 */
function getApiKey(): string {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    throw new Error('FRED_API_KEY environment variable not set');
  }
  return apiKey;
}

/**
 * Fetch release dates from FRED API for a specific release
 */
export async function fetchReleaseDates(
  releaseId: number,
  daysAhead: number = 90
): Promise<string[]> {
  const apiKey = getApiKey();

  // Calculate date range
  const now = new Date();
  const endDate = new Date(now);
  endDate.setDate(endDate.getDate() + daysAhead);

  // Format dates as YYYY-MM-DD
  const startDateStr = now.toISOString().split('T')[0];
  const endDateStr = endDate.toISOString().split('T')[0];

  const url = new URL(`${FRED_BASE_URL}/release/dates`);
  url.searchParams.set('release_id', releaseId.toString());
  url.searchParams.set('realtime_start', startDateStr);
  url.searchParams.set('realtime_end', endDateStr);
  url.searchParams.set('include_release_dates_with_no_data', 'true');
  url.searchParams.set('sort_order', 'asc');
  url.searchParams.set('file_type', 'json');
  url.searchParams.set('api_key', apiKey);

  console.log(`[FRED] Fetching release dates for ID ${releaseId}...`);

  const response = await fetch(url.toString());

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`FRED API error ${response.status}: ${errorText}`);
  }

  const data: FREDReleaseDatesResponse = await response.json();

  const dates = data.release_dates?.map((rd) => rd.date) || [];
  console.log(`[FRED] Found ${dates.length} dates for release ${releaseId}`);

  return dates;
}

/**
 * Fetch all economic events from FRED API
 */
export async function fetchAllEconomicEvents(
  daysAhead: number = 90
): Promise<InsertEconomicEvent[]> {
  const events: InsertEconomicEvent[] = [];

  for (const [key, release] of Object.entries(FRED_RELEASES)) {
    try {
      const dates = await fetchReleaseDates(release.id, daysAhead);

      for (const date of dates) {
        events.push({
          eventType: release.eventType,
          eventName: release.name,
          eventDate: date,
          eventTime: release.defaultTime,
          releaseId: release.id,
          impactLevel: release.impactLevel,
          description: release.description,
          source: 'fred',
        });
      }

      // Rate limiting - FRED allows 120 requests per minute
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`[FRED] Error fetching ${key}:`, error);
      // Continue with other releases even if one fails
    }
  }

  console.log(`[FRED] Total events fetched: ${events.length}`);
  return events;
}

/**
 * Clear future economic events from database (preserves historical data)
 */
export async function clearFutureEvents(): Promise<number> {
  const today = new Date().toISOString().split('T')[0];

  const result = await db
    .delete(economicEvents)
    .where(
      and(
        gte(economicEvents.eventDate, today),
        sql`${economicEvents.source} = 'fred'`
      )
    )
    .returning({ id: economicEvents.id });

  console.log(`[FRED] Cleared ${result.length} future events`);
  return result.length;
}

/**
 * Upsert economic events into database
 */
export async function upsertEconomicEvents(
  events: InsertEconomicEvent[]
): Promise<number> {
  if (events.length === 0) return 0;

  // Insert events with conflict handling
  // Using ON CONFLICT based on event_type + event_date
  let insertedCount = 0;

  for (const event of events) {
    try {
      // Check if event already exists
      const existing = await db.query.economicEvents.findFirst({
        where: and(
          sql`${economicEvents.eventType} = ${event.eventType}`,
          sql`${economicEvents.eventDate} = ${event.eventDate}`
        ),
      });

      if (!existing) {
        await db.insert(economicEvents).values({
          ...event,
          fetchedAt: new Date(),
        });
        insertedCount++;
      }
    } catch (error) {
      console.error(`[FRED] Error inserting event:`, error);
    }
  }

  console.log(`[FRED] Inserted ${insertedCount} new events`);
  return insertedCount;
}

/**
 * Full refresh of economic calendar from FRED API
 */
export async function refreshEconomicCalendar(
  daysAhead: number = 90
): Promise<{ cleared: number; inserted: number; total: number }> {
  console.log('[FRED] Starting economic calendar refresh...');

  // Step 1: Fetch all events from FRED
  const events = await fetchAllEconomicEvents(daysAhead);

  // Step 2: Clear future events
  const cleared = await clearFutureEvents();

  // Step 3: Insert new events
  const inserted = await upsertEconomicEvents(events);

  console.log(`[FRED] Refresh complete: cleared=${cleared}, inserted=${inserted}`);

  return {
    cleared,
    inserted,
    total: events.length,
  };
}

/**
 * Get upcoming economic events from database
 */
export async function getUpcomingEconomicEvents(
  days: number = 60
): Promise<typeof economicEvents.$inferSelect[]> {
  const today = new Date().toISOString().split('T')[0];
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + days);
  const endDateStr = endDate.toISOString().split('T')[0];

  const events = await db.query.economicEvents.findMany({
    where: and(
      gte(economicEvents.eventDate, today),
      sql`${economicEvents.eventDate} <= ${endDateStr}`
    ),
    orderBy: (events, { asc }) => [asc(events.eventDate), asc(events.eventTime)],
  });

  return events;
}

/**
 * Check if FRED API is configured
 */
export function isFREDConfigured(): boolean {
  return !!process.env.FRED_API_KEY;
}
