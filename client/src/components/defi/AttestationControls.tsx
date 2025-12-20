/**
 * AttestationControls - Compact period selector and attest button
 */

import { useState } from 'react';
import { ChevronDown, Zap, Loader2 } from 'lucide-react';
import type { AttestationPeriod } from '@shared/types/defi';

interface AttestationControlsProps {
  selectedPeriod: AttestationPeriod;
  onPeriodChange: (period: AttestationPeriod) => void;
  onAttest: () => void;
  onPreview: () => void;
  isLoading?: boolean;
  hasPreview?: boolean;
  sasReady?: boolean;
  disabled?: boolean;
}

const PERIODS: { type: AttestationPeriod; label: string }[] = [
  { type: 'mtd', label: 'MTD' },
  { type: 'last_week', label: 'Last Week' },
  { type: 'last_month', label: 'Last Month' },
];

export function AttestationControls({
  selectedPeriod,
  onPeriodChange,
  onAttest,
  onPreview,
  isLoading,
  hasPreview,
  sasReady,
  disabled,
}: AttestationControlsProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const selectedLabel = PERIODS.find(p => p.type === selectedPeriod)?.label || 'Select';

  return (
    <div className="bg-terminal-panel terminal-grid p-4">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="w-4 h-4 text-bloomberg-blue" />
        <span className="text-xs uppercase tracking-wide text-terminal-dim">Attest</span>
      </div>

      {/* Period Selector */}
      <div className="relative mb-3">
        <button
          onClick={() => !disabled && setShowDropdown(!showDropdown)}
          disabled={disabled}
          className="w-full flex items-center justify-between px-3 py-2 bg-terminal border border-terminal text-sm text-terminal-bright disabled:opacity-50"
        >
          <span>{selectedLabel}</span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
        </button>

        {showDropdown && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-terminal border border-terminal z-10">
            {PERIODS.map(p => (
              <button
                key={p.type}
                onClick={() => {
                  onPeriodChange(p.type);
                  setShowDropdown(false);
                }}
                className={`w-full px-3 py-2 text-left text-sm hover:bg-white/5 ${
                  selectedPeriod === p.type ? 'text-bloomberg-blue' : 'text-terminal-bright'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        <button
          onClick={onPreview}
          disabled={disabled || isLoading}
          className="flex-1 px-3 py-2 text-xs uppercase tracking-wide border border-terminal text-terminal-dim hover:text-terminal-bright hover:border-white/30 disabled:opacity-50 transition-colors"
        >
          Preview
        </button>
        <button
          onClick={onAttest}
          disabled={disabled || isLoading || !hasPreview || !sasReady}
          className="flex-1 px-3 py-2 text-xs uppercase tracking-wide bg-bloomberg-blue text-black font-medium disabled:opacity-50 disabled:bg-terminal disabled:text-terminal-dim transition-colors flex items-center justify-center gap-1"
        >
          {isLoading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            'Attest'
          )}
        </button>
      </div>

      {/* Status */}
      <div className="mt-3 pt-3 border-t border-terminal flex items-center justify-between text-xs">
        <span className="text-terminal-dim">SAS</span>
        <span className={sasReady ? 'text-bloomberg-green' : 'text-bloomberg-amber'}>
          {sasReady ? 'Ready' : 'Pending'}
        </span>
      </div>
    </div>
  );
}
