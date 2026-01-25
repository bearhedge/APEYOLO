/**
 * Earnings Calendar Configuration
 *
 * This file defines the stock symbols tracked for earnings calendar events.
 * It includes the Magnificent 7 tech stocks and top S&P 500 companies by market cap.
 * These symbols are used to fetch and display upcoming earnings announcements
 * in the automated calendar events system.
 */

/**
 * Magnificent 7 - The seven largest tech companies by market cap
 */
export const MAG7_SYMBOLS = [
  'AAPL',
  'MSFT',
  'GOOGL',
  'AMZN',
  'META',
  'NVDA',
  'TSLA',
] as const;

/**
 * Top S&P 500 companies (excluding MAG7) by market cap
 */
export const TOP_SPY_SYMBOLS = [
  'BRK.B',
  'JPM',
  'V',
  'UNH',
  'XOM',
  'MA',
  'JNJ',
  'HD',
  'PG',
  'COST',
  'ABBV',
  'CVX',
  'MRK',
  'LLY',
  'BAC',
  'KO',
  'PEP',
  'AVGO',
  'WMT',
  'AMD',
  'ORCL',
  'CRM',
  'MCD',
  'CSCO',
  'NFLX',
  'ADBE',
  'TMO',
  'ACN',
  'INTC',
  'DIS',
] as const;

/**
 * All tracked earnings symbols - combination of MAG7 and top S&P 500 companies
 */
export const TRACKED_EARNINGS_SYMBOLS = [
  ...MAG7_SYMBOLS,
  ...TOP_SPY_SYMBOLS,
] as const;

/**
 * Mapping of stock symbols to their full company names
 */
export const COMPANY_NAMES: Record<string, string> = {
  // MAG7
  AAPL: 'Apple Inc.',
  MSFT: 'Microsoft Corporation',
  GOOGL: 'Alphabet Inc.',
  AMZN: 'Amazon.com Inc.',
  META: 'Meta Platforms Inc.',
  NVDA: 'NVIDIA Corporation',
  TSLA: 'Tesla Inc.',
  // Top S&P 500
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

// Type exports for type-safe usage
export type Mag7Symbol = (typeof MAG7_SYMBOLS)[number];
export type TopSpySymbol = (typeof TOP_SPY_SYMBOLS)[number];
export type TrackedEarningsSymbol = (typeof TRACKED_EARNINGS_SYMBOLS)[number];
