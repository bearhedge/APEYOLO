import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { LeftNav } from '@/components/LeftNav';
import { RefreshCw, TrendingUp, TrendingDown, Activity, Database, Wifi, WifiOff } from 'lucide-react';

// ============================================
// Types
// ============================================

interface ResearchContext {
  spy: { price: number; change: number; changePct: number; dayHigh: number; dayLow: number };
  vix: { level: number; change: number };
  macro: {
    dxy: { price: number; changePct: number } | null;
    tenYear: { yield: number } | null;
  };
  marketStatus: { isOpen: boolean; reason: string };
  timestamp: string;
}

interface NarrativeResult {
  narrative: string;
  context: ResearchContext;
  generatedAt: string;
}

interface DataCaptureStatus {
  status: {
    isRunning: boolean;
    lastCaptureAt: string | null;
    lastCaptureResult: string | null;
    captureCountToday: number;
    completeCount: number;
    partialCount: number;
    snapshotOnlyCount: number;
    wsConnected: boolean;
  } | null;
  streaming: {
    wsConnected: boolean;
    isStreaming: boolean;
    subscriptionCount: number;
  };
  schedulerRunning: boolean;
}

// ============================================
// Component
// ============================================

export function DD() {
  const [narrative, setNarrative] = useState<NarrativeResult | null>(null);

  // Fetch context (auto-refresh every 30s)
  const { data: contextData, isLoading: contextLoading } = useQuery<{ ok: boolean; context: ResearchContext }>({
    queryKey: ['/api/research/context'],
    queryFn: async () => {
      const res = await fetch('/api/research/context', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch context');
      return res.json();
    },
    refetchInterval: 30000,
  });

  // Fetch data capture status
  const { data: captureStatus } = useQuery<{ ok: boolean } & DataCaptureStatus>({
    queryKey: ['/api/data-capture/status'],
    queryFn: async () => {
      const res = await fetch('/api/data-capture/status', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch capture status');
      return res.json();
    },
    refetchInterval: 10000,
  });

  // Generate narrative mutation
  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/research/narrative', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to generate narrative');
      return res.json();
    },
    onSuccess: (data) => setNarrative(data),
  });

  const ctx = contextData?.context;
  const isPriceUp = (ctx?.spy.change || 0) >= 0;
  const status = captureStatus?.status;
  const streaming = captureStatus?.streaming;

  return (
    <div className="flex h-[calc(100vh-64px)]">
      <LeftNav />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold tracking-wide">DD Research</h1>
          <p className="text-silver text-sm mt-1">
            AI-powered market analysis for 0DTE SPY trading
          </p>
        </div>

        {/* Metrics Strip */}
        <div className="bg-charcoal rounded-2xl p-4 border border-white/10">
          <div className="grid grid-cols-4 gap-6">
            {/* SPY */}
            <div>
              <p className="text-silver text-xs uppercase tracking-wide">SPY</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-2xl font-bold tabular-nums">
                  {ctx?.spy.price ? `$${ctx.spy.price.toFixed(2)}` : '---'}
                </span>
                {ctx && ctx.spy.changePct !== 0 && (
                  <span className={`text-sm flex items-center gap-1 ${isPriceUp ? 'text-green-500' : 'text-red-500'}`}>
                    {isPriceUp ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                    {isPriceUp ? '+' : ''}{ctx.spy.changePct.toFixed(2)}%
                  </span>
                )}
              </div>
              {ctx?.spy.dayLow && ctx?.spy.dayHigh && (
                <p className="text-xs text-silver mt-1">
                  Range: ${ctx.spy.dayLow.toFixed(2)} - ${ctx.spy.dayHigh.toFixed(2)}
                </p>
              )}
            </div>

            {/* VIX */}
            <div>
              <p className="text-silver text-xs uppercase tracking-wide">VIX</p>
              <p className="text-2xl font-bold tabular-nums mt-1">
                {ctx?.vix.level ? ctx.vix.level.toFixed(2) : '---'}
              </p>
              {ctx?.vix.change !== 0 && (
                <p className={`text-xs mt-1 ${(ctx?.vix.change || 0) >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {(ctx?.vix.change || 0) >= 0 ? '+' : ''}{(ctx?.vix.change || 0).toFixed(2)}
                </p>
              )}
            </div>

            {/* DXY */}
            <div>
              <p className="text-silver text-xs uppercase tracking-wide">DXY</p>
              <p className="text-2xl font-bold tabular-nums mt-1">
                {ctx?.macro.dxy?.price ? ctx.macro.dxy.price.toFixed(2) : '---'}
              </p>
              {ctx?.macro.dxy?.changePct && (
                <p className={`text-xs mt-1 ${ctx.macro.dxy.changePct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {ctx.macro.dxy.changePct >= 0 ? '+' : ''}{ctx.macro.dxy.changePct.toFixed(2)}%
                </p>
              )}
            </div>

            {/* 10Y Yield */}
            <div>
              <p className="text-silver text-xs uppercase tracking-wide">10Y Yield</p>
              <p className="text-2xl font-bold tabular-nums mt-1">
                {ctx?.macro.tenYear?.yield ? `${ctx.macro.tenYear.yield.toFixed(3)}%` : '---'}
              </p>
            </div>
          </div>

          {/* Market Status */}
          <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${ctx?.marketStatus.isOpen ? 'bg-green-500' : 'bg-yellow-500'}`} />
              <span className="text-sm text-silver">
                {ctx?.marketStatus.isOpen ? 'Market Open' : 'Market Closed'} - {ctx?.marketStatus.reason || 'Loading...'}
              </span>
            </div>
            {ctx?.timestamp && (
              <span className="text-xs text-silver">
                Updated: {new Date(ctx.timestamp).toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>

        {/* Narrative Block */}
        <div className="bg-charcoal rounded-2xl p-6 border border-white/10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Market Analysis</h2>
            <div className="flex items-center gap-3">
              {narrative?.generatedAt && (
                <span className="text-xs text-silver">
                  Generated: {new Date(narrative.generatedAt).toLocaleTimeString()}
                </span>
              )}
              <button
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-white text-black rounded-lg text-sm font-medium hover:bg-gray-100 disabled:opacity-50 transition"
              >
                <RefreshCw className={`w-4 h-4 ${generateMutation.isPending ? 'animate-spin' : ''}`} />
                {generateMutation.isPending ? 'Generating...' : 'Generate Analysis'}
              </button>
            </div>
          </div>

          {narrative?.narrative ? (
            <div className="prose prose-invert max-w-none">
              <p className="text-base leading-relaxed whitespace-pre-wrap text-gray-300">
                {narrative.narrative}
              </p>
            </div>
          ) : (
            <div className="text-center py-12 text-silver">
              <Activity className="w-8 h-8 mx-auto mb-3 opacity-50" />
              <p>Click "Generate Analysis" to get AI-powered market interpretation</p>
            </div>
          )}

          {generateMutation.isError && (
            <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
              Failed to generate narrative. Check LLM configuration.
            </div>
          )}
        </div>

        {/* Data Collection Status */}
        <div className="bg-charcoal/50 rounded-xl p-4 border border-white/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Database className="w-5 h-5 text-silver" />
              <div>
                <p className="text-sm font-medium">Option Data Collection</p>
                <p className="text-xs text-silver">
                  5-minute OHLC snapshots for future backtesting
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              {/* WebSocket Status */}
              <div className={`flex items-center gap-1.5 text-xs ${streaming?.wsConnected ? 'text-green-400' : 'text-yellow-400'}`}>
                {streaming?.wsConnected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
                <span>{streaming?.wsConnected ? 'WS Connected' : 'WS Disconnected'}</span>
              </div>

              {/* Capture Count */}
              {status?.captureCountToday != null && (
                <div className="text-xs text-silver">
                  Today: {status.captureCountToday} captures
                </div>
              )}

              {/* Quality Breakdown */}
              {(status?.completeCount || status?.partialCount || status?.snapshotOnlyCount) && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-green-400">{status?.completeCount || 0} complete</span>
                  <span className="text-yellow-400">{status?.partialCount || 0} partial</span>
                  <span className="text-silver">{status?.snapshotOnlyCount || 0} snapshot</span>
                </div>
              )}

              {/* Scheduler Status */}
              <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs ${
                captureStatus?.schedulerRunning ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${captureStatus?.schedulerRunning ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`} />
                {captureStatus?.schedulerRunning ? 'Running' : 'Stopped'}
              </div>
            </div>
          </div>

          {/* Last Capture Info */}
          {status?.lastCaptureAt && (
            <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between text-xs text-silver">
              <span>
                Last capture: {new Date(status.lastCaptureAt).toLocaleTimeString()}
                {status.lastCaptureResult && ` (${status.lastCaptureResult})`}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
