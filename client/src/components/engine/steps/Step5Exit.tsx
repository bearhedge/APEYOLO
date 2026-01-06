/**
 * Step5Exit - Exit Strategy and Execution
 *
 * Shows stop multiplier selection, order preview table,
 * guard rail violations, and execution controls.
 */

import { Button } from '@/components/ui/button';
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import type { TradeProposal } from '@shared/types/engine';

interface Step5ExitProps {
  stopMultiplier: 2 | 3 | 4;
  onStopMultiplierChange: (multiplier: 2 | 3 | 4) => void;
  proposal: TradeProposal;
  entryPremium: number;
  stopLossPrice: number;
  maxLoss: number;
  guardRailsPassed: boolean;
  violations: string[];
  onExecute: () => void;
  onCancel: () => void;
  isExecuting: boolean;
}

export function Step5Exit({
  stopMultiplier,
  onStopMultiplierChange,
  proposal,
  entryPremium,
  stopLossPrice,
  maxLoss,
  guardRailsPassed,
  violations,
  onExecute,
  onCancel,
  isExecuting,
}: Step5ExitProps) {
  const multiplierOptions = [
    { value: 2, label: '2x Premium', description: 'Tight stop' },
    { value: 3, label: '3x Premium', description: 'Balanced' },
    { value: 4, label: '4x Premium', description: 'Loose stop' },
  ] as const;

  return (
    <div className="space-y-6">
      {/* Stop Multiplier Buttons */}
      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
          Stop Loss Multiplier
        </h4>
        <div className="grid grid-cols-3 gap-3">
          {multiplierOptions.map((option) => {
            const isSelected = option.value === stopMultiplier;
            return (
              <button
                key={option.value}
                onClick={() => onStopMultiplierChange(option.value)}
                className={`p-4 rounded-lg border transition-all ${
                  isSelected
                    ? 'bg-blue-500/10 border-blue-500/30 ring-2 ring-blue-500/30'
                    : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700'
                }`}
              >
                <div className="text-center">
                  <p className={`text-lg font-bold mb-1 ${isSelected ? 'text-blue-400' : 'text-white'}`}>
                    {option.label}
                  </p>
                  <p className="text-xs text-zinc-500">{option.description}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Order Preview Table */}
      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
          Order Preview
        </h4>
        <div className="border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-zinc-900/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                  Type
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                  Strike
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                  Delta
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                  Premium
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {proposal.legs.map((leg, i) => (
                <tr key={i} className="bg-zinc-900/20">
                  <td className="px-4 py-3">
                    <span className={`text-sm font-medium ${
                      leg.optionType === 'PUT' ? 'text-red-400' : 'text-green-400'
                    }`}>
                      SELL {leg.optionType}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-white">
                    ${leg.strike.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-zinc-400">
                    {Math.abs(leg.delta).toFixed(3)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-green-400">
                    ${leg.premium.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-zinc-900/50 border-t-2 border-zinc-700">
              <tr>
                <td colSpan={3} className="px-4 py-3 text-sm font-semibold text-zinc-400">
                  Total ({proposal.contracts} contract{proposal.contracts > 1 ? 's' : ''})
                </td>
                <td className="px-4 py-3 text-right font-mono text-lg font-bold text-green-400">
                  ${entryPremium.toFixed(2)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Stop Loss Info */}
      <div className="p-4 bg-red-500/5 rounded-lg border border-red-500/20">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-zinc-400">Stop Loss Price</span>
          <span className="text-xl font-bold font-mono text-red-400">${stopLossPrice.toFixed(2)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-zinc-400">Max Loss</span>
          <span className="text-xl font-bold font-mono text-red-400">${maxLoss.toFixed(0)}</span>
        </div>
      </div>

      {/* Guard Rails Status */}
      {!guardRailsPassed && violations.length > 0 && (
        <div className="p-4 bg-red-500/10 rounded-lg border border-red-500/30">
          <div className="flex items-start gap-3">
            <XCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-red-400 mb-2">Guard Rail Violations</p>
              <ul className="space-y-1">
                {violations.map((violation, i) => (
                  <li key={i} className="text-sm text-red-400/80">
                    • {violation}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {guardRailsPassed && (
        <div className="p-4 bg-green-500/10 rounded-lg border border-green-500/30">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-500" />
            <p className="text-sm font-semibold text-green-400">All guard rails passed</p>
          </div>
        </div>
      )}

      {/* Live Trade Warning */}
      <div className="p-4 bg-amber-500/10 rounded-lg border border-amber-500/30">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-400 mb-1">Live Trade Warning</p>
            <p className="text-sm text-amber-400/80">
              This will place a real order with your broker. Ensure you understand the risks before executing.
            </p>
          </div>
        </div>
      </div>

      {/* Dual CTAs */}
      <div className="grid grid-cols-2 gap-4">
        <Button
          onClick={onCancel}
          variant="outline"
          disabled={isExecuting}
          className="py-6 text-base"
          size="lg"
        >
          Cancel
        </Button>
        <Button
          onClick={onExecute}
          disabled={!guardRailsPassed || isExecuting}
          className="py-6 text-base bg-green-600 hover:bg-green-700"
          size="lg"
        >
          {isExecuting ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Executing...
            </>
          ) : (
            'Execute Trade'
          )}
        </Button>
      </div>
    </div>
  );
}
