/**
 * Step1Market - Market Assessment Display
 *
 * Clean market status with hero price display, key metrics,
 * and day range visualization.
 */

import { Button } from '@/components/ui/button';
import { TrendingUp, TrendingDown, Minus, ArrowRight } from 'lucide-react';

interface Step1MarketProps {
  spyPrice: number;
  spyChangePct: number;
  vix: number;
  vwap: number;
  ivRank: number;
  dayLow: number;
  dayHigh: number;
  marketOpen: boolean;
  onAnalyze: () => void;
  isLoading: boolean;
}

export function Step1Market({
  spyPrice,
  spyChangePct,
  vix,
  vwap,
  ivRank,
  dayLow,
  dayHigh,
  marketOpen,
  onAnalyze,
  isLoading,
}: Step1MarketProps) {
  // Calculate position within day range (0-100%)
  const rangePosition = ((spyPrice - dayLow) / (dayHigh - dayLow)) * 100;

  return (
    <div className="space-y-6">
      {/* Market Status Badge */}
      <div className="flex items-center justify-center">
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
      </div>

      {/* Hero Price Display */}
      <div className="text-center">
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
      </div>

      {/* Metrics Row - 3 columns */}
      <div className="grid grid-cols-3 gap-4">
        <div className="p-4 bg-zinc-900/50 rounded-lg border border-zinc-800">
          <p className="text-xs text-zinc-500 mb-1 uppercase tracking-wider">VIX</p>
          <p className="text-2xl font-bold font-mono text-white">{vix.toFixed(2)}</p>
        </div>
        <div className="p-4 bg-zinc-900/50 rounded-lg border border-zinc-800">
          <p className="text-xs text-zinc-500 mb-1 uppercase tracking-wider">VWAP</p>
          <p className="text-2xl font-bold font-mono text-white">${vwap.toFixed(2)}</p>
        </div>
        <div className="p-4 bg-zinc-900/50 rounded-lg border border-zinc-800">
          <p className="text-xs text-zinc-500 mb-1 uppercase tracking-wider">IV Rank</p>
          <p className="text-2xl font-bold font-mono text-white">{ivRank.toFixed(0)}%</p>
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

      {/* CTA */}
      <Button
        onClick={onAnalyze}
        disabled={isLoading || !marketOpen}
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
            Analyze Direction
            <ArrowRight className="w-5 h-5" />
          </>
        )}
      </Button>
    </div>
  );
}
