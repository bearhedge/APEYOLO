/**
 * Theta Data API Client
 *
 * Provides access to historical options and stock data for RLHF training.
 * The Theta Terminal must be running locally on port 25503.
 *
 * Subscription: Options STANDARD (intraday options data)
 * For VIX data, we fall back to Yahoo Finance.
 */

const THETA_BASE_URL = process.env.THETA_BASE_URL || 'http://localhost:25503';

// ============================================
// Types
// ============================================

export interface ThetaOHLCBar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap?: number;
  count?: number;
}

export interface ThetaOptionsBar extends ThetaOHLCBar {
  strike: number;
  expiration: string;
  right: 'CALL' | 'PUT';
}

export interface ThetaGreeksFirstOrder {
  timestamp: string;
  underlying_timestamp: string;
  underlying_price: number;
  delta: number;
  theta: number;
  vega: number;
  rho: number;
  implied_vol: number;
  epsilon: number;
  lambda: number;
  iv_error: number;
  bid: number;
  ask: number;
  strike: number;
  right: string;
  expiration: string;
}

export interface ThetaGreeksEOD {
  timestamp: string;
  underlying_timestamp: string;
  underlying_price: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
  implied_vol: number;
  // Second order
  charm: number;
  vanna: number;
  vomma: number;
  // Third order
  speed: number;
  color: number;
  zomma: number;
  vera: number;
  veta: number;
  ultima: number;
  // Other
  dual_delta: number;
  dual_gamma: number;
  d1: number;
  d2: number;
  epsilon: number;
  lambda: number;
  iv_error: number;
  // OHLC
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  count: number;
  bid: number;
  ask: number;
  bid_size: number;
  ask_size: number;
  strike: number;
  right: string;
  expiration: string;
}

export interface ThetaQuote {
  timestamp: string;
  bid: number;
  ask: number;
  bid_size: number;
  ask_size: number;
  bid_exchange: number;
  ask_exchange: number;
  bid_condition: number;
  ask_condition: number;
  strike: number;
  right: string;
  expiration: string;
}

export interface ThetaOpenInterest {
  timestamp: string;
  open_interest: number;
  strike: number;
  right: string;
  expiration: string;
}

export interface ThetaOptionsSnapshot {
  symbol: string;
  expiration: string;
  strike: number;
  right: 'CALL' | 'PUT';
  bid: number;
  ask: number;
  last: number;
  volume: number;
  openInterest: number;
  greeks: ThetaGreeks | null;
}

export type Interval = '1m' | '5m' | '15m' | '30m' | '1h';

// ============================================
// Response Parsing
// ============================================

/**
 * Theta returns columnar JSON format like:
 * { "open": [...], "high": [...], "timestamp": [...] }
 *
 * This converts it to row-based format.
 */
function parseColumnarResponse<T>(data: Record<string, unknown[]>): T[] {
  const keys = Object.keys(data);
  if (keys.length === 0 || !data[keys[0]]) return [];

  const length = (data[keys[0]] as unknown[]).length;
  const rows: T[] = [];

  for (let i = 0; i < length; i++) {
    const row: Record<string, unknown> = {};
    for (const key of keys) {
      row[key] = (data[key] as unknown[])[i];
    }
    rows.push(row as T);
  }

  return rows;
}

// ============================================
// API Functions
// ============================================

/**
 * Check if Theta Terminal is running
 */
export async function isThetaAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${THETA_BASE_URL}/v3/`, { signal: AbortSignal.timeout(2000) });
    return response.ok || response.status === 404; // 404 is fine, means server is up
  } catch {
    return false;
  }
}

/**
 * Fetch historical options OHLC bars for a specific contract
 */
export async function fetchOptionsOHLC(params: {
  symbol: string;
  expiration: string; // YYYYMMDD
  strike: number;
  right: 'call' | 'put';
  date: string; // YYYYMMDD
  interval: Interval;
  startTime?: string; // HH:MM:SS, default 09:30:00
  endTime?: string; // HH:MM:SS, default 16:00:00
}): Promise<ThetaOptionsBar[]> {
  const url = new URL(`${THETA_BASE_URL}/v3/option/history/ohlc`);
  url.searchParams.set('symbol', params.symbol);
  url.searchParams.set('expiration', params.expiration);
  url.searchParams.set('strike', params.strike.toString());
  url.searchParams.set('right', params.right);
  url.searchParams.set('date', params.date);
  url.searchParams.set('interval', params.interval);
  url.searchParams.set('format', 'json');

  if (params.startTime) url.searchParams.set('start_time', params.startTime);
  if (params.endTime) url.searchParams.set('end_time', params.endTime);

  const response = await fetch(url.toString());
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Theta API error: ${text}`);
  }

  const data = await response.json();
  return parseColumnarResponse<ThetaOptionsBar>(data);
}

/**
 * Fetch all strikes for a given expiration (options chain snapshot)
 */
export async function fetchOptionsChain(params: {
  symbol: string;
  expiration: string; // YYYYMMDD
  date: string; // YYYYMMDD
  interval?: Interval;
}): Promise<ThetaOptionsBar[]> {
  const url = new URL(`${THETA_BASE_URL}/v3/option/history/ohlc`);
  url.searchParams.set('symbol', params.symbol);
  url.searchParams.set('expiration', params.expiration);
  url.searchParams.set('strike', '*'); // All strikes
  url.searchParams.set('right', 'both');
  url.searchParams.set('date', params.date);
  url.searchParams.set('interval', params.interval || '5m');
  url.searchParams.set('format', 'json');

  const response = await fetch(url.toString());
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Theta API error: ${text}`);
  }

  const data = await response.json();
  return parseColumnarResponse<ThetaOptionsBar>(data);
}

/**
 * Fetch historical Greeks (first order) for options - WORKS WITH STANDARD SUBSCRIPTION
 * Returns: delta, theta, vega, rho, IV, epsilon, lambda
 */
export async function fetchOptionsGreeksFirstOrder(params: {
  symbol: string;
  expiration: string;
  date: string;
  interval?: Interval;
  strike?: number | '*';
  right?: 'call' | 'put' | 'both';
}): Promise<ThetaGreeksFirstOrder[]> {
  const url = new URL(`${THETA_BASE_URL}/v3/option/history/greeks/first_order`);
  url.searchParams.set('symbol', params.symbol);
  url.searchParams.set('expiration', params.expiration);
  url.searchParams.set('date', params.date);
  url.searchParams.set('interval', params.interval || '5m');
  url.searchParams.set('strike', params.strike?.toString() || '*');
  url.searchParams.set('right', params.right || 'both');
  url.searchParams.set('format', 'json');

  const response = await fetch(url.toString());
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Theta API error: ${text}`);
  }

  const data = await response.json();
  return parseColumnarResponse<ThetaGreeksFirstOrder>(data);
}

/**
 * Fetch end-of-day Greeks (ALL Greeks including gamma, vanna, charm, etc.)
 * WORKS WITH STANDARD SUBSCRIPTION - returns 44 Greeks fields
 */
export async function fetchOptionsGreeksEOD(params: {
  symbol: string;
  expiration: string;
  startDate: string;
  endDate: string;
  strike?: number | '*';
  right?: 'call' | 'put' | 'both';
}): Promise<ThetaGreeksEOD[]> {
  const url = new URL(`${THETA_BASE_URL}/v3/option/history/greeks/eod`);
  url.searchParams.set('symbol', params.symbol);
  url.searchParams.set('expiration', params.expiration);
  url.searchParams.set('start_date', params.startDate);
  url.searchParams.set('end_date', params.endDate);
  url.searchParams.set('strike', params.strike?.toString() || '*');
  url.searchParams.set('right', params.right || 'both');
  url.searchParams.set('format', 'json');

  const response = await fetch(url.toString());
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Theta API error: ${text}`);
  }

  const data = await response.json();
  return parseColumnarResponse<ThetaGreeksEOD>(data);
}

/**
 * Fetch historical quotes (bid/ask with size and exchange)
 */
export async function fetchOptionsQuotes(params: {
  symbol: string;
  expiration: string;
  date: string;
  interval?: Interval;
  strike?: number | '*';
  right?: 'call' | 'put' | 'both';
}): Promise<ThetaQuote[]> {
  const url = new URL(`${THETA_BASE_URL}/v3/option/history/quote`);
  url.searchParams.set('symbol', params.symbol);
  url.searchParams.set('expiration', params.expiration);
  url.searchParams.set('date', params.date);
  url.searchParams.set('interval', params.interval || '5m');
  url.searchParams.set('strike', params.strike?.toString() || '*');
  url.searchParams.set('right', params.right || 'both');
  url.searchParams.set('format', 'json');

  const response = await fetch(url.toString());
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Theta API error: ${text}`);
  }

  const data = await response.json();
  return parseColumnarResponse<ThetaQuote>(data);
}

/**
 * Fetch historical open interest
 */
export async function fetchOptionsOpenInterest(params: {
  symbol: string;
  expiration: string;
  date: string;
  strike?: number | '*';
  right?: 'call' | 'put' | 'both';
}): Promise<ThetaOpenInterest[]> {
  const url = new URL(`${THETA_BASE_URL}/v3/option/history/open_interest`);
  url.searchParams.set('symbol', params.symbol);
  url.searchParams.set('expiration', params.expiration);
  url.searchParams.set('date', params.date);
  url.searchParams.set('strike', params.strike?.toString() || '*');
  url.searchParams.set('right', params.right || 'both');
  url.searchParams.set('format', 'json');

  const response = await fetch(url.toString());
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Theta API error: ${text}`);
  }

  const data = await response.json();
  return parseColumnarResponse<ThetaOpenInterest>(data);
}

/**
 * Get available expirations for a symbol
 */
export async function fetchExpirations(symbol: string): Promise<string[]> {
  const url = new URL(`${THETA_BASE_URL}/v3/option/snapshot/expirations`);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('format', 'json');

  const response = await fetch(url.toString());
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Theta API error: ${text}`);
  }

  const data = await response.json();
  return data.expirations || data.expiration || [];
}

/**
 * Get available strikes for a symbol and expiration
 */
export async function fetchStrikes(symbol: string, expiration: string): Promise<number[]> {
  const url = new URL(`${THETA_BASE_URL}/v3/option/snapshot/strikes`);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('expiration', expiration);
  url.searchParams.set('format', 'json');

  const response = await fetch(url.toString());
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Theta API error: ${text}`);
  }

  const data = await response.json();
  return data.strikes || data.strike || [];
}

/**
 * Fetch intraday snapshot at a specific time
 * Returns options data for a symbol at a point in time
 */
export async function fetchOptionsSnapshotAtTime(params: {
  symbol: string;
  expiration: string;
  date: string;
  time: string; // HH:MM:SS
}): Promise<ThetaOptionsBar[]> {
  // Get bars for a short window around the target time
  const [hours, minutes] = params.time.split(':').map(Number);
  const endMinutes = minutes + 5;
  const endTime = `${String(hours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}:00`;

  return fetchOptionsChain({
    symbol: params.symbol,
    expiration: params.expiration,
    date: params.date,
    interval: '5m',
  });
}

// ============================================
// Training Data Helpers
// ============================================

/**
 * Get all trading days between two dates (excludes weekends)
 */
export function getTradingDays(startDate: string, endDate: string): string[] {
  const days: string[] = [];
  const start = new Date(startDate.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'));
  const end = new Date(endDate.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'));

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dayOfWeek = d.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      // Skip weekends
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      days.push(`${year}${month}${day}`);
    }
  }

  return days;
}

/**
 * Format date as YYYYMMDD
 */
export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Parse YYYYMMDD to Date
 */
export function parseDate(dateStr: string): Date {
  const year = parseInt(dateStr.slice(0, 4));
  const month = parseInt(dateStr.slice(4, 6)) - 1;
  const day = parseInt(dateStr.slice(6, 8));
  return new Date(year, month, day);
}

/**
 * Find the next 0DTE expiration for a given date
 * For SPY/SPX, there are daily expirations M-F
 */
export function get0DTEExpiration(date: string): string {
  // For 0DTE, the expiration is the same day
  return date;
}

/**
 * Find the weekly expiration (Friday) for a given date
 */
export function getWeeklyExpiration(date: string): string {
  const d = parseDate(date);
  const dayOfWeek = d.getDay();
  const daysUntilFriday = (5 - dayOfWeek + 7) % 7;
  d.setDate(d.getDate() + (daysUntilFriday === 0 ? 0 : daysUntilFriday));
  return formatDate(d);
}
