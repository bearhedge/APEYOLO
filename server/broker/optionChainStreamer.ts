/**
 * Option Chain Streamer - WebSocket Cache Layer for Engine
 *
 * Architecture:
 * Layer 3: ENGINE → reads from cache (instant)
 * Layer 2: OptionChainCache → maintained by this module
 * Layer 1: WebSocket → pushes updates from IBKR
 *
 * Benefits over HTTP snapshots:
 * - Instant reads for engine (no 200-500ms HTTP latency)
 * - Continuously updated data (not point-in-time)
 * - Multiple engine runs share same cache
 */

import {
  IbkrWebSocketManager,
  MarketDataUpdate,
  getIbkrWebSocketManager,
  initIbkrWebSocket
} from './ibkrWebSocket';
import {
  getOptionChainWithStrikes,
  getIbkrCookieString,
  resolveSymbolConid
} from './ibkr';

// Strike data structure matching engine expectations
export interface CachedStrike {
  strike: number;
  conid: number;
  bid: number;
  ask: number;
  last?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  iv?: number;
  openInterest?: number;
  lastUpdate: Date;
}

// Cached option chain structure
export interface CachedOptionChain {
  symbol: string;
  underlyingPrice: number;
  underlyingConid: number;
  vix: number;
  expectedMove: number;
  strikeRangeLow: number;
  strikeRangeHigh: number;
  puts: CachedStrike[];
  calls: CachedStrike[];
  dataSource: 'websocket' | 'http' | 'mock';
  lastFullRefresh: Date;
  lastUpdate: Date;
}

interface SymbolCache {
  chain: CachedOptionChain;
  conidToStrike: Map<number, { type: 'put' | 'call'; strike: number }>;
}

// Stale threshold in milliseconds (5 seconds)
const STALE_THRESHOLD_MS = 5000;

// Broadcast function (injected from routes.ts)
function broadcastOptionChainUpdate(message: object): void {
  const broadcast = (global as any).broadcastOptionChainUpdate;
  if (typeof broadcast === 'function') {
    broadcast(message);
  }
}

// How often to refresh the full chain from HTTP (backup, every 5 minutes)
const FULL_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export class OptionChainStreamer {
  private wsManager: IbkrWebSocketManager | null = null;
  private cache = new Map<string, SymbolCache>();
  private unsubscribeCallback: (() => void) | null = null;
  private isStreaming = false;
  private autoStartTimeout: NodeJS.Timeout | null = null;
  private refreshIntervals = new Map<string, NodeJS.Timeout>();

  /**
   * Start streaming option chain for a symbol
   */
  async startStreaming(symbol: string): Promise<void> {
    console.log(`[OptionChainStreamer] Starting streaming for ${symbol}`);

    try {
      // Step 1: Initialize WebSocket if needed
      await this.ensureWebSocketConnected();

      // Step 2: Fetch initial chain data via HTTP (to get conids and current state)
      const httpChain = await getOptionChainWithStrikes(symbol);

      if (httpChain.underlyingPrice === 0) {
        console.warn(`[OptionChainStreamer] Market closed - underlying price is 0 for ${symbol}`);
        // Store what we have but mark as HTTP source
        this.initializeCache(symbol, httpChain, 'http');
        return;
      }

      // Step 3: Initialize cache with HTTP data
      this.initializeCache(symbol, httpChain, 'websocket');

      // Step 4: Resolve underlying conid for price streaming
      const underlyingConid = await resolveSymbolConid(symbol);
      if (underlyingConid) {
        this.cache.get(symbol)!.chain.underlyingConid = underlyingConid;
        this.wsManager?.subscribe(underlyingConid, { symbol, type: 'stock' });
      }

      // Step 5: Subscribe to all option conids
      const symbolCache = this.cache.get(symbol)!;
      const optionConids: number[] = [];

      for (const put of symbolCache.chain.puts) {
        if (put.conid) {
          optionConids.push(put.conid);
          symbolCache.conidToStrike.set(put.conid, { type: 'put', strike: put.strike });
        }
      }

      for (const call of symbolCache.chain.calls) {
        if (call.conid) {
          optionConids.push(call.conid);
          symbolCache.conidToStrike.set(call.conid, { type: 'call', strike: call.strike });
        }
      }

      console.log(`[OptionChainStreamer] Subscribing to ${optionConids.length} option conids for ${symbol}`);

      for (const conid of optionConids) {
        this.wsManager?.subscribe(conid, { symbol: `${symbol}-OPT`, type: 'option' });
      }

      this.isStreaming = true;

      // Step 6: Set up periodic full refresh as backup
      const refreshInterval = setInterval(async () => {
        console.log(`[OptionChainStreamer] Periodic refresh for ${symbol}`);
        await this.refreshChain(symbol);
      }, FULL_REFRESH_INTERVAL_MS);
      this.refreshIntervals.set(symbol, refreshInterval);

      console.log(`[OptionChainStreamer] Streaming active for ${symbol} with ${optionConids.length} options`);

    } catch (error) {
      console.error(`[OptionChainStreamer] Failed to start streaming for ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Stop streaming for a symbol
   */
  stopStreaming(symbol: string): void {
    console.log(`[OptionChainStreamer] Stopping streaming for ${symbol}`);

    const symbolCache = this.cache.get(symbol);
    if (symbolCache && this.wsManager) {
      // Unsubscribe from underlying
      if (symbolCache.chain.underlyingConid) {
        this.wsManager.unsubscribe(symbolCache.chain.underlyingConid);
      }

      // Unsubscribe from all options
      for (const conid of symbolCache.conidToStrike.keys()) {
        this.wsManager.unsubscribe(conid);
      }
    }

    // Clear refresh interval
    const interval = this.refreshIntervals.get(symbol);
    if (interval) {
      clearInterval(interval);
      this.refreshIntervals.delete(symbol);
    }

    this.cache.delete(symbol);

    // Check if any symbols still streaming
    if (this.cache.size === 0) {
      this.isStreaming = false;
    }
  }

  /**
   * Stop all streaming
   */
  stopAll(): void {
    console.log('[OptionChainStreamer] Stopping all streaming');

    for (const symbol of this.cache.keys()) {
      this.stopStreaming(symbol);
    }

    if (this.unsubscribeCallback) {
      this.unsubscribeCallback();
      this.unsubscribeCallback = null;
    }

    if (this.autoStartTimeout) {
      clearTimeout(this.autoStartTimeout);
      this.autoStartTimeout = null;
    }

    this.isStreaming = false;
  }

  /**
   * Get cached option chain for engine use
   * Returns null if cache is stale or empty (fallback to HTTP)
   */
  getOptionChain(symbol: string): CachedOptionChain | null {
    const symbolCache = this.cache.get(symbol);

    if (!symbolCache) {
      console.log(`[OptionChainStreamer] No cache for ${symbol}`);
      return null;
    }

    const chain = symbolCache.chain;
    const now = new Date();
    const ageMs = now.getTime() - chain.lastUpdate.getTime();

    // Check if cache is stale
    if (ageMs > STALE_THRESHOLD_MS) {
      console.log(`[OptionChainStreamer] Cache stale for ${symbol} (age: ${ageMs}ms)`);
      return null;
    }

    console.log(`[OptionChainStreamer] Returning cached chain for ${symbol} (age: ${ageMs}ms, source: ${chain.dataSource})`);
    return chain;
  }

  /**
   * Get streaming status
   */
  getStatus(): {
    isStreaming: boolean;
    symbols: string[];
    subscriptionCount: number;
    wsConnected: boolean;
  } {
    const symbols = Array.from(this.cache.keys());
    let subscriptionCount = 0;

    for (const symbolCache of this.cache.values()) {
      subscriptionCount += symbolCache.conidToStrike.size;
      if (symbolCache.chain.underlyingConid) subscriptionCount++;
    }

    return {
      isStreaming: this.isStreaming,
      symbols,
      subscriptionCount,
      wsConnected: this.wsManager?.connected ?? false,
    };
  }

  /**
   * Schedule auto-start at market open (9:30 AM ET)
   */
  scheduleMarketOpenStart(symbol: string = 'SPY'): void {
    // Clear any existing timeout
    if (this.autoStartTimeout) {
      clearTimeout(this.autoStartTimeout);
    }

    const now = new Date();
    const marketOpen = this.getNextMarketOpen(now);
    const msUntilOpen = marketOpen.getTime() - now.getTime();

    if (msUntilOpen <= 0) {
      // Market already open, start now if within trading hours
      if (this.isWithinTradingHours(now)) {
        console.log(`[OptionChainStreamer] Market is open, starting streaming immediately`);
        this.startStreaming(symbol).catch(err => {
          console.error(`[OptionChainStreamer] Auto-start failed:`, err);
        });
      } else {
        console.log(`[OptionChainStreamer] Outside trading hours, scheduling for next open`);
        this.scheduleMarketOpenStart(symbol);
      }
      return;
    }

    console.log(`[OptionChainStreamer] Scheduling auto-start for ${marketOpen.toISOString()} (in ${Math.round(msUntilOpen / 1000 / 60)} minutes)`);

    this.autoStartTimeout = setTimeout(() => {
      console.log(`[OptionChainStreamer] Auto-starting streaming at market open`);
      this.startStreaming(symbol).catch(err => {
        console.error(`[OptionChainStreamer] Auto-start failed:`, err);
      });
    }, msUntilOpen);
  }

  // --- Private methods ---

  private async ensureWebSocketConnected(): Promise<void> {
    if (this.wsManager?.connected) {
      return;
    }

    // Get cookie string from IBKR client
    const cookieString = await getIbkrCookieString();

    // Initialize or get WebSocket manager
    this.wsManager = initIbkrWebSocket(cookieString);

    // Register our update handler
    if (!this.unsubscribeCallback) {
      this.unsubscribeCallback = this.wsManager.onUpdate((update) => {
        this.handleMarketDataUpdate(update);
      });
    }

    // Connect if not connected
    if (!this.wsManager.connected) {
      await this.wsManager.connect();
    }
  }

  private handleMarketDataUpdate(update: MarketDataUpdate): void {
    // Find which symbol this conid belongs to
    for (const [symbol, symbolCache] of this.cache.entries()) {
      // Check if it's the underlying
      if (update.conid === symbolCache.chain.underlyingConid) {
        if (update.last != null) {
          symbolCache.chain.underlyingPrice = update.last;
          symbolCache.chain.lastUpdate = update.timestamp;

          // Broadcast underlying price update to browser clients
          broadcastOptionChainUpdate({
            type: 'underlying_price_update',
            symbol,
            price: update.last,
            timestamp: update.timestamp.toISOString(),
          });
        }
        return;
      }

      // Check if it's an option
      const strikeInfo = symbolCache.conidToStrike.get(update.conid);
      if (strikeInfo) {
        const strikes = strikeInfo.type === 'put'
          ? symbolCache.chain.puts
          : symbolCache.chain.calls;

        const strike = strikes.find(s => s.conid === update.conid);
        if (strike) {
          // Update the strike with new data
          if (update.bid != null) strike.bid = update.bid;
          if (update.ask != null) strike.ask = update.ask;
          if (update.last != null) strike.last = update.last;
          if (update.delta != null) strike.delta = update.delta;
          if (update.gamma != null) strike.gamma = update.gamma;
          if (update.theta != null) strike.theta = update.theta;
          if (update.vega != null) strike.vega = update.vega;
          if (update.iv != null) strike.iv = update.iv;
          if (update.openInterest != null) strike.openInterest = update.openInterest;
          strike.lastUpdate = update.timestamp;

          // Update chain's lastUpdate
          symbolCache.chain.lastUpdate = update.timestamp;

          // Broadcast option chain update to browser clients
          broadcastOptionChainUpdate({
            type: 'option_chain_update',
            symbol,
            data: {
              conid: update.conid,
              strike: strike.strike,
              optionType: strikeInfo.type.toUpperCase(),
              bid: strike.bid,
              ask: strike.ask,
              last: strike.last,
              delta: strike.delta,
              gamma: strike.gamma,
              theta: strike.theta,
              vega: strike.vega,
              iv: strike.iv,
              openInterest: strike.openInterest,
            },
            timestamp: update.timestamp.toISOString(),
          });
        }
        return;
      }
    }
  }

  private initializeCache(
    symbol: string,
    httpChain: Awaited<ReturnType<typeof getOptionChainWithStrikes>>,
    source: 'websocket' | 'http'
  ): void {
    const now = new Date();

    const puts: CachedStrike[] = httpChain.puts
      .filter(p => p.conid != null)
      .map(p => ({
        strike: p.strike,
        conid: p.conid!,
        bid: p.bid,
        ask: p.ask,
        last: p.last,
        delta: p.delta,
        gamma: p.gamma,
        theta: p.theta,
        vega: p.vega,
        iv: p.iv,
        openInterest: p.openInterest,
        lastUpdate: now,
      }));

    const calls: CachedStrike[] = httpChain.calls
      .filter(c => c.conid != null)
      .map(c => ({
        strike: c.strike,
        conid: c.conid!,
        bid: c.bid,
        ask: c.ask,
        last: c.last,
        delta: c.delta,
        gamma: c.gamma,
        theta: c.theta,
        vega: c.vega,
        iv: c.iv,
        openInterest: c.openInterest,
        lastUpdate: now,
      }));

    const chain: CachedOptionChain = {
      symbol,
      underlyingPrice: httpChain.underlyingPrice,
      underlyingConid: 0, // Will be set after resolve
      vix: httpChain.vix,
      expectedMove: httpChain.expectedMove,
      strikeRangeLow: httpChain.strikeRangeLow,
      strikeRangeHigh: httpChain.strikeRangeHigh,
      puts,
      calls,
      dataSource: source,
      lastFullRefresh: now,
      lastUpdate: now,
    };

    this.cache.set(symbol, {
      chain,
      conidToStrike: new Map(),
    });

    console.log(`[OptionChainStreamer] Initialized cache for ${symbol}: ${puts.length} puts, ${calls.length} calls`);
  }

  private async refreshChain(symbol: string): Promise<void> {
    const symbolCache = this.cache.get(symbol);
    if (!symbolCache) return;

    try {
      const httpChain = await getOptionChainWithStrikes(symbol);

      // Update underlying price and VIX
      symbolCache.chain.underlyingPrice = httpChain.underlyingPrice;
      symbolCache.chain.vix = httpChain.vix;
      symbolCache.chain.expectedMove = httpChain.expectedMove;
      symbolCache.chain.strikeRangeLow = httpChain.strikeRangeLow;
      symbolCache.chain.strikeRangeHigh = httpChain.strikeRangeHigh;
      symbolCache.chain.lastFullRefresh = new Date();
      symbolCache.chain.lastUpdate = new Date();

      // TODO: If new strikes come into range, subscribe to them
      // TODO: If strikes go out of range, unsubscribe

      console.log(`[OptionChainStreamer] Refreshed chain for ${symbol}`);
    } catch (error) {
      console.error(`[OptionChainStreamer] Refresh failed for ${symbol}:`, error);
    }
  }

  private getNextMarketOpen(from: Date): Date {
    // Convert to NY time
    const ny = new Date(from.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const dayOfWeek = ny.getDay(); // 0 = Sunday, 6 = Saturday
    const hours = ny.getHours();
    const minutes = ny.getMinutes();
    const currentMinutes = hours * 60 + minutes;
    const marketOpenMinutes = 9 * 60 + 30; // 9:30 AM

    // If it's a weekday before market open, open is today
    if (dayOfWeek >= 1 && dayOfWeek <= 5 && currentMinutes < marketOpenMinutes) {
      const result = new Date(from);
      result.setHours(9, 30, 0, 0);
      // Adjust for timezone
      return this.nyTimeToUtc(ny.getFullYear(), ny.getMonth(), ny.getDate(), 9, 30);
    }

    // Otherwise, find next weekday
    let daysToAdd = 1;
    if (dayOfWeek === 5 && currentMinutes >= marketOpenMinutes) {
      // Friday after open, next is Monday
      daysToAdd = 3;
    } else if (dayOfWeek === 6) {
      // Saturday, next is Monday
      daysToAdd = 2;
    } else if (dayOfWeek === 0) {
      // Sunday, next is Monday
      daysToAdd = 1;
    }

    const nextDay = new Date(from);
    nextDay.setDate(nextDay.getDate() + daysToAdd);

    // Set to 9:30 AM NY time
    const nyNext = new Date(nextDay.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    return this.nyTimeToUtc(nyNext.getFullYear(), nyNext.getMonth(), nyNext.getDate(), 9, 30);
  }

  private nyTimeToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
    // Create a date string and parse it in NY timezone
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
    const nyDate = new Date(dateStr + ' GMT-0500'); // EST, adjust for DST if needed

    // Simple DST check (second Sunday in March to first Sunday in November)
    const isDst = this.isDaylightSavingTime(year, month, day);
    if (isDst) {
      return new Date(dateStr + ' GMT-0400'); // EDT
    }
    return new Date(dateStr + ' GMT-0500'); // EST
  }

  private isDaylightSavingTime(year: number, month: number, day: number): boolean {
    // DST in US: Second Sunday in March to first Sunday in November
    if (month < 2 || month > 10) return false;
    if (month > 2 && month < 10) return true;

    // March - find second Sunday
    if (month === 2) {
      const firstDay = new Date(year, 2, 1).getDay();
      const secondSunday = firstDay === 0 ? 8 : 15 - firstDay;
      return day >= secondSunday;
    }

    // November - find first Sunday
    const firstDay = new Date(year, 10, 1).getDay();
    const firstSunday = firstDay === 0 ? 1 : 8 - firstDay;
    return day < firstSunday;
  }

  private isWithinTradingHours(date: Date): boolean {
    const ny = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const dayOfWeek = ny.getDay();
    const hours = ny.getHours();
    const minutes = ny.getMinutes();
    const currentMinutes = hours * 60 + minutes;

    // Mon-Fri, 9:30 AM - 4:00 PM ET
    const marketOpen = 9 * 60 + 30;
    const marketClose = 16 * 60;

    return (
      dayOfWeek >= 1 &&
      dayOfWeek <= 5 &&
      currentMinutes >= marketOpen &&
      currentMinutes < marketClose
    );
  }
}

// Singleton instance
let streamerInstance: OptionChainStreamer | null = null;

/**
 * Get the singleton OptionChainStreamer instance
 */
export function getOptionChainStreamer(): OptionChainStreamer {
  if (!streamerInstance) {
    streamerInstance = new OptionChainStreamer();
  }
  return streamerInstance;
}

/**
 * Initialize and optionally auto-schedule streaming
 */
export function initOptionChainStreamer(options?: { autoSchedule?: boolean; symbol?: string }): OptionChainStreamer {
  const streamer = getOptionChainStreamer();

  if (options?.autoSchedule) {
    streamer.scheduleMarketOpenStart(options.symbol || 'SPY');
  }

  return streamer;
}
