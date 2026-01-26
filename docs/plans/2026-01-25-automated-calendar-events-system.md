# Automated Calendar Events System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Connect CalendarWindow to the existing API and add earnings calendar data from Alpha Vantage.

**Architecture:** The backend already has FRED API integration storing economic events in the database. We'll add a parallel earnings calendar service using Alpha Vantage's `EARNINGS_CALENDAR` endpoint, then update CalendarWindow to fetch from the API instead of using hardcoded data.

**Tech Stack:** TypeScript, Drizzle ORM, React Query, Alpha Vantage API, PostgreSQL

---

## Task 1: Add `earnings_calendar` Database Schema

**Files:**
- Modify: `shared/schema.ts:597` (after `economicEvents` section)

**Step 1: Write the schema addition**

Add after line 597 (after `// ==================== END ECONOMIC EVENTS ====================`):

```typescript
// ==================== EARNINGS CALENDAR ====================
// Earnings calendar from Alpha Vantage API

export const earningsCalendar = pgTable("earnings_calendar", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: text("symbol").notNull(), // AAPL, NVDA, etc.
  companyName: text("company_name").notNull(), // Apple Inc.
  reportDate: text("report_date").notNull(), // YYYY-MM-DD
  fiscalQuarter: text("fiscal_quarter"), // Q1, Q2, Q3, Q4
  estimate: decimal("estimate", { precision: 10, scale: 4 }), // EPS estimate
  actual: decimal("actual", { precision: 10, scale: 4 }), // EPS actual (filled after report)
  currency: text("currency").default("USD"),
  source: text("source").notNull().default("alpha_vantage"), // 'alpha_vantage' | 'manual'
  fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("earnings_calendar_date_idx").on(table.reportDate),
  index("earnings_calendar_symbol_idx").on(table.symbol),
  index("earnings_calendar_symbol_date_idx").on(table.symbol, table.reportDate),
]);

export const insertEarningsCalendarSchema = createInsertSchema(earningsCalendar).omit({
  id: true,
  createdAt: true,
  fetchedAt: true,
});

export type EarningsCalendarEvent = typeof earningsCalendar.$inferSelect;
export type InsertEarningsCalendarEvent = z.infer<typeof insertEarningsCalendarSchema>;

// ==================== END EARNINGS CALENDAR ====================
```

**Step 2: Run test to verify schema compiles**

Run: `cd /Users/home/APE-YOLO && npx tsc --noEmit shared/schema.ts`
Expected: No errors

**Step 3: Generate database migration**

Run: `cd /Users/home/APE-YOLO && npm run db:generate`
Expected: New migration file created in `drizzle/` directory

**Step 4: Apply migration**

Run: `cd /Users/home/APE-YOLO && npm run db:migrate`
Expected: Migration applied successfully

**Step 5: Commit**

```bash
git add shared/schema.ts drizzle/
git commit -m "feat: add earnings_calendar table schema

Adds database table for storing earnings calendar data from Alpha Vantage.
Includes indexes for efficient date and symbol lookups."
```

---

## Task 2: Create Earnings Configuration

**Files:**
- Create: `server/config/earningsConfig.ts`

**Step 1: Create the config file**

```typescript
/**
 * Earnings Calendar Configuration
 *
 * Defines which symbols to track for earnings calendar.
 * These are fetched from Alpha Vantage and displayed in CalendarWindow.
 */

// Mag7 - Always track these
export const MAG7_SYMBOLS = [
  'AAPL',  // Apple
  'MSFT',  // Microsoft
  'GOOGL', // Alphabet
  'AMZN',  // Amazon
  'META',  // Meta
  'NVDA',  // Nvidia
  'TSLA',  // Tesla
] as const;

// Top SPY holdings (non-Mag7)
export const TOP_SPY_SYMBOLS = [
  'BRK.B', // Berkshire Hathaway
  'JPM',   // JP Morgan
  'V',     // Visa
  'UNH',   // UnitedHealth
  'XOM',   // Exxon Mobil
  'MA',    // Mastercard
  'JNJ',   // Johnson & Johnson
  'HD',    // Home Depot
  'PG',    // Procter & Gamble
  'COST',  // Costco
  'ABBV',  // AbbVie
  'CVX',   // Chevron
  'MRK',   // Merck
  'LLY',   // Eli Lilly
  'BAC',   // Bank of America
  'KO',    // Coca-Cola
  'PEP',   // PepsiCo
  'AVGO',  // Broadcom
  'WMT',   // Walmart
  'AMD',   // AMD
  'ORCL',  // Oracle
  'CRM',   // Salesforce
  'MCD',   // McDonald's
  'CSCO',  // Cisco
  'NFLX',  // Netflix
  'ADBE',  // Adobe
  'TMO',   // Thermo Fisher
  'ACN',   // Accenture
  'INTC',  // Intel
  'DIS',   // Disney
] as const;

// All tracked symbols
export const TRACKED_EARNINGS_SYMBOLS = [...MAG7_SYMBOLS, ...TOP_SPY_SYMBOLS];

// Company name mappings (Alpha Vantage provides these, but good to have fallback)
export const COMPANY_NAMES: Record<string, string> = {
  AAPL: 'Apple Inc.',
  MSFT: 'Microsoft Corporation',
  GOOGL: 'Alphabet Inc.',
  AMZN: 'Amazon.com Inc.',
  META: 'Meta Platforms Inc.',
  NVDA: 'NVIDIA Corporation',
  TSLA: 'Tesla Inc.',
  'BRK.B': 'Berkshire Hathaway Inc.',
  JPM: 'JPMorgan Chase & Co.',
  V: 'Visa Inc.',
  UNH: 'UnitedHealth Group Inc.',
  XOM: 'Exxon Mobil Corporation',
  MA: 'Mastercard Inc.',
  JNJ: 'Johnson & Johnson',
  HD: 'The Home Depot Inc.',
  PG: 'Procter & Gamble Co.',
  COST: 'Costco Wholesale Corporation',
  ABBV: 'AbbVie Inc.',
  CVX: 'Chevron Corporation',
  MRK: 'Merck & Co. Inc.',
  LLY: 'Eli Lilly and Company',
  BAC: 'Bank of America Corporation',
  KO: 'The Coca-Cola Company',
  PEP: 'PepsiCo Inc.',
  AVGO: 'Broadcom Inc.',
  WMT: 'Walmart Inc.',
  AMD: 'Advanced Micro Devices Inc.',
  ORCL: 'Oracle Corporation',
  CRM: 'Salesforce Inc.',
  MCD: "McDonald's Corporation",
  CSCO: 'Cisco Systems Inc.',
  NFLX: 'Netflix Inc.',
  ADBE: 'Adobe Inc.',
  TMO: 'Thermo Fisher Scientific Inc.',
  ACN: 'Accenture plc',
  INTC: 'Intel Corporation',
  DIS: 'The Walt Disney Company',
};
```

**Step 2: Verify file compiles**

Run: `cd /Users/home/APE-YOLO && npx tsc --noEmit server/config/earningsConfig.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add server/config/earningsConfig.ts
git commit -m "feat: add earnings calendar configuration

Defines Mag7 and top SPY symbols to track for earnings.
Includes company name mappings for display."
```

---

## Task 3: Create Earnings Calendar Service

**Files:**
- Create: `server/services/earningsCalendar.ts`

**Step 1: Create the service file**

```typescript
/**
 * Earnings Calendar Service
 *
 * Fetches earnings calendar data from Alpha Vantage API.
 * Filters to tracked symbols (Mag7 + top SPY holdings).
 *
 * Alpha Vantage Endpoint: EARNINGS_CALENDAR
 * - Returns CSV with: symbol, name, reportDate, fiscalDateEnding, estimate, currency
 * - Free tier: 25 requests/day (sufficient for weekly refresh)
 */

import { db } from '../db';
import { earningsCalendar } from '../../shared/schema';
import { TRACKED_EARNINGS_SYMBOLS, COMPANY_NAMES } from '../config/earningsConfig';
import { and, gte, lte, sql, eq } from 'drizzle-orm';

// ============================================
// Configuration
// ============================================

const BASE_URL = 'https://www.alphavantage.co/query';

// Get API key from environment
function getAlphaVantageApiKey(): string | undefined {
  return process.env.ALPHA_VANTAGE_API_KEY;
}

/**
 * Check if Alpha Vantage API is configured
 */
export function isAlphaVantageConfigured(): boolean {
  return !!getAlphaVantageApiKey();
}

// ============================================
// Types
// ============================================

interface AlphaVantageEarning {
  symbol: string;
  name: string;
  reportDate: string; // YYYY-MM-DD
  fiscalDateEnding: string;
  estimate: string | null;
  currency: string;
}

interface EarningsRefreshResult {
  cleared: number;
  inserted: number;
  total: number;
  symbols: string[];
}

// ============================================
// CSV Parsing
// ============================================

/**
 * Parse Alpha Vantage CSV response
 * Format: symbol,name,reportDate,fiscalDateEnding,estimate,currency
 */
function parseEarningsCSV(csv: string): AlphaVantageEarning[] {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];

  // Skip header row
  const results: AlphaVantageEarning[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Handle CSV with potential commas in company names (quoted)
    const parts = parseCSVLine(line);
    if (parts.length < 6) continue;

    results.push({
      symbol: parts[0],
      name: parts[1],
      reportDate: parts[2],
      fiscalDateEnding: parts[3],
      estimate: parts[4] || null,
      currency: parts[5] || 'USD',
    });
  }

  return results;
}

/**
 * Parse a single CSV line, handling quoted fields
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());

  return result;
}

// ============================================
// API Functions
// ============================================

/**
 * Fetch earnings calendar from Alpha Vantage
 * Returns 3 months of upcoming earnings
 */
export async function fetchEarningsCalendar(): Promise<AlphaVantageEarning[]> {
  const apiKey = getAlphaVantageApiKey();
  if (!apiKey) {
    throw new Error('ALPHA_VANTAGE_API_KEY environment variable not set');
  }

  const url = `${BASE_URL}?function=EARNINGS_CALENDAR&horizon=3month&apikey=${apiKey}`;

  console.log('[EarningsCalendar] Fetching from Alpha Vantage...');

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Alpha Vantage API error: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type');

  // Check for JSON error response
  if (contentType?.includes('application/json')) {
    const json = await response.json();
    if (json['Error Message']) {
      throw new Error(`Alpha Vantage error: ${json['Error Message']}`);
    }
    if (json['Note']) {
      throw new Error(`Alpha Vantage rate limit: ${json['Note']}`);
    }
    throw new Error('Unexpected JSON response from Alpha Vantage');
  }

  // Parse CSV response
  const csv = await response.text();
  const allEarnings = parseEarningsCSV(csv);

  console.log(`[EarningsCalendar] Fetched ${allEarnings.length} total earnings`);

  // Filter to tracked symbols only
  const trackedSet = new Set(TRACKED_EARNINGS_SYMBOLS);
  const filtered = allEarnings.filter(e => trackedSet.has(e.symbol));

  console.log(`[EarningsCalendar] Filtered to ${filtered.length} tracked symbols`);

  return filtered;
}

// ============================================
// Database Functions
// ============================================

/**
 * Clear future earnings from database
 */
async function clearFutureEarnings(): Promise<number> {
  const today = new Date().toISOString().split('T')[0];

  const result = await db.delete(earningsCalendar)
    .where(gte(earningsCalendar.reportDate, today));

  // Drizzle doesn't return count directly, estimate from result
  console.log('[EarningsCalendar] Cleared future earnings');
  return 0; // Placeholder - actual count not easily available
}

/**
 * Insert earnings into database
 */
async function insertEarnings(earnings: AlphaVantageEarning[]): Promise<number> {
  if (earnings.length === 0) return 0;

  const values = earnings.map(e => ({
    symbol: e.symbol,
    companyName: e.name || COMPANY_NAMES[e.symbol] || e.symbol,
    reportDate: e.reportDate,
    fiscalQuarter: getFiscalQuarter(e.fiscalDateEnding),
    estimate: e.estimate ? e.estimate : null,
    currency: e.currency || 'USD',
    source: 'alpha_vantage' as const,
  }));

  // Use ON CONFLICT to handle duplicates
  for (const value of values) {
    await db.insert(earningsCalendar)
      .values(value)
      .onConflictDoNothing();
  }

  console.log(`[EarningsCalendar] Inserted ${values.length} earnings`);
  return values.length;
}

/**
 * Derive fiscal quarter from fiscal date ending
 */
function getFiscalQuarter(fiscalDateEnding: string): string | null {
  if (!fiscalDateEnding) return null;

  try {
    const date = new Date(fiscalDateEnding);
    const month = date.getMonth() + 1; // 1-12

    if (month <= 3) return 'Q1';
    if (month <= 6) return 'Q2';
    if (month <= 9) return 'Q3';
    return 'Q4';
  } catch {
    return null;
  }
}

// ============================================
// Refresh Function
// ============================================

/**
 * Full refresh of earnings calendar
 */
export async function refreshEarningsCalendar(): Promise<EarningsRefreshResult> {
  console.log('[EarningsCalendar] Starting refresh...');

  // Step 1: Fetch from Alpha Vantage
  const earnings = await fetchEarningsCalendar();

  // Step 2: Clear future earnings
  const cleared = await clearFutureEarnings();

  // Step 3: Insert new earnings
  const inserted = await insertEarnings(earnings);

  const symbols = [...new Set(earnings.map(e => e.symbol))];

  console.log(`[EarningsCalendar] Refresh complete: inserted=${inserted}, symbols=${symbols.length}`);

  return {
    cleared,
    inserted,
    total: earnings.length,
    symbols,
  };
}

// ============================================
// Query Functions
// ============================================

/**
 * Get upcoming earnings from database
 */
export async function getUpcomingEarnings(
  days: number = 60
): Promise<typeof earningsCalendar.$inferSelect[]> {
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
  days: number = 365
): Promise<typeof earningsCalendar.$inferSelect[]> {
  const today = new Date().toISOString().split('T')[0];
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + days);
  const endDateStr = endDate.toISOString().split('T')[0];

  const events = await db.query.earningsCalendar.findMany({
    where: and(
      eq(earningsCalendar.symbol, symbol),
      gte(earningsCalendar.reportDate, today),
      lte(earningsCalendar.reportDate, endDateStr)
    ),
    orderBy: (events, { asc }) => [asc(events.reportDate)],
  });

  return events;
}
```

**Step 2: Verify file compiles**

Run: `cd /Users/home/APE-YOLO && npx tsc --noEmit server/services/earningsCalendar.ts`
Expected: No errors (may need to fix imports based on project structure)

**Step 3: Commit**

```bash
git add server/services/earningsCalendar.ts
git commit -m "feat: add earnings calendar service

Fetches earnings from Alpha Vantage EARNINGS_CALENDAR endpoint.
Filters to tracked Mag7 and SPY symbols.
Stores in database with refresh and query functions."
```

---

## Task 4: Create Earnings Calendar Refresh Job

**Files:**
- Create: `server/services/jobs/earningsCalendarRefresh.ts`

**Step 1: Create the job handler**

```typescript
/**
 * Earnings Calendar Refresh Job
 *
 * Fetches upcoming earnings from Alpha Vantage and stores in database.
 * Runs weekly to keep earnings calendar up to date.
 */

import { registerJobHandler, type JobResult, type JobHandler } from '../jobExecutor';
import {
  refreshEarningsCalendar,
  isAlphaVantageConfigured,
} from '../earningsCalendar';

// ============================================
// Types
// ============================================

interface RefreshResult {
  cleared: number;
  inserted: number;
  total: number;
  symbols: string[];
}

// ============================================
// Job Handler Implementation
// ============================================

/**
 * Earnings Calendar Refresh Job Handler
 *
 * - Runs weekly (Sunday night)
 * - Does NOT check market status
 * - Fetches 3 months of earnings data from Alpha Vantage
 */
export const earningsCalendarRefreshHandler: JobHandler = {
  id: 'earnings-calendar-refresh',
  name: 'Earnings Calendar Refresh',
  description: 'Refresh earnings calendar from Alpha Vantage API',

  async execute(): Promise<JobResult> {
    console.log('[EarningsCalendarRefresh] Starting calendar refresh...');

    // 1. Check if Alpha Vantage API is configured
    if (!isAlphaVantageConfigured()) {
      console.log('[EarningsCalendarRefresh] Alpha Vantage API key not configured');
      return {
        success: false,
        skipped: true,
        reason: 'ALPHA_VANTAGE_API_KEY environment variable not set',
      };
    }

    try {
      // 2. Refresh the earnings calendar
      const result = await refreshEarningsCalendar();

      console.log(
        `[EarningsCalendarRefresh] Refresh complete: ` +
        `inserted=${result.inserted}, symbols=${result.symbols.length}`
      );

      // 3. Return success with details
      return {
        success: true,
        data: {
          cleared: result.cleared,
          inserted: result.inserted,
          total: result.total,
          symbols: result.symbols,
        } as RefreshResult,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[EarningsCalendarRefresh] Error:', errorMessage);

      return {
        success: false,
        error: errorMessage,
      };
    }
  },
};

// ============================================
// Registration
// ============================================

/**
 * Initialize and register the earnings calendar refresh job handler
 */
export function initializeEarningsCalendarRefreshJob(): void {
  console.log('[EarningsCalendarRefresh] Initializing job handler...');
  registerJobHandler(earningsCalendarRefreshHandler);
}
```

**Step 2: Verify file compiles**

Run: `cd /Users/home/APE-YOLO && npx tsc --noEmit server/services/jobs/earningsCalendarRefresh.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add server/services/jobs/earningsCalendarRefresh.ts
git commit -m "feat: add earnings calendar refresh job

Weekly job to fetch earnings from Alpha Vantage.
Follows same pattern as economic calendar refresh."
```

---

## Task 5: Register Earnings Job and Update Calendar API

**Files:**
- Modify: `server/jobRoutes.ts:20-26` (imports)
- Modify: `server/jobRoutes.ts:80-131` (calendar endpoint)
- Modify: `server/jobRoutes.ts:261-320` (job registration)

**Step 1: Add imports at top of file**

After the existing imports around line 22-26, add:

```typescript
import {
  getUpcomingEarnings,
  isAlphaVantageConfigured,
} from './services/earningsCalendar';
import { initializeEarningsCalendarRefreshJob } from './services/jobs/earningsCalendarRefresh';
```

**Step 2: Update CalendarEvent type and endpoint**

Find the CalendarEvent interface (around line 70) and add 'earnings' type:

```typescript
interface CalendarEvent {
  date: string;
  event: string;
  type: 'holiday' | 'early_close' | 'economic' | 'earnings';
  impactLevel?: 'low' | 'medium' | 'high' | 'critical';
  time?: string;
  symbol?: string; // For earnings events
}
```

**Step 3: Update the `/api/jobs/calendar` endpoint**

In the GET /calendar handler (around line 80-131), add earnings fetching after economic events:

After the economic events block (around line 112), add:

```typescript
    // Get earnings events from database (if Alpha Vantage is configured)
    let earningsEvents: CalendarEvent[] = [];
    try {
      const dbEarningsEvents = await getUpcomingEarnings(60);
      earningsEvents = dbEarningsEvents.map((event) => ({
        date: event.reportDate,
        event: `${event.symbol} Earnings`,
        type: 'earnings' as const,
        symbol: event.symbol,
      }));
    } catch (err) {
      console.warn('[JobRoutes] Could not fetch earnings events:', err);
    }

    // Merge and sort all events by date
    const upcomingEvents = [...unifiedMarketEvents, ...economicEvents, ...earningsEvents].sort(
      (a, b) => a.date.localeCompare(b.date)
    );
```

**Step 4: Update response to include alphaVantageConfigured**

In the response object (around line 119-126), add:

```typescript
    res.json({
      ok: true,
      today: getETDateString(now),
      marketStatus,
      upcomingEvents,
      calendar,
      fredConfigured: isFREDConfigured(),
      alphaVantageConfigured: isAlphaVantageConfigured(),
    });
```

**Step 5: Register the job handler**

In the initializeJobRoutes function (around line 261-320), add after economic calendar registration:

```typescript
  // Earnings Calendar Refresh
  initializeEarningsCalendarRefreshJob();
  await registerOrUpdateJob({
    name: 'earnings-calendar-refresh',
    description: 'Refresh earnings calendar from Alpha Vantage API',
    type: 'earnings-calendar-refresh',
    schedule: '0 23 * * 0', // Sunday at 11 PM ET
    timezone: 'America/New_York',
    enabled: true,
    config: {},
  });
```

**Step 6: Verify file compiles**

Run: `cd /Users/home/APE-YOLO && npx tsc --noEmit server/jobRoutes.ts`
Expected: No errors

**Step 7: Commit**

```bash
git add server/jobRoutes.ts
git commit -m "feat: add earnings to calendar API endpoint

Registers earnings refresh job (weekly Sunday night).
Updates /api/jobs/calendar to include earnings events.
Adds alphaVantageConfigured flag to response."
```

---

## Task 6: Move Alpha Vantage API Key to Environment Variable

**Files:**
- Modify: `server/services/alphaVantageService.ts:14`

**Step 1: Update the API key reference**

Change line 14 from:

```typescript
const ALPHA_VANTAGE_API_KEY = '6EIZ8P6R9G9ZAIW6';
```

To:

```typescript
function getAlphaVantageApiKey(): string | undefined {
  return process.env.ALPHA_VANTAGE_API_KEY;
}
```

**Step 2: Update fetchIntradayBars function**

Find the fetch URL construction (around line 86) and update:

```typescript
  const apiKey = getAlphaVantageApiKey();
  if (!apiKey) {
    throw new Error('ALPHA_VANTAGE_API_KEY not configured');
  }
  const url = `${BASE_URL}?function=TIME_SERIES_INTRADAY&symbol=${symbol}&interval=1min&apikey=${apiKey}&outputsize=full`;
```

**Step 3: Update .env.example (if exists) or document in README**

Add to environment documentation:

```
ALPHA_VANTAGE_API_KEY=your_key_here
```

**Step 4: Verify file compiles**

Run: `cd /Users/home/APE-YOLO && npx tsc --noEmit server/services/alphaVantageService.ts`
Expected: No errors

**Step 5: Commit**

```bash
git add server/services/alphaVantageService.ts
git commit -m "refactor: move Alpha Vantage API key to environment variable

Removes hardcoded API key for security.
Now uses ALPHA_VANTAGE_API_KEY environment variable."
```

---

## Task 7: Update useJobs Hook Types

**Files:**
- Modify: `client/src/hooks/useJobs.ts:48-54`

**Step 1: Update MarketEvent interface**

Change the MarketEvent interface (around line 48-54) to include 'earnings':

```typescript
export interface MarketEvent {
  date: string;
  event: string;
  type: 'holiday' | 'early_close' | 'economic' | 'earnings';
  impactLevel?: 'low' | 'medium' | 'high' | 'critical';
  time?: string;
  symbol?: string; // For earnings events
}
```

**Step 2: Update MarketCalendar interface response type**

Add to the MarketCalendar interface (around line 56-67):

```typescript
export interface MarketCalendar {
  today: string;
  marketStatus: MarketStatus;
  upcomingEvents: MarketEvent[];
  calendar: Array<{
    date: string;
    isOpen: boolean;
    closeTime: string;
    holiday?: string;
    earlyClose?: boolean;
  }>;
  fredConfigured?: boolean;
  alphaVantageConfigured?: boolean;
}
```

**Step 3: Verify file compiles**

Run: `cd /Users/home/APE-YOLO && npx tsc --noEmit client/src/hooks/useJobs.ts`
Expected: No errors

**Step 4: Commit**

```bash
git add client/src/hooks/useJobs.ts
git commit -m "feat: add earnings type to MarketEvent interface

Updates hook types to support earnings events from API."
```

---

## Task 8: Update CalendarWindow to Use API Data

**Files:**
- Modify: `client/src/components/terminal/windows/CalendarWindow.tsx` (major rewrite)

**Step 1: Add useJobs import and remove hardcoded data**

Replace the entire file with the updated version that:
1. Imports `useJobs` hook
2. Removes all hardcoded data (US_HOLIDAYS, EARLY_CLOSE_DAYS, ECONOMIC_EVENTS, MAG7_EARNINGS)
3. Builds event map from API response
4. Adds loading/error states

```typescript
/**
 * CalendarWindow - Monthly calendar view for market events
 *
 * Shows: Holidays, Early Closes, Economic Events (FOMC, CPI, NFP, etc.), Earnings
 * Data fetched from /api/jobs/calendar API endpoint.
 */

import { useState, useMemo } from 'react';
import { useJobs } from '../../../hooks/useJobs';

// ============================================
// Event Colors
// ============================================

const EVENT_COLORS = {
  holiday: '#ef4444',      // Red - market closed
  early_close: '#f59e0b',  // Yellow - early close
  economic: '#3b82f6',     // Blue - economic event
  earnings: '#a855f7',     // Purple - earnings
};

// ============================================
// Helper Functions
// ============================================

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

interface CalendarEvent {
  type: 'holiday' | 'early_close' | 'economic' | 'earnings';
  name: string;
  time?: string;
}

interface CalendarDay {
  date: Date;
  day: number;
  dateStr: string;
  isCurrentMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
  events: CalendarEvent[];
}

function formatDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getCalendarDays(
  year: number,
  month: number,
  eventMap: Map<string, CalendarEvent[]>
): CalendarDay[] {
  const today = new Date();
  const todayStr = formatDateStr(today.getFullYear(), today.getMonth(), today.getDate());

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startPadding = firstDay.getDay();
  const totalDays = lastDay.getDate();

  const days: CalendarDay[] = [];

  // Previous month padding
  const prevMonth = new Date(year, month, 0);
  const prevMonthDays = prevMonth.getDate();
  const prevYear = month === 0 ? year - 1 : year;
  const prevMonthNum = month === 0 ? 11 : month - 1;

  for (let i = startPadding - 1; i >= 0; i--) {
    const day = prevMonthDays - i;
    const date = new Date(prevYear, prevMonthNum, day);
    const dateStr = formatDateStr(prevYear, prevMonthNum, day);
    const dayOfWeek = date.getDay();
    days.push({
      date,
      day,
      dateStr,
      isCurrentMonth: false,
      isToday: dateStr === todayStr,
      isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
      events: eventMap.get(dateStr) || [],
    });
  }

  // Current month
  for (let day = 1; day <= totalDays; day++) {
    const date = new Date(year, month, day);
    const dateStr = formatDateStr(year, month, day);
    const dayOfWeek = date.getDay();
    days.push({
      date,
      day,
      dateStr,
      isCurrentMonth: true,
      isToday: dateStr === todayStr,
      isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
      events: eventMap.get(dateStr) || [],
    });
  }

  // Next month padding (fill to 42 cells for 6 rows)
  const remaining = 42 - days.length;
  const nextYear = month === 11 ? year + 1 : year;
  const nextMonthNum = month === 11 ? 0 : month + 1;

  for (let day = 1; day <= remaining; day++) {
    const date = new Date(nextYear, nextMonthNum, day);
    const dateStr = formatDateStr(nextYear, nextMonthNum, day);
    const dayOfWeek = date.getDay();
    days.push({
      date,
      day,
      dateStr,
      isCurrentMonth: false,
      isToday: dateStr === todayStr,
      isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
      events: eventMap.get(dateStr) || [],
    });
  }

  return days;
}

// ============================================
// Components
// ============================================

export function CalendarWindow() {
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<CalendarDay | null>(null);

  // Fetch calendar data from API
  const { calendarQuery } = useJobs();
  const { data: calendarData, isLoading, error } = calendarQuery;

  // Build event map from API response
  const eventMap = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();

    if (!calendarData?.upcomingEvents) return map;

    for (const event of calendarData.upcomingEvents) {
      const existing = map.get(event.date) || [];
      existing.push({
        type: event.type,
        name: event.event,
        time: event.time,
      });
      map.set(event.date, existing);
    }

    return map;
  }, [calendarData?.upcomingEvents]);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const days = useMemo(() => getCalendarDays(year, month, eventMap), [year, month, eventMap]);

  const goToPrevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const goToNextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const goToToday = () => setCurrentDate(new Date());

  // Loading state
  if (isLoading) {
    return (
      <div style={{
        height: '100%',
        backgroundColor: '#0a0a0a',
        fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
        color: '#666',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        Loading calendar...
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div style={{
        height: '100%',
        backgroundColor: '#0a0a0a',
        fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
        color: '#ef4444',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        textAlign: 'center',
      }}>
        Failed to load calendar: {error.message}
      </div>
    );
  }

  return (
    <div style={{
      height: '100%',
      backgroundColor: '#0a0a0a',
      fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
      color: '#e5e5e5',
      padding: '12px',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '12px',
      }}>
        <button onClick={goToPrevMonth} style={navBtnStyle}>&lt;</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '14px', fontWeight: 500 }}>
            {MONTHS[month]} {year}
          </span>
          <button onClick={goToToday} style={{ ...navBtnStyle, fontSize: '10px', padding: '2px 6px' }}>
            Today
          </button>
        </div>
        <button onClick={goToNextMonth} style={navBtnStyle}>&gt;</button>
      </div>

      {/* Day headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '1px', marginBottom: '4px' }}>
        {DAYS.map(day => (
          <div key={day} style={{
            textAlign: 'center',
            padding: '4px 0',
            fontSize: '9px',
            color: '#666',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        gap: '1px',
        flex: 1,
        minHeight: 0,
      }}>
        {days.map((day, i) => (
          <DayCell
            key={i}
            day={day}
            onClick={() => day.events.length > 0 && setSelectedDay(day)}
          />
        ))}
      </div>

      {/* Legend */}
      <div style={{
        display: 'flex',
        gap: '12px',
        marginTop: '8px',
        paddingTop: '8px',
        borderTop: '1px solid #222',
        fontSize: '9px',
        flexWrap: 'wrap',
      }}>
        <LegendItem color={EVENT_COLORS.holiday} label="Holiday" />
        <LegendItem color={EVENT_COLORS.early_close} label="Early Close" />
        <LegendItem color={EVENT_COLORS.economic} label="Econ" />
        <LegendItem color={EVENT_COLORS.earnings} label="Earnings" />
      </div>

      {/* Selected day popup */}
      {selectedDay && (
        <div style={{
          position: 'absolute',
          bottom: '60px',
          left: '12px',
          right: '12px',
          backgroundColor: '#1a1a1a',
          border: '1px solid #333',
          borderRadius: '4px',
          padding: '12px',
          maxHeight: '150px',
          overflow: 'auto',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontWeight: 500, fontSize: '12px' }}>
              {selectedDay.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </span>
            <button
              onClick={() => setSelectedDay(null)}
              style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '14px' }}
            >
              x
            </button>
          </div>
          {selectedDay.events.map((event, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', fontSize: '11px' }}>
              <span style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: EVENT_COLORS[event.type],
                flexShrink: 0,
              }} />
              <span>{event.name}</span>
              {event.time && <span style={{ color: '#666' }}>{event.time}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const navBtnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid #333',
  color: '#888',
  padding: '4px 10px',
  cursor: 'pointer',
  fontSize: '12px',
  borderRadius: '2px',
};

function DayCell({ day, onClick }: { day: CalendarDay; onClick: () => void }) {
  const hasEvents = day.events.length > 0;

  // Get unique event types
  const eventTypes = [...new Set(day.events.map(e => e.type))];

  return (
    <div
      onClick={hasEvents ? onClick : undefined}
      style={{
        aspectRatio: '1',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '11px',
        color: day.isCurrentMonth
          ? (day.isWeekend ? '#666' : '#e5e5e5')
          : '#333',
        backgroundColor: day.isToday ? '#1a1a2e' : 'transparent',
        border: day.isToday ? '1px solid #444' : '1px solid transparent',
        borderRadius: '2px',
        cursor: hasEvents ? 'pointer' : 'default',
        position: 'relative',
        transition: 'background-color 0.1s',
      }}
      onMouseOver={e => {
        if (hasEvents) e.currentTarget.style.backgroundColor = '#1a1a1a';
      }}
      onMouseOut={e => {
        e.currentTarget.style.backgroundColor = day.isToday ? '#1a1a2e' : 'transparent';
      }}
    >
      <span style={{ fontWeight: day.isToday ? 600 : 400 }}>{day.day}</span>

      {eventTypes.length > 0 && (
        <div style={{
          display: 'flex',
          gap: '2px',
          marginTop: '2px',
          position: 'absolute',
          bottom: '3px',
        }}>
          {eventTypes.map((type, i) => (
            <span
              key={i}
              style={{
                width: '4px',
                height: '4px',
                borderRadius: '50%',
                backgroundColor: EVENT_COLORS[type],
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#666' }}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: color }} />
      <span>{label}</span>
    </div>
  );
}
```

**Step 2: Verify file compiles**

Run: `cd /Users/home/APE-YOLO && npx tsc --noEmit client/src/components/terminal/windows/CalendarWindow.tsx`
Expected: No errors

**Step 3: Commit**

```bash
git add client/src/components/terminal/windows/CalendarWindow.tsx
git commit -m "feat: connect CalendarWindow to API

Removes all hardcoded event data.
Fetches holidays, early closes, economic events, and earnings from API.
Adds loading and error states."
```

---

## Task 9: Add Drizzle Relations for Earnings Calendar

**Files:**
- Modify: `shared/schema.ts` (add relations if needed)

**Step 1: Verify earningsCalendar has proper relations export**

Check if the project uses Drizzle relations pattern. If so, add:

```typescript
export const earningsCalendarRelations = relations(earningsCalendar, ({ }) => ({
  // No relations needed for this table currently
}));
```

**Step 2: Verify the schema is properly exported**

Ensure `earningsCalendar` is exported from the schema file and available in `db.query`.

**Step 3: Test database query**

Run: `cd /Users/home/APE-YOLO && npm run dev`
Then in another terminal: `curl http://localhost:5000/api/jobs/calendar | jq .`
Expected: Response includes `upcomingEvents` array (may be empty if no data yet)

**Step 4: Commit (if changes made)**

```bash
git add shared/schema.ts
git commit -m "chore: add earnings calendar relations

Ensures earningsCalendar table is queryable via db.query pattern."
```

---

## Task 10: Test End-to-End Integration

**Files:**
- No files to modify - testing only

**Step 1: Set environment variable**

Ensure `.env` has:
```
ALPHA_VANTAGE_API_KEY=6EIZ8P6R9G9ZAIW6
```

**Step 2: Start the dev server**

Run: `cd /Users/home/APE-YOLO && npm run dev`
Expected: Server starts without errors

**Step 3: Manually trigger earnings refresh**

Run: `curl -X POST http://localhost:5000/api/jobs/earnings-calendar-refresh/run -H "Content-Type: application/json" -d '{"skipMarketCheck": true}'`
Expected: Job runs successfully, earnings data stored in database

**Step 4: Verify calendar API returns earnings**

Run: `curl http://localhost:5000/api/jobs/calendar | jq '.upcomingEvents | map(select(.type == "earnings")) | length'`
Expected: Number greater than 0

**Step 5: Verify CalendarWindow displays events**

Open browser to app, navigate to Calendar window.
Expected:
- Blue dots for economic events (FOMC, CPI)
- Purple dots for earnings events
- Red dots for holidays
- Click on a day with events to see popup

**Step 6: Final commit**

```bash
git add -A
git commit -m "test: verify calendar integration working

All event types displaying correctly in CalendarWindow."
```

---

## Verification Checklist

After completing all tasks, verify:

- [ ] Database has `earnings_calendar` table: `SELECT * FROM earnings_calendar LIMIT 5;`
- [ ] Economic events exist: `SELECT COUNT(*) FROM economic_events;`
- [ ] Earnings events exist: `SELECT COUNT(*) FROM earnings_calendar;`
- [ ] API returns all event types: `curl /api/jobs/calendar | jq '.upcomingEvents | group_by(.type) | map({type: .[0].type, count: length})'`
- [ ] CalendarWindow shows colored dots for each event type
- [ ] Clicking a day shows event details popup
- [ ] Loading state shows while fetching
- [ ] Error state shows if API fails
- [ ] Jobs registered: `curl /api/jobs | jq '.jobs | map(.name)'` includes both calendar refresh jobs

---

## Rollback Plan

If issues arise:

1. **Schema issues:** Run `npm run db:rollback` to undo migration
2. **API issues:** Revert jobRoutes.ts changes
3. **Frontend issues:** Restore CalendarWindow.tsx from git history

```bash
# Restore CalendarWindow to hardcoded version
git checkout HEAD~1 -- client/src/components/terminal/windows/CalendarWindow.tsx
```
