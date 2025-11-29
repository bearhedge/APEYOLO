import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LeftNav } from '@/components/LeftNav';
import { MiniChart } from '@/components/MiniChart';
import { Search, RefreshCw, TrendingUp, TrendingDown, Activity, ChevronDown, Calendar } from 'lucide-react';
import toast from 'react-hot-toast';

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
  optionType: 'PUT' | 'CALL';
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

export function Data() {
  const queryClient = useQueryClient();
  const [searchTicker, setSearchTicker] = useState('');
  const [activeTicker, setActiveTicker] = useState('SPY');
  const [selectedExpiration, setSelectedExpiration] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

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
          puts: data.optionChain?.filter((o: any) => o.optionType === 'PUT') || [],
          calls: data.optionChain?.filter((o: any) => o.optionType === 'CALL') || [],
          underlyingPrice: data.spotPrice || 0,
          lastUpdate: new Date().toISOString(),
          expirations: data.expirations || []
        };
      }
      return res.json();
    },
    refetchInterval: streamStatus?.isStreaming ? 2000 : 10000,
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

  // Generate mock sparkline data based on price
  const generateSparklineData = (basePrice: number): number[] => {
    const points = [];
    let price = basePrice * 0.998;
    for (let i = 0; i < 20; i++) {
      price = price + (Math.random() - 0.5) * (basePrice * 0.002);
      points.push(price);
    }
    points.push(basePrice);
    return points;
  };

  const sparklineData = marketData?.price ? generateSparklineData(marketData.price) : [];
  const isPriceUp = (marketData?.change || 0) >= 0;
  const underlyingPrice = optionChain?.underlyingPrice || marketData?.price || 0;

  // Sort options by strike
  const sortedPuts = [...(optionChain?.puts || [])].sort((a, b) => b.strike - a.strike);
  const sortedCalls = [...(optionChain?.calls || [])].sort((a, b) => a.strike - b.strike);

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
              {!marketLoading && marketData && (
                <div className="flex items-center gap-3">
                  <span className="text-3xl font-bold tabular-nums">
                    ${marketData.price.toFixed(2)}
                  </span>
                  <div className={`flex items-center gap-1 ${isPriceUp ? 'text-green-500' : 'text-red-500'}`}>
                    {isPriceUp ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                    <span className="font-medium tabular-nums">
                      {isPriceUp ? '+' : ''}{marketData.change.toFixed(2)} ({isPriceUp ? '+' : ''}{marketData.changePct.toFixed(2)}%)
                    </span>
                  </div>
                </div>
              )}
              {marketLoading && (
                <div className="flex items-center gap-2 text-silver">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Loading...</span>
                </div>
              )}
            </div>

            {/* Stream Status */}
            <div className="flex items-center gap-4">
              {streamStatus?.isStreaming && streamStatus.symbols.includes(activeTicker) && (
                <div className="flex items-center gap-2 text-green-500 text-sm">
                  <Activity className="w-4 h-4 animate-pulse" />
                  <span>Live</span>
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

          {/* Sparkline Chart */}
          {sparklineData.length > 0 && (
            <div className="h-32 flex items-center justify-center">
              <MiniChart
                data={sparklineData}
                width={800}
                height={120}
                color={isPriceUp ? '#10B981' : '#EF4444'}
                testId="stock-chart"
              />
            </div>
          )}

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
              <div className={`text-xs px-2 py-1 rounded ${optionChain?.cached ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                {optionChain?.cached ? 'WebSocket Cache' : 'HTTP Snapshot'}
              </div>

              {/* Last Update */}
              {optionChain?.lastUpdate && (
                <span className="text-xs text-silver">
                  Updated: {new Date(optionChain.lastUpdate).toLocaleTimeString()}
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
