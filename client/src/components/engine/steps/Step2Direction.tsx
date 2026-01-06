/**
 * Step2Direction - Direction Recommendation with Override
 *
 * Shows recommended direction with confidence, signals,
 * and override buttons for user preference.
 */

import { Button } from '@/components/ui/button';
import { ArrowDown, ArrowUp, ArrowLeftRight, CheckCircle2 } from 'lucide-react';
import type { TradeDirection } from '@shared/types/engine';

interface Step2DirectionProps {
  direction: TradeDirection;
  confidence: number;
  signals: string[];
  onOverride: (newDirection: TradeDirection) => void;
  onContinue: () => void;
  isComplete: boolean;
}

export function Step2Direction({
  direction,
  confidence,
  signals,
  onOverride,
  onContinue,
  isComplete,
}: Step2DirectionProps) {
  // Direction icon and color mapping
  const getDirectionConfig = (dir: TradeDirection) => {
    switch (dir) {
      case 'PUT':
        return {
          icon: ArrowDown,
          label: 'PUT',
          color: 'red',
          bgClass: 'bg-red-500/10',
          borderClass: 'border-red-500/30',
          textClass: 'text-red-400',
          buttonClass: 'border-red-500/50 hover:bg-red-500/20',
        };
      case 'CALL':
        return {
          icon: ArrowUp,
          label: 'CALL',
          color: 'green',
          bgClass: 'bg-green-500/10',
          borderClass: 'border-green-500/30',
          textClass: 'text-green-400',
          buttonClass: 'border-green-500/50 hover:bg-green-500/20',
        };
      case 'STRANGLE':
        return {
          icon: ArrowLeftRight,
          label: 'STRANGLE',
          color: 'blue',
          bgClass: 'bg-blue-500/10',
          borderClass: 'border-blue-500/30',
          textClass: 'text-blue-400',
          buttonClass: 'border-blue-500/50 hover:bg-blue-500/20',
        };
    }
  };

  const currentConfig = getDirectionConfig(direction);
  const Icon = currentConfig.icon;

  return (
    <div className="space-y-6">
      {/* Large Direction Display */}
      <div className={`p-8 rounded-xl border ${currentConfig.bgClass} ${currentConfig.borderClass}`}>
        <div className="flex flex-col items-center gap-4">
          <Icon className={`w-16 h-16 ${currentConfig.textClass}`} />
          <div className="text-center">
            <h3 className={`text-4xl font-bold ${currentConfig.textClass} mb-2`}>
              {currentConfig.label}
            </h3>
            <p className="text-sm text-zinc-400 uppercase tracking-wider">Recommended Direction</p>
          </div>
        </div>
      </div>

      {/* Confidence Bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-400 uppercase tracking-wider">Confidence</span>
          <span className="font-mono font-semibold text-white">{confidence}%</span>
        </div>
        <div className="relative h-3 bg-zinc-900 rounded-full border border-zinc-800 overflow-hidden">
          <div
            className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${
              confidence >= 75 ? 'bg-green-500' :
              confidence >= 50 ? 'bg-blue-500' :
              'bg-amber-500'
            }`}
            style={{ width: `${confidence}%` }}
          />
        </div>
      </div>

      {/* Signals */}
      <div className="p-4 bg-zinc-900/50 rounded-lg border border-zinc-800">
        <p className="text-xs text-zinc-500 mb-3 uppercase tracking-wider">Signals</p>
        <ul className="space-y-2">
          {signals.map((signal, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
              <span className="text-zinc-300">{signal}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Override Buttons */}
      <div className="space-y-3">
        <p className="text-xs text-zinc-500 uppercase tracking-wider text-center">
          Or Override Recommendation
        </p>
        <div className="grid grid-cols-3 gap-3">
          {(['PUT', 'STRANGLE', 'CALL'] as TradeDirection[]).map((dir) => {
            const config = getDirectionConfig(dir);
            const DirIcon = config.icon;
            const isSelected = dir === direction;
            return (
              <Button
                key={dir}
                onClick={() => onOverride(dir)}
                variant="outline"
                className={`py-6 flex flex-col items-center gap-2 ${
                  isSelected
                    ? `${config.bgClass} ${config.borderClass} ${config.textClass}`
                    : 'border-zinc-700 hover:border-zinc-600'
                }`}
              >
                <DirIcon className={`w-6 h-6 ${isSelected ? config.textClass : 'text-zinc-400'}`} />
                <span className="text-xs font-medium">{config.label}</span>
              </Button>
            );
          })}
        </div>
      </div>

      {/* CTA */}
      <Button
        onClick={onContinue}
        disabled={!isComplete}
        className="w-full py-6 text-base"
        size="lg"
      >
        View Strikes
      </Button>
    </div>
  );
}
