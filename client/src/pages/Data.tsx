import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LeftNav } from '@/components/LeftNav';
import { EngineBoundsChart } from '@/components/EngineBoundsChart';
import { useWebSocket } from '@/hooks/use-websocket';
import { Search, RefreshCw, TrendingUp, TrendingDown, Activity, ChevronDown, Calendar, Wifi, WifiOff } from 'lucide-react';
import toast from 'react-hot-toast';

// Check if US market is currently open (9:30 AM - 4:00 PM ET, Mon-Fri)
function isUSMarketOpen(): boolean {
  const now = new Date();
  const nyTime = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(now);

  const [hour, minute] = nyTime.split(':').map(Number);
  const currentMinutes = hour * 60 + minute;
  const marketOpen = 9 * 60 + 30;  // 9:30 AM
  const marketClose = 16 * 60;      // 4:00 PM

  const nyDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const dayOfWeek = nyDate.getDay();
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

  return isWeekday && currentMinutes >= marketOpen && currentMinutes < marketClose;
}

interface OptionStrike {
  strike: number;
  bid: number;
  ask: number;
  delta: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  iv?: number;
  oi?: number;
  openInterest?: number;
  optionType: 'PUT' | 'CALL';
}

// WebSocket message types for real-time updates
interface OptionChainUpdateMessage {
  type: 'option_chain_update';
  symbol: string;
  data: {
    conid: number;
    strike: number;
    optionType: 'PUT' | 'CALL';
    bid?: number;
    ask?: number;
    last?: number;
    delta?: number;
    gamma?: number;
    theta?: number;
    vega?: number;
    iv?: number;
    openInterest?: number;
  };
  timestamp: string;
}

interface UnderlyingPriceUpdateMessage {
  type: 'underlying_price_update';
  symbol: string;
  price: number;
  timestamp: string;
}

interface StreamStatus {
  isStreaming: boolean;
  symbols: string[];
  subscriptionCount: number;
  lastUpdate?: string;
  cacheSize?: number;
}

interface CachedChain {
  cached: boolean;
  symbol: string;
  puts: OptionStrike[];
  calls: OptionStrike[];
  underlyingPrice: number;
  lastUpdate: string;
  expirations?: string[];
  isHistorical?: boolean;
}

interface MarketData {
  price: number;
  change: number;
  changePct: number;
  volume?: number;
  high?: number;
  low?: number;
  open?: number;
}

// Historical bar for fallback price
interface HistoricalBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

interface HistoryResponse {
  symbol: string;
  data: HistoricalBar[];
}

export function Data() {
  const queryClient = useQueryClient();
  const [searchTicker, setSearchTicker] = useState('');
  const [activeTicker, setActiveTicker] = useState('SPY');
  const [selectedExpiration, setSelectedExpiration] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // WebSocket connection for real-time updates
  const { isConnected: wsConnected, lastMessage } = useWebSocket();

  // Local state for WebSocket-driven option chain updates
  const [liveOptionChain, setLiveOptionChain] = useState<CachedChain | null>(null);
  const [liveUnderlyingPrice, setLiveUnderlyingPrice] = useState<number | null>(null);
  const [wsUpdateCount, setWsUpdateCount] = useState(0);

  // Note: DeterministicChart handles its own data fetching from IBKR

  // ========================================
  // useQuery hooks MUST come before useEffects that depend on them
  // (JavaScript temporal dead zone - can't access const before declaration)
  // ========================================

  // Fetch streaming status
  const { data: streamStatus } = useQuery<StreamStatus>({
    queryKey: ['/api/broker/stream/status'],
    queryFn: async () => {
      const res = await fetch('/api/broker/stream/status', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch stream status');
      return res.json();
    },
    refetchInterval: 5000,
  });

  // Fetch cached option chain
  const { data: optionChain, isLoading: chainLoading, refetch: refetchChain } = useQuery<CachedChain>({
    queryKey: ['/api/broker/stream/chain', activeTicker],
    queryFn: async () => {
      const res = await fetch(`/api/broker/stream/chain/${activeTicker}`, { credentials: 'include' });
      if (!res.ok) {
        // Fall back to test-options endpoint
        const fallback = await fetch(`/api/broker/test-options/${activeTicker}`, { credentials: 'include' });
        if (!fallback.ok) throw new Error('Failed to fetch option chain');
        const data = await fallback.json();
        return {
          cached: false,
          symbol: activeTicker,
          puts: data.puts || [],
          calls: data.calls || [],
          underlyingPrice: data.underlyingPrice || 0,
          lastUpdate: new Date().toISOString(),
          expirations: data.expirations || []
        };
      }
      return res.json();
    },
    // Only poll as fallback - WebSocket provides instant updates
    // Use 30s when WebSocket connected, 10s otherwise
    refetchInterval: wsConnected && streamStatus?.isStreaming ? 30000 : 10000,
    enabled: !!activeTicker,
  });

  // Fetch market data for the ticker
  const { data: marketData, isLoading: marketLoading } = useQuery<MarketData>({
    queryKey: ['/api/broker/test-market', activeTicker],
    queryFn: async () => {
      const res = await fetch(`/api/broker/test-market/${activeTicker}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch market data');
      const data = await res.json();
      return {
        price: data.price || 0,
        change: data.change || 0,
        changePct: data.changePct || 0,
        volume: data.volume,
        high: data.high,
        low: data.low,
        open: data.open,
      };
    },
    refetchInterval: 5000,
    enabled: !!activeTicker,
  });

  // Fetch historical data for fallback price when market is closed
  // This gives us the last close price when IBKR returns 0
  const { data: historicalData } = useQuery<HistoryResponse>({
    queryKey: ['/api/market/history', activeTicker, '1D'],
    queryFn: async () => {
      const res = await fetch(`/api/market/history/${activeTicker}?range=1D&interval=5m`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch historical data');
      return res.json();
    },
    staleTime: 60000, // Consider data stale after 1 minute
    enabled: !!activeTicker,
  });

  // ========================================
  // useEffect hooks (can now reference queries declared above)
  // ========================================

  // Handle WebSocket messages for real-time updates
  useEffect(() => {
    if (!lastMessage) return;

    // Handle option chain updates
    if (lastMessage.type === 'option_chain_update') {
      const msg = lastMessage as unknown as OptionChainUpdateMessage;
      if (msg.symbol !== activeTicker) return;

      setLiveOptionChain(prev => {
        if (!prev) return prev;

        const optionType = msg.data.optionType;
        const targetArray = optionType === 'PUT' ? 'puts' : 'calls';

        // Find and update the specific strike
        const updatedArray = prev[targetArray].map(opt => {
          if (opt.strike === msg.data.strike) {
            return {
              ...opt,
              bid: msg.data.bid ?? opt.bid,
              ask: msg.data.ask ?? opt.ask,
              delta: msg.data.delta ?? opt.delta,
              gamma: msg.data.gamma ?? opt.gamma,
              theta: msg.data.theta ?? opt.theta,
              vega: msg.data.vega ?? opt.vega,
              iv: msg.data.iv ?? opt.iv,
              oi: msg.data.openInterest ?? opt.oi,
            };
          }
          return opt;
        });

        setWsUpdateCount(c => c + 1);

        return {
          ...prev,
          [targetArray]: updatedArray,
          lastUpdate: msg.timestamp,
        };
      });
    }

    // Handle underlying price updates
    if (lastMessage.type === 'underlying_price_update') {
      const msg = lastMessage as unknown as UnderlyingPriceUpdateMessage;
      if (msg.symbol !== activeTicker) return;

      // Validate price before accepting
      const price = msg.price;
      if (typeof price !== 'number' || !isFinite(price) || price <= 0) {
        console.warn('[Data.tsx] dropped invalid price update', msg);
        return;
      }

      setLiveUnderlyingPrice(price);
      setWsUpdateCount(c => c + 1);

      // Push price update to candlestick chart for live candle updates
      if (chartRef.current && msg.timestamp) {
        const parsedTime = new Date(msg.timestamp).getTime();
        if (isNaN(parsedTime)) {
          console.warn('[Data.tsx] dropped tick with invalid timestamp', msg.timestamp);
          return;
        }
        // Convert to Unix seconds
        const timestamp = Math.floor(parsedTime / 1000);
        chartRef.current.updateWithTick(price, timestamp);
      }
    }
  }, [lastMessage, activeTicker]);

  // Sync live option chain when HTTP data arrives
  useEffect(() => {
    if (optionChain && optionChain.cached) {
      // Convert HTTP response to match our local state structure
      const chainData: CachedChain = {
        ...optionChain,
        puts: optionChain.puts || [],
        calls: optionChain.calls || [],
      };
      setLiveOptionChain(chainData);
      if (optionChain.underlyingPrice) {
        setLiveUnderlyingPrice(optionChain.underlyingPrice);
      }
    }
  }, [optionChain]);

  // Start streaming mutation
  const startStreamMutation = useMutation({
    mutationFn: async (symbol: string) => {
      const res = await fetch('/api/broker/stream/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ symbol }),
      });
      if (!res.ok) throw new Error('Failed to start streaming');
      return res.json();
    },
    onSuccess: () => {
      toast.success(`Started streaming ${activeTicker}`);
      queryClient.invalidateQueries({ queryKey: ['/api/broker/stream/status'] });
    },
    onError: (err) => {
      toast.error(`Failed to start streaming: ${err.message}`);
    },
  });

  // Handle ticker search
  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (searchTicker.trim()) {
      const ticker = searchTicker.trim().toUpperCase();
      setActiveTicker(ticker);
      setSearchTicker('');
      // Start streaming for the new ticker
      startStreamMutation.mutate(ticker);
    }
  }, [searchTicker, startStreamMutation]);

  // Handle manual refresh
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await refetchChain();
      toast.success('Data refreshed');
    } catch {
      toast.error('Failed to refresh');
    } finally {
      setIsRefreshing(false);
    }
  }, [refetchChain]);

  const isPriceUp = (marketData?.change || 0) >= 0;

  // Get last close from historical data for fallback when market is closed
  const lastClosePrice = historicalData?.data?.length
    ? historicalData.data[historicalData.data.length - 1].close
    : null;

  // Determine if market is closed using actual market hours (not price-based)
  const ibkrPrice = marketData?.price || 0;
  const isMarketClosed = !isUSMarketOpen();

  // Display price: use IBKR price if valid, otherwise fallback to last close
  const displayPrice = ibkrPrice > 0 ? ibkrPrice : (lastClosePrice || 0);

  // Use live WebSocket data when available, fallback to HTTP
  const underlyingPrice = liveUnderlyingPrice || optionChain?.underlyingPrice || marketData?.price || 0;
  const displayChain = liveOptionChain || optionChain;

  // Sort options by strike - use live chain when available
  const sortedPuts = [...(displayChain?.puts || [])].sort((a, b) => b.strike - a.strike);
  const sortedCalls = [...(displayChain?.calls || [])].sort((a, b) => a.strike - b.strike);

  // Determine if we're getting real-time WebSocket updates
  const isLiveStreaming = wsConnected && streamStatus?.isStreaming && streamStatus.symbols.includes(activeTicker);

  return (
    <div className="flex h-[calc(100vh-64px)]">
      <LeftNav />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Page Header with Search */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-wide">Data</h1>
            <p className="text-silver text-sm mt-1">
              Real-time market data and option chains
            </p>
          </div>

          {/* Search Form */}
          <form onSubmit={handleSearch} className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-silver" />
              <input
                type="text"
                value={searchTicker}
                onChange={(e) => setSearchTicker(e.target.value.toUpperCase())}
                placeholder="Search ticker..."
                className="pl-10 pr-4 py-2 bg-charcoal border border-white/10 rounded-lg text-sm w-40 focus:outline-none focus:border-white/30"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 bg-white text-black rounded-lg text-sm font-medium hover:bg-gray-100 transition"
            >
              Search
            </button>
          </form>
        </div>

        {/* Stock Chart Panel */}
        <div className="bg-charcoal rounded-2xl p-6 border border-white/10 shadow-lg">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <h2 className="text-2xl font-bold">{activeTicker}</h2>
              {!marketLoading && (displayPrice > 0 || marketData) && (
                <div className="flex items-center gap-3">
                  <span className={`text-3xl font-bold tabular-nums ${isMarketClosed ? 'text-silver' : ''}`}>
                    ${displayPrice.toFixed(2)}
                  </span>
                  {isMarketClosed ? (
                    <div className="flex items-center gap-2 text-yellow-500">
                      <span className="text-sm font-medium px-2 py-1 bg-yellow-500/20 rounded">
                        Market Closed
                      </span>
                      <span className="text-xs text-silver">Last Close</span>
                    </div>
                  ) : (
                    <div className={`flex items-center gap-1 ${isPriceUp ? 'text-green-500' : 'text-red-500'}`}>
                      {isPriceUp ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                      <span className="font-medium tabular-nums">
                        {isPriceUp ? '+' : ''}{(marketData?.change || 0).toFixed(2)} ({isPriceUp ? '+' : ''}{(marketData?.changePct || 0).toFixed(2)}%)
                      </span>
                    </div>
                  )}
                </div>
              )}
              {marketLoading && (
                <div className="flex items-center gap-2 text-silver">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Loading...</span>
                </div>
              )}
            </div>

            {/* Stream Status - Show WebSocket connection status */}
            <div className="flex items-center gap-4">
              {/* WebSocket Connection Status */}
              <div className={`flex items-center gap-2 text-sm ${wsConnected ? 'text-green-500' : 'text-yellow-500'}`}>
                {wsConnected ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
                <span>{wsConnected ? 'WS Connected' : 'WS Disconnected'}</span>
              </div>

              {/* Live Streaming Status */}
              {isLiveStreaming && (
                <div className="flex items-center gap-2 text-green-500 text-sm">
                  <Activity className="w-4 h-4 animate-pulse" />
                  <span>Live ({wsUpdateCount} updates)</span>
                </div>
              )}
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="flex items-center gap-2 px-3 py-1.5 border border-white/10 rounded-lg text-sm hover:bg-white/5 transition"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>

          {/* Engine Bounds Chart with PUT/CALL strike visualization */}
          {/* Responsive container - EngineBoundsChart uses ResizeObserver internally */}
          <div className="mt-4 w-full">
            <EngineBoundsChart
              symbol={activeTicker}
              defaultRange="1D"
              height={550}
              className="w-full"
            />
          </div>

          {/* Market Stats */}
          {marketData && (
            <div className="mt-4 grid grid-cols-4 gap-4 text-sm">
              {marketData.open && (
                <div>
                  <p className="text-silver">Open</p>
                  <p className="font-mono">${marketData.open.toFixed(2)}</p>
                </div>
              )}
              {marketData.high && (
                <div>
                  <p className="text-silver">High</p>
                  <p className="font-mono">${marketData.high.toFixed(2)}</p>
                </div>
              )}
              {marketData.low && (
                <div>
                  <p className="text-silver">Low</p>
                  <p className="font-mono">${marketData.low.toFixed(2)}</p>
                </div>
              )}
              {marketData.volume && (
                <div>
                  <p className="text-silver">Volume</p>
                  <p className="font-mono">{(marketData.volume / 1000000).toFixed(2)}M</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Option Chain Panel */}
        <div className="bg-charcoal rounded-2xl p-6 border border-white/10 shadow-lg">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <h3 className="text-lg font-semibold">Option Chain</h3>
              <span className="text-silver text-sm">
                {activeTicker} @ ${underlyingPrice.toFixed(2)}
              </span>
            </div>

            <div className="flex items-center gap-4">
              {/* Expiration Selector */}
              {optionChain?.expirations && optionChain.expirations.length > 0 && (
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-silver" />
                  <select
                    value={selectedExpiration || ''}
                    onChange={(e) => setSelectedExpiration(e.target.value || null)}
                    className="bg-charcoal border border-white/10 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-white/30"
                  >
                    <option value="">0DTE</option>
                    {optionChain.expirations.map((exp) => (
                      <option key={exp} value={exp}>{exp}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Data Source Indicator */}
              <div className={`text-xs px-2 py-1 rounded ${
                displayChain?.isHistorical
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : isLiveStreaming
                    ? 'bg-green-500/30 text-green-400 border border-green-500/50'
                    : displayChain?.cached
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-yellow-500/20 text-yellow-400'
              }`}>
                {displayChain?.isHistorical
                  ? '📜 Last Traded (Market Closed)'
                  : isLiveStreaming
                    ? '⚡ Live WebSocket'
                    : displayChain?.cached
                      ? 'WebSocket Cache'
                      : 'HTTP Snapshot'}
              </div>

              {/* Last Update */}
              {displayChain?.lastUpdate && (
                <span className="text-xs text-silver">
                  Updated: {new Date(displayChain.lastUpdate).toLocaleTimeString()}
                </span>
              )}
            </div>
          </div>

          {chainLoading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-6 h-6 animate-spin text-silver" />
              <span className="ml-2 text-silver">Loading option chain...</span>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-6">
              {/* PUTS Table */}
              <div>
                <h4 className="text-sm font-medium text-silver mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500"></span>
                  PUTS
                </h4>
                <div className="overflow-auto max-h-96 rounded-lg border border-white/10">
                  <table className="w-full text-sm">
                    <thead className="bg-white/5 sticky top-0">
                      <tr className="text-left text-silver">
                        <th className="px-3 py-2 font-medium">Strike</th>
                        <th className="px-3 py-2 font-medium text-right">Bid</th>
                        <th className="px-3 py-2 font-medium text-right">Ask</th>
                        <th className="px-3 py-2 font-medium text-right">Delta</th>
                        <th className="px-3 py-2 font-medium text-right">IV</th>
                        <th className="px-3 py-2 font-medium text-right">OI</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {sortedPuts.length > 0 ? sortedPuts.map((option) => {
                        const isITM = option.strike > underlyingPrice;
                        const isATM = Math.abs(option.strike - underlyingPrice) < 1;
                        return (
                          <tr
                            key={option.strike}
                            className={`
                              ${isATM ? 'bg-yellow-500/10' : ''}
                              ${isITM ? 'bg-red-500/5' : ''}
                              hover:bg-white/5 transition
                            `}
                          >
                            <td className="px-3 py-2 font-medium">${option.strike}</td>
                            <td className="px-3 py-2 text-right font-mono">{option.bid?.toFixed(2) || '-'}</td>
                            <td className="px-3 py-2 text-right font-mono">{option.ask?.toFixed(2) || '-'}</td>
                            <td className="px-3 py-2 text-right font-mono text-red-400">
                              {option.delta ? (-Math.abs(option.delta)).toFixed(2) : '-'}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-silver">
                              {option.iv ? `${(option.iv * 100).toFixed(0)}%` : '-'}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-silver">
                              {option.oi?.toLocaleString() || '-'}
                            </td>
                          </tr>
                        );
                      }) : (
                        <tr>
                          <td colSpan={6} className="px-3 py-8 text-center text-silver">
                            No put data available
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* CALLS Table */}
              <div>
                <h4 className="text-sm font-medium text-silver mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500"></span>
                  CALLS
                </h4>
                <div className="overflow-auto max-h-96 rounded-lg border border-white/10">
                  <table className="w-full text-sm">
                    <thead className="bg-white/5 sticky top-0">
                      <tr className="text-left text-silver">
                        <th className="px-3 py-2 font-medium">Strike</th>
                        <th className="px-3 py-2 font-medium text-right">Bid</th>
                        <th className="px-3 py-2 font-medium text-right">Ask</th>
                        <th className="px-3 py-2 font-medium text-right">Delta</th>
                        <th className="px-3 py-2 font-medium text-right">IV</th>
                        <th className="px-3 py-2 font-medium text-right">OI</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {sortedCalls.length > 0 ? sortedCalls.map((option) => {
                        const isITM = option.strike < underlyingPrice;
                        const isATM = Math.abs(option.strike - underlyingPrice) < 1;
                        return (
                          <tr
                            key={option.strike}
                            className={`
                              ${isATM ? 'bg-yellow-500/10' : ''}
                              ${isITM ? 'bg-green-500/5' : ''}
                              hover:bg-white/5 transition
                            `}
                          >
                            <td className="px-3 py-2 font-medium">${option.strike}</td>
                            <td className="px-3 py-2 text-right font-mono">{option.bid?.toFixed(2) || '-'}</td>
                            <td className="px-3 py-2 text-right font-mono">{option.ask?.toFixed(2) || '-'}</td>
                            <td className="px-3 py-2 text-right font-mono text-green-400">
                              {option.delta?.toFixed(2) || '-'}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-silver">
                              {option.iv ? `${(option.iv * 100).toFixed(0)}%` : '-'}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-silver">
                              {option.oi?.toLocaleString() || '-'}
                            </td>
                          </tr>
                        );
                      }) : (
                        <tr>
                          <td colSpan={6} className="px-3 py-8 text-center text-silver">
                            No call data available
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Legend */}
          <div className="mt-4 flex items-center gap-6 text-xs text-silver">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-yellow-500/10 border border-yellow-500/20 rounded"></span>
              <span>ATM (At The Money)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-red-500/5 border border-red-500/10 rounded"></span>
              <span>ITM Puts</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 bg-green-500/5 border border-green-500/10 rounded"></span>
              <span>ITM Calls</span>
            </div>
          </div>
        </div>

        {/* Stream Control */}
        {!streamStatus?.isStreaming && (
          <div className="bg-charcoal rounded-2xl p-6 border border-white/10 shadow-lg">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold mb-1">WebSocket Streaming</h3>
                <p className="text-sm text-silver">
                  Enable real-time updates for faster data and lower latency
                </p>
              </div>
              <button
                onClick={() => startStreamMutation.mutate(activeTicker)}
                disabled={startStreamMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-white text-black rounded-lg font-medium hover:bg-gray-100 disabled:opacity-50 transition"
              >
                {startStreamMutation.isPending ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Starting...
                  </>
                ) : (
                  <>
                    <Activity className="w-4 h-4" />
                    Start Streaming
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
