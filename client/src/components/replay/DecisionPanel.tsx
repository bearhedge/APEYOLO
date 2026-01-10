// @ts-nocheck
/**
 * Decision Panel Component
 *
 * Captures trading decisions with:
 * - Mode selection (Standard, High Conviction, Defensive)
 * - Direction (PUT, CALL, STRANGLE, NO_TRADE)
 * - Strike selection
 * - Reasoning capture
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Shield, Zap, Lock, TrendingDown, TrendingUp, GitMerge, Ban } from 'lucide-react';

type TradingMode = 'standard' | 'high_conviction' | 'defensive';
type Direction = 'PUT' | 'CALL' | 'STRANGLE' | 'NO_TRADE';

interface DecisionPanelProps {
  selectedStrike?: number;
  selectedRight?: 'PUT' | 'CALL';
  spotPrice: number;
  onSubmit: (decision: {
    mode: TradingMode;
    direction: Direction;
    strike?: number;
    reasoning: string;
  }) => void;
  disabled?: boolean;
}

const MODES = [
  {
    id: 'standard' as TradingMode,
    label: 'Standard',
    icon: Shield,
    description: 'Default rules: 11am entry, 15-20 delta, OTM only',
    color: 'blue',
  },
  {
    id: 'high_conviction' as TradingMode,
    label: 'High Conviction',
    icon: Zap,
    description: 'Clear edge: earlier entry, flexible delta, closer to ATM',
    color: 'yellow',
    requiresReasoning: true,
  },
  {
    id: 'defensive' as TradingMode,
    label: 'Defensive',
    icon: Lock,
    description: 'Uncertain: tighter stops, smaller size, wider spreads',
    color: 'gray',
  },
];

const DIRECTIONS = [
  { id: 'PUT' as Direction, label: 'PUT', icon: TrendingDown, color: 'red' },
  { id: 'CALL' as Direction, label: 'CALL', icon: TrendingUp, color: 'green' },
  { id: 'STRANGLE' as Direction, label: 'STRANGLE', icon: GitMerge, color: 'purple' },
  { id: 'NO_TRADE' as Direction, label: 'NO TRADE', icon: Ban, color: 'gray' },
];

export function DecisionPanel({
  selectedStrike,
  selectedRight,
  spotPrice,
  onSubmit,
  disabled = false,
}: DecisionPanelProps) {
  const [mode, setMode] = useState<TradingMode>('standard');
  const [direction, setDirection] = useState<Direction | null>(null);
  const [reasoning, setReasoning] = useState('');

  const selectedMode = MODES.find(m => m.id === mode);
  const requiresReasoning = selectedMode?.requiresReasoning || false;
  const hasValidReasoning = reasoning.trim().length >= 10;

  const canSubmit =
    direction !== null &&
    (!requiresReasoning || hasValidReasoning) &&
    !disabled;

  const handleSubmit = () => {
    if (!canSubmit || !direction) return;

    onSubmit({
      mode,
      direction,
      strike: direction !== 'NO_TRADE' ? selectedStrike : undefined,
      reasoning: reasoning.trim(),
    });

    // Reset form
    setDirection(null);
    setReasoning('');
  };

  return (
    <div className="bg-[#111118] rounded-lg border border-gray-800 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800">
        <h3 className="text-sm font-semibold text-white">Make Decision</h3>
      </div>

      <div className="p-4 space-y-5">
        {/* Mode Selection */}
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-2">
            Trading Mode
          </label>
          <div className="grid grid-cols-3 gap-2">
            {MODES.map((m) => {
              const Icon = m.icon;
              const isSelected = mode === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => setMode(m.id)}
                  className={cn(
                    'flex flex-col items-center gap-1 p-3 rounded-lg border transition-all',
                    isSelected
                      ? m.color === 'blue'
                        ? 'bg-blue-500/20 border-blue-500 text-blue-400'
                        : m.color === 'yellow'
                        ? 'bg-yellow-500/20 border-yellow-500 text-yellow-400'
                        : 'bg-gray-500/20 border-gray-500 text-gray-400'
                      : 'bg-black/20 border-gray-700 text-gray-500 hover:border-gray-600'
                  )}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-xs font-medium">{m.label}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-gray-500">{selectedMode?.description}</p>
        </div>

        {/* Direction Selection */}
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-2">
            Direction
          </label>
          <div className="grid grid-cols-4 gap-2">
            {DIRECTIONS.map((d) => {
              const Icon = d.icon;
              const isSelected = direction === d.id;
              return (
                <button
                  key={d.id}
                  onClick={() => setDirection(d.id)}
                  className={cn(
                    'flex flex-col items-center gap-1 p-3 rounded-lg border transition-all',
                    isSelected
                      ? d.color === 'red'
                        ? 'bg-red-500/20 border-red-500 text-red-400'
                        : d.color === 'green'
                        ? 'bg-green-500/20 border-green-500 text-green-400'
                        : d.color === 'purple'
                        ? 'bg-purple-500/20 border-purple-500 text-purple-400'
                        : 'bg-gray-500/20 border-gray-500 text-gray-400'
                      : 'bg-black/20 border-gray-700 text-gray-500 hover:border-gray-600'
                  )}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-xs font-medium">{d.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected Strike Display */}
        {direction && direction !== 'NO_TRADE' && (
          <div className="p-3 bg-black/30 rounded-lg border border-gray-700">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Selected Strike</span>
              {selectedStrike ? (
                <span className="font-mono text-white">
                  {selectedStrike} {selectedRight}
                </span>
              ) : (
                <span className="text-xs text-yellow-500">
                  Click an option in the chain
                </span>
              )}
            </div>
          </div>
        )}

        {/* Reasoning Input */}
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-2">
            Reasoning
            {requiresReasoning && (
              <span className="text-yellow-500 ml-1">(required for High Conviction)</span>
            )}
          </label>
          <Textarea
            placeholder="Why this decision? What do you see? (min 10 chars for High Conviction mode)"
            value={reasoning}
            onChange={(e) => setReasoning(e.target.value)}
            className="bg-black/20 border-gray-700 text-white placeholder:text-gray-600 resize-none"
            rows={3}
          />
          {requiresReasoning && reasoning.length > 0 && reasoning.length < 10 && (
            <p className="mt-1 text-xs text-red-400">
              {10 - reasoning.length} more characters needed
            </p>
          )}
        </div>

        {/* Submit Button */}
        <Button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={cn(
            'w-full py-6 text-lg font-semibold transition-all',
            canSubmit
              ? direction === 'PUT'
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : direction === 'CALL'
                ? 'bg-green-600 hover:bg-green-700 text-white'
                : direction === 'STRANGLE'
                ? 'bg-purple-600 hover:bg-purple-700 text-white'
                : 'bg-gray-600 hover:bg-gray-700 text-white'
              : 'bg-gray-800 text-gray-500 cursor-not-allowed'
          )}
        >
          {direction
            ? direction === 'NO_TRADE'
              ? 'Confirm No Trade'
              : `Submit ${direction} Decision`
            : 'Select Direction'}
        </Button>

        {/* Historical Accuracy (placeholder) */}
        <div className="pt-3 border-t border-gray-800">
          <p className="text-xs text-gray-500 text-center">
            Your {mode.replace('_', ' ')} mode accuracy: <span className="text-white">--</span>
            <span className="text-gray-600 ml-1">(not enough data yet)</span>
          </p>
        </div>
      </div>
    </div>
  );
}
