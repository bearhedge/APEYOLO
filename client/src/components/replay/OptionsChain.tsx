// @ts-nocheck
/**
 * Options Chain Component
 *
 * Displays options strikes with bid, ask, delta, IV, volume.
 * Designed for quick scanning and selection.
 */

import { useState, useMemo } from 'react';
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

interface OptionsChainProps {
  options: OptionQuote[];
  spotPrice: number;
  onSelectOption?: (option: OptionQuote) => void;
  selectedStrike?: number;
  selectedRight?: 'PUT' | 'CALL';
}

export function OptionsChain({
  options,
  spotPrice,
  onSelectOption,
  selectedStrike,
  selectedRight,
}: OptionsChainProps) {
  const [showPuts, setShowPuts] = useState(true);
  const [showCalls, setShowCalls] = useState(true);

  // Separate and sort options
  const { puts, calls, atmStrike } = useMemo(() => {
    const puts = options
      .filter(o => o.right === 'PUT')
      .sort((a, b) => b.strike - a.strike);
    const calls = options
      .filter(o => o.right === 'CALL')
      .sort((a, b) => a.strike - b.strike);

    // Find ATM strike (closest to spot)
    const allStrikes = [...new Set(options.map(o => o.strike))];
    const atmStrike = allStrikes.reduce((prev, curr) =>
      Math.abs(curr - spotPrice) < Math.abs(prev - spotPrice) ? curr : prev
    , allStrikes[0]);

    return { puts, calls, atmStrike };
  }, [options, spotPrice]);

  const getDeltaColor = (delta: number) => {
    const absDelta = Math.abs(delta);
    if (absDelta >= 0.4) return 'text-red-400';
    if (absDelta >= 0.25) return 'text-yellow-400';
    return 'text-green-400';
  };

  const getIVColor = (iv: number) => {
    if (iv >= 0.3) return 'text-red-400';
    if (iv >= 0.2) return 'text-yellow-400';
    return 'text-green-400';
  };

  const formatDelta = (delta: number) => {
    return delta.toFixed(2);
  };

  const formatIV = (iv: number) => {
    return `${(iv * 100).toFixed(0)}%`;
  };

  const formatPrice = (price: number) => {
    return price.toFixed(2);
  };

  const formatVolume = (vol: number) => {
    if (vol >= 1000) return `${(vol / 1000).toFixed(1)}k`;
    return vol.toString();
  };

  const renderOptionRow = (option: OptionQuote) => {
    const isATM = option.strike === atmStrike;
    const isITM = option.right === 'PUT'
      ? option.strike > spotPrice
      : option.strike < spotPrice;
    const isSelected = option.strike === selectedStrike && option.right === selectedRight;

    return (
      <tr
        key={`${option.right}-${option.strike}`}
        onClick={() => onSelectOption?.(option)}
        className={cn(
          'cursor-pointer transition-colors',
          isSelected && 'bg-blue-500/20 border-l-2 border-blue-500',
          isATM && !isSelected && 'bg-white/5',
          isITM && !isSelected && 'bg-red-500/5',
          !isSelected && 'hover:bg-white/10'
        )}
      >
        <td className="px-3 py-2 text-right font-mono">
          <span className={cn(
            'font-semibold',
            isATM && 'text-yellow-400',
            isITM && 'text-red-300'
          )}>
            {option.strike}
          </span>
          <span className="ml-1 text-xs text-gray-500">
            {option.right === 'PUT' ? 'P' : 'C'}
          </span>
        </td>
        <td className="px-3 py-2 text-right font-mono text-gray-300">
          {formatPrice(option.bid)}
        </td>
        <td className="px-3 py-2 text-right font-mono text-gray-300">
          {formatPrice(option.ask)}
        </td>
        <td className={cn('px-3 py-2 text-right font-mono', getDeltaColor(option.delta))}>
          {formatDelta(option.delta)}
        </td>
        <td className={cn('px-3 py-2 text-right font-mono', getIVColor(option.iv))}>
          {formatIV(option.iv)}
        </td>
        <td className="px-3 py-2 text-right font-mono text-gray-400">
          {formatVolume(option.volume)}
        </td>
      </tr>
    );
  };

  return (
    <div className="bg-[#111118] rounded-lg border border-gray-800 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <h3 className="text-sm font-semibold text-white">Options Chain</h3>
        <div className="flex items-center gap-4">
          <span className="text-xs text-gray-400">
            Spot: <span className="text-white font-mono">${spotPrice.toFixed(2)}</span>
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowPuts(!showPuts)}
              className={cn(
                'px-2 py-1 text-xs rounded transition-colors',
                showPuts ? 'bg-red-500/20 text-red-400' : 'bg-gray-800 text-gray-500'
              )}
            >
              PUTS
            </button>
            <button
              onClick={() => setShowCalls(!showCalls)}
              className={cn(
                'px-2 py-1 text-xs rounded transition-colors',
                showCalls ? 'bg-green-500/20 text-green-400' : 'bg-gray-800 text-gray-500'
              )}
            >
              CALLS
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="max-h-[400px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#0a0a0f]">
            <tr className="text-gray-500 text-xs">
              <th className="px-3 py-2 text-right font-medium">Strike</th>
              <th className="px-3 py-2 text-right font-medium">Bid</th>
              <th className="px-3 py-2 text-right font-medium">Ask</th>
              <th className="px-3 py-2 text-right font-medium">Delta</th>
              <th className="px-3 py-2 text-right font-medium">IV</th>
              <th className="px-3 py-2 text-right font-medium">Vol</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {showPuts && puts.map(renderOptionRow)}
            {showPuts && showCalls && (
              <tr className="bg-gray-800/30">
                <td colSpan={6} className="py-1 text-center text-xs text-gray-500">
                  ─── ATM ${atmStrike} ───
                </td>
              </tr>
            )}
            {showCalls && calls.map(renderOptionRow)}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="px-4 py-2 border-t border-gray-800 flex items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded bg-yellow-400"></span> ATM
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded bg-red-500/50"></span> ITM
        </span>
        <span className="flex items-center gap-1">
          <span className="text-green-400">Δ</span> Low risk
        </span>
        <span className="flex items-center gap-1">
          <span className="text-red-400">Δ</span> High risk
        </span>
      </div>
    </div>
  );
}
