/**
 * Step1Market - Market Assessment Display
 *
 * Clean market status with hero price display, key metrics,
 * and day range visualization.
 */

import { Button } from '@/components/ui/button';
import { TrendingUp, TrendingDown, Minus, ArrowRight } from 'lucide-react';
import type { StrategyPreference } from '@shared/types/engine';

interface Step1MarketProps {
  spyPrice: number;
  spyChangePct: number;
  vix: number;
  vixChangePct: number;
  vwap: number | null;
  ivRank: number | null;
  dayLow: number;
  dayHigh: number;
  marketOpen: boolean;
  source: 'ibkr' | 'ibkr-sse' | 'yahoo' | 'none';
  timestamp: string | null;
  strategy: StrategyPreference;
  onStrategyChange: (strategy: StrategyPreference) => void;
  onAnalyze: () => void;
  isLoading: boolean;
}

export function Step1Market({
  spyPrice,
  spyChangePct,
  vix,
  vixChangePct,
  vwap,
  ivRank,
  dayLow,
  dayHigh,
  marketOpen,
  source,
  timestamp,
  strategy,
  onStrategyChange,
  onAnalyze,
  isLoading,
}: Step1MarketProps) {
  // Calculate position within day range (0-100%)
  const range = dayHigh - dayLow;
  const rangePosition = range > 0 ? ((spyPrice - dayLow) / range) * 100 : 50;

  return (
    <div className="space-y-6">
      {/* Market Status Badge + Source Indicator */}
      <div className="flex items-center justify-center gap-2">
        <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border ${
          marketOpen
            ? 'bg-green-500/10 border-green-500/30 text-green-400'
            : 'bg-zinc-500/10 border-zinc-500/30 text-zinc-400'
        }`}>
          <div className={`w-2 h-2 rounded-full ${marketOpen ? 'bg-green-500 animate-pulse' : 'bg-zinc-500'}`} />
          <span className="text-sm font-medium uppercase tracking-wider">
            {marketOpen ? 'Market Open' : 'Market Closed'}
          </span>
        </div>
        {/* Source Badge */}
        <div className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium uppercase tracking-wider ${
          source === 'ibkr' || source === 'ibkr-sse'
            ? 'bg-green-500/20 text-green-400 border border-green-500/30'
            : source === 'yahoo'
            ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
            : 'bg-red-500/20 text-red-400 border border-red-500/30'
        }`}>
          {source === 'ibkr' || source === 'ibkr-sse' ? 'LIVE' : source === 'yahoo' ? 'YAHOO' : 'NO DATA'}
        </div>
      </div>

      {/* Hero Price Display */}
      <div className="text-center">
        {spyPrice > 0 ? (
          <>
            <div className="flex items-center justify-center gap-3 mb-2">
              <span className="text-5xl font-bold font-mono">${spyPrice.toFixed(2)}</span>
              <div className={`flex items-center gap-1 text-2xl font-semibold ${
                spyChangePct >= 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                {spyChangePct >= 0 ? <TrendingUp className="w-6 h-6" /> : <TrendingDown className="w-6 h-6" />}
                <span className="font-mono">{spyChangePct >= 0 ? '+' : ''}{spyChangePct.toFixed(2)}%</span>
              </div>
            </div>
            <p className="text-sm text-zinc-400 uppercase tracking-wider">SPY Price</p>
          </>
        ) : (
          <>
            <div className="text-5xl font-bold font-mono text-zinc-600 mb-2">—</div>
            <p className="text-sm text-red-400 uppercase tracking-wider">No Price Data Available</p>
          </>
        )}
      </div>

      {/* Metrics Row - 3 columns */}
      <div className="grid grid-cols-3 gap-4">
        <div className="p-4 bg-zinc-900/50 rounded-lg border border-zinc-800">
          <p className="text-xs text-zinc-500 mb-1 uppercase tracking-wider">VIX</p>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white">{vix.toFixed(2)}</span>
            {vixChangePct !== 0 && (
              <span className={`text-sm font-mono ${vixChangePct >= 0 ? 'text-red-400' : 'text-green-400'}`}>
                {vixChangePct >= 0 ? '+' : ''}{vixChangePct.toFixed(1)}%
              </span>
            )}
          </div>
        </div>
        <div className="p-4 bg-zinc-900/50 rounded-lg border border-zinc-800">
          <p className="text-xs text-zinc-500 mb-1 uppercase tracking-wider">VWAP</p>
          <p className="text-2xl font-bold font-mono text-white">
            {vwap !== null ? `$${vwap.toFixed(2)}` : '—'}
          </p>
        </div>
        <div className="p-4 bg-zinc-900/50 rounded-lg border border-zinc-800">
          <p className="text-xs text-zinc-500 mb-1 uppercase tracking-wider">IV Rank</p>
          <p className="text-2xl font-bold font-mono text-white">
            {ivRank !== null ? `${ivRank.toFixed(0)}%` : '—'}
          </p>
        </div>
      </div>

      {/* Day Range Bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm text-zinc-400">
          <span className="font-mono">${dayLow.toFixed(2)}</span>
          <span className="text-xs uppercase tracking-wider">Day Range</span>
          <span className="font-mono">${dayHigh.toFixed(2)}</span>
        </div>
        <div className="relative h-3 bg-zinc-900 rounded-full border border-zinc-800 overflow-hidden">
          {/* Range gradient */}
          <div className="absolute inset-0 bg-gradient-to-r from-red-500/20 via-zinc-700/20 to-green-500/20" />
          {/* Current position indicator */}
          <div
            className="absolute top-0 bottom-0 w-1 bg-blue-500 shadow-lg shadow-blue-500/50"
            style={{ left: `${rangePosition}%` }}
          />
        </div>
        <div className="text-center">
          <span className="text-xs text-zinc-500">
            {rangePosition < 33 ? 'Lower Third' : rangePosition < 67 ? 'Middle Third' : 'Upper Third'}
          </span>
        </div>
      </div>

      {/* Strategy Selection */}
      <div className="space-y-2">
        <p className="text-xs text-zinc-500 uppercase tracking-wider text-center">Strategy</p>
        <div className="flex gap-2">
          <button
            onClick={() => onStrategyChange('strangle')}
            className={`flex-1 py-3 px-4 rounded-lg border text-sm font-medium transition ${
              strategy === 'strangle'
                ? 'bg-blue-500/20 border-blue-500 text-blue-400'
                : 'bg-zinc-900/50 border-zinc-700 text-zinc-400 hover:border-zinc-600'
            }`}
          >
            Strangle
          </button>
          <button
            onClick={() => onStrategyChange('put-only')}
            className={`flex-1 py-3 px-4 rounded-lg border text-sm font-medium transition ${
              strategy === 'put-only'
                ? 'bg-red-500/20 border-red-500 text-red-400'
                : 'bg-zinc-900/50 border-zinc-700 text-zinc-400 hover:border-zinc-600'
            }`}
          >
            Put
          </button>
          <button
            onClick={() => onStrategyChange('call-only')}
            className={`flex-1 py-3 px-4 rounded-lg border text-sm font-medium transition ${
              strategy === 'call-only'
                ? 'bg-green-500/20 border-green-500 text-green-400'
                : 'bg-zinc-900/50 border-zinc-700 text-zinc-400 hover:border-zinc-600'
            }`}
          >
            Call
          </button>
        </div>
      </div>

      {/* CTA - Always enabled (market closed just shows warning) */}
      <Button
        onClick={onAnalyze}
        disabled={isLoading}
        className="w-full py-6 text-base"
        size="lg"
      >
        {isLoading ? (
          <>
            <Minus className="w-5 h-5 animate-spin" />
            Analyzing...
          </>
        ) : (
          <>
            Run Engine
            <ArrowRight className="w-5 h-5" />
          </>
        )}
      </Button>
      {!marketOpen && (
        <p className="text-xs text-amber-400 text-center mt-2">
          Market is closed. Results may use cached/delayed data.
        </p>
      )}

      {/* Timestamp */}
      {timestamp && (
        <p className="text-xs text-zinc-500 text-center">
          Last updated: {new Date(timestamp).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZone: 'America/New_York'
          })} ET
        </p>
      )}
    </div>
  );
}
