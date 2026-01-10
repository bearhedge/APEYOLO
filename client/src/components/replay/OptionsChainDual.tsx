// @ts-nocheck
/**
 * Dual-Column Options Chain Component
 *
 * Professional options chain layout:
 * - Puts on the LEFT
 * - Strike in the CENTER
 * - Calls on the RIGHT
 *
 * Like a real trading terminal.
 */

import { useMemo } from 'react';
import { cn } from '@/lib/utils';

interface OptionQuote {
  strike: number;
  right: 'PUT' | 'CALL';
  bid: number;
  ask: number;
  delta: number;
  iv: number;
  volume: number;
  oi: number;
}

interface OptionsChainDualProps {
  options: OptionQuote[];
  spotPrice: number;
  onSelectOption?: (option: OptionQuote) => void;
  selectedStrike?: number;
  selectedRight?: 'PUT' | 'CALL';
}

export function OptionsChainDual({
  options,
  spotPrice,
  onSelectOption,
  selectedStrike,
  selectedRight,
}: OptionsChainDualProps) {
  // Group options by strike
  const { strikes, putsByStrike, callsByStrike, atmStrike } = useMemo(() => {
    const putsByStrike = new Map<number, OptionQuote>();
    const callsByStrike = new Map<number, OptionQuote>();
    const strikeSet = new Set<number>();

    for (const opt of options) {
      strikeSet.add(opt.strike);
      if (opt.right === 'PUT') {
        putsByStrike.set(opt.strike, opt);
      } else {
        callsByStrike.set(opt.strike, opt);
      }
    }

    const strikes = Array.from(strikeSet).sort((a, b) => b - a); // High to low

    // Find ATM strike
    const atmStrike = strikes.reduce((prev, curr) =>
      Math.abs(curr - spotPrice) < Math.abs(prev - spotPrice) ? curr : prev
    , strikes[0]);

    return { strikes, putsByStrike, callsByStrike, atmStrike };
  }, [options, spotPrice]);

  const formatPrice = (price: number | undefined) => {
    if (!price || price === 0) return '-';
    return price.toFixed(2);
  };

  const formatDelta = (delta: number | undefined) => {
    if (delta === undefined) return '-';
    return delta.toFixed(2);
  };

  const formatIV = (iv: number | undefined) => {
    if (!iv) return '-';
    return `${(iv * 100).toFixed(0)}%`;
  };

  const getDeltaColor = (delta: number | undefined) => {
    if (!delta) return 'text-gray-500';
    const absDelta = Math.abs(delta);
    if (absDelta >= 0.4) return 'text-red-400';
    if (absDelta >= 0.25) return 'text-yellow-400';
    return 'text-green-400';
  };

  const handleClick = (option: OptionQuote | undefined) => {
    if (option && onSelectOption) {
      onSelectOption(option);
    }
  };

  return (
    <div className="bg-[#111118] rounded-lg border border-gray-800 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <h3 className="text-sm font-semibold text-white">Options Chain</h3>
        <span className="text-xs text-gray-400">
          Spot: <span className="text-white font-mono">${spotPrice.toFixed(2)}</span>
          <span className="ml-3 text-gray-500">ATM: {atmStrike}</span>
        </span>
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-[1fr_auto_1fr] text-xs text-gray-500 border-b border-gray-800 bg-[#0a0a0f]">
        {/* PUT headers */}
        <div className="grid grid-cols-4 gap-1 px-2 py-2 text-right">
          <span>IV</span>
          <span>Delta</span>
          <span>Bid</span>
          <span>Ask</span>
        </div>

        {/* Strike header */}
        <div className="px-4 py-2 text-center font-medium border-x border-gray-800 bg-[#111118]">
          Strike
        </div>

        {/* CALL headers */}
        <div className="grid grid-cols-4 gap-1 px-2 py-2 text-left">
          <span>Bid</span>
          <span>Ask</span>
          <span>Delta</span>
          <span>IV</span>
        </div>
      </div>

      {/* Options Rows */}
      <div className="max-h-[350px] overflow-y-auto">
        {strikes.map((strike) => {
          const put = putsByStrike.get(strike);
          const call = callsByStrike.get(strike);
          const isATM = strike === atmStrike;
          const isITMPut = strike > spotPrice;
          const isITMCall = strike < spotPrice;
          const isPutSelected = selectedStrike === strike && selectedRight === 'PUT';
          const isCallSelected = selectedStrike === strike && selectedRight === 'CALL';

          return (
            <div
              key={strike}
              className={cn(
                'grid grid-cols-[1fr_auto_1fr] border-b border-gray-800/50',
                isATM && 'bg-yellow-500/5'
              )}
            >
              {/* PUT side */}
              <div
                onClick={() => handleClick(put)}
                className={cn(
                  'grid grid-cols-4 gap-1 px-2 py-2 text-right font-mono text-sm cursor-pointer transition-colors',
                  isPutSelected && 'bg-red-500/20 border-l-2 border-red-500',
                  isITMPut && !isPutSelected && 'bg-red-500/5',
                  !isPutSelected && 'hover:bg-white/5'
                )}
              >
                <span className="text-gray-400">{formatIV(put?.iv)}</span>
                <span className={getDeltaColor(put?.delta)}>{formatDelta(put?.delta)}</span>
                <span className="text-gray-300">{formatPrice(put?.bid)}</span>
                <span className="text-gray-300">{formatPrice(put?.ask)}</span>
              </div>

              {/* Strike */}
              <div
                className={cn(
                  'px-4 py-2 text-center font-mono font-semibold border-x border-gray-800',
                  isATM && 'text-yellow-400 bg-yellow-500/10',
                  !isATM && 'text-white bg-[#111118]'
                )}
              >
                {strike}
              </div>

              {/* CALL side */}
              <div
                onClick={() => handleClick(call)}
                className={cn(
                  'grid grid-cols-4 gap-1 px-2 py-2 text-left font-mono text-sm cursor-pointer transition-colors',
                  isCallSelected && 'bg-green-500/20 border-r-2 border-green-500',
                  isITMCall && !isCallSelected && 'bg-green-500/5',
                  !isCallSelected && 'hover:bg-white/5'
                )}
              >
                <span className="text-gray-300">{formatPrice(call?.bid)}</span>
                <span className="text-gray-300">{formatPrice(call?.ask)}</span>
                <span className={getDeltaColor(call?.delta)}>{formatDelta(call?.delta)}</span>
                <span className="text-gray-400">{formatIV(call?.iv)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="px-4 py-2 border-t border-gray-800 flex items-center justify-between text-xs text-gray-500">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded bg-yellow-400"></span> ATM
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded bg-red-500/50"></span> ITM Put
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded bg-green-500/50"></span> ITM Call
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-green-400">Low Δ</span>
          <span className="text-yellow-400">Mid Δ</span>
          <span className="text-red-400">High Δ</span>
        </div>
      </div>
    </div>
  );
}
