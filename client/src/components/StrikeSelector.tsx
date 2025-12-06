/**
 * StrikeSelector - Interactive Strike Selection Component
 *
 * Compact inline view with quality scoring for Step 3 of the engine.
 * Shows smart-filtered strikes with radio buttons for user selection.
 */

import { useState, useCallback } from 'react';
import { Star, Check, Info, ChevronDown, ChevronUp } from 'lucide-react';
import type { SmartStrikeCandidate, QualityRating } from '../../../shared/types/engine';

interface StrikeSelectorProps {
  // Market context
  underlyingPrice: number;
  vix?: number;
  riskRegime?: string;
  targetDelta?: number;
  contracts?: number;

  // Smart candidates from engine
  putCandidates: SmartStrikeCandidate[];
  callCandidates: SmartStrikeCandidate[];

  // Engine recommendations
  recommendedPutStrike?: number;
  recommendedCallStrike?: number;
  expectedPremium?: number;

  // Selection state
  selectedPutStrike: number | null;
  selectedCallStrike: number | null;
  onPutSelect: (strike: number | null) => void;
  onCallSelect: (strike: number | null) => void;

  // Actions
  onUseSuggestion: () => void;
  onViewFullChain: () => void;
  onConfirmSelection: () => void;

  // Loading state
  isLoading?: boolean;
  isConfirming?: boolean;
}

/**
 * Quality stars component
 */
function QualityStars({ rating }: { rating: QualityRating }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`w-3 h-3 ${
            i < rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-600'
          }`}
        />
      ))}
    </div>
  );
}

/**
 * Strike row component for the selection table
 */
function StrikeRow({
  candidate,
  isSelected,
  isRecommended,
  onSelect,
}: {
  candidate: SmartStrikeCandidate;
  isSelected: boolean;
  isRecommended: boolean;
  onSelect: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <>
      <tr
        className={`
          cursor-pointer transition-colors
          ${isSelected ? 'bg-blue-500/20 border-l-2 border-l-blue-500' : ''}
          ${isRecommended && !isSelected ? 'bg-green-500/10' : ''}
          hover:bg-white/5
        `}
        onClick={onSelect}
      >
        {/* Radio */}
        <td className="py-1.5 px-2 w-8">
          <div className={`
            w-4 h-4 rounded-full border-2 flex items-center justify-center
            ${isSelected ? 'border-blue-500 bg-blue-500' : 'border-gray-500'}
          `}>
            {isSelected && <Check className="w-3 h-3 text-white" />}
          </div>
        </td>

        {/* Strike */}
        <td className="py-1.5 px-2 font-mono font-medium">
          ${candidate.strike}
          {isRecommended && (
            <span className="ml-1 text-[10px] text-green-400 font-normal">REC</span>
          )}
        </td>

        {/* Bid */}
        <td className="py-1.5 px-2 font-mono text-right">
          ${candidate.bid.toFixed(2)}
        </td>

        {/* Delta */}
        <td className="py-1.5 px-2 font-mono text-right text-silver">
          {candidate.delta.toFixed(2)}
        </td>

        {/* Yield */}
        <td className="py-1.5 px-2 font-mono text-right text-emerald-400">
          {candidate.yieldPct}
        </td>

        {/* Quality */}
        <td className="py-1.5 px-2">
          <QualityStars rating={candidate.qualityScore} />
        </td>

        {/* Info toggle */}
        <td className="py-1.5 px-2 w-8">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowDetails(!showDetails);
            }}
            className="p-1 hover:bg-white/10 rounded"
          >
            {showDetails ? (
              <ChevronUp className="w-3 h-3 text-silver" />
            ) : (
              <Info className="w-3 h-3 text-silver" />
            )}
          </button>
        </td>
      </tr>

      {/* Expandable details row */}
      {showDetails && (
        <tr className="bg-black/20">
          <td colSpan={7} className="py-2 px-4">
            <div className="grid grid-cols-4 gap-4 text-xs">
              <div>
                <span className="text-silver">Spread: </span>
                <span className="font-mono">${candidate.spread.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-silver">OI: </span>
                <span className="font-mono">{candidate.openInterest.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-silver">IV: </span>
                <span className="font-mono">{candidate.iv ? `${(candidate.iv * 100).toFixed(1)}%` : 'N/A'}</span>
              </div>
              <div>
                <span className="text-silver">Gamma: </span>
                <span className="font-mono">{candidate.gamma?.toFixed(3) ?? 'N/A'}</span>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {candidate.qualityReasons.map((reason, i) => (
                <span key={i} className="text-[10px] bg-white/5 px-2 py-0.5 rounded">
                  {reason}
                </span>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Main StrikeSelector component
 */
export function StrikeSelector({
  underlyingPrice,
  vix,
  riskRegime,
  targetDelta,
  contracts,
  putCandidates,
  callCandidates,
  recommendedPutStrike,
  recommendedCallStrike,
  expectedPremium,
  selectedPutStrike,
  selectedCallStrike,
  onPutSelect,
  onCallSelect,
  onUseSuggestion,
  onViewFullChain,
  onConfirmSelection,
  isLoading,
  isConfirming,
}: StrikeSelectorProps) {
  // Calculate combined premium for selected strikes
  const calculatePremium = useCallback(() => {
    let premium = 0;
    const selectedPut = putCandidates.find(c => c.strike === selectedPutStrike);
    const selectedCall = callCandidates.find(c => c.strike === selectedCallStrike);

    if (selectedPut) {
      premium += ((selectedPut.bid + selectedPut.ask) / 2) * 100;
    }
    if (selectedCall) {
      premium += ((selectedCall.bid + selectedCall.ask) / 2) * 100;
    }
    return premium;
  }, [putCandidates, callCandidates, selectedPutStrike, selectedCallStrike]);

  const currentPremium = calculatePremium();
  const hasSelection = selectedPutStrike !== null || selectedCallStrike !== null;

  return (
    <div className="space-y-4">
      {/* Header with market context */}
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-4">
          <span className="font-mono">
            SPY: <span className="text-white font-medium">${underlyingPrice.toFixed(2)}</span>
          </span>
          <span className="text-silver">|</span>
          <span>
            Risk: <span className={`font-medium ${
              riskRegime === 'LOW' ? 'text-green-400' :
              riskRegime === 'NORMAL' ? 'text-blue-400' :
              riskRegime === 'ELEVATED' ? 'text-yellow-400' :
              riskRegime === 'HIGH' ? 'text-orange-400' : 'text-red-400'
            }`}>{riskRegime ?? 'N/A'}</span>
          </span>
          <span className="text-silver">|</span>
          <span>
            Target: <span className="font-mono text-white">{targetDelta?.toFixed(2) ?? 'N/A'}Δ</span>
          </span>
          <span className="text-silver">|</span>
          <span>
            <span className="font-mono text-white">{contracts ?? 0}</span> contracts
          </span>
        </div>
      </div>

      {/* Engine Recommendation Box */}
      {(recommendedPutStrike || recommendedCallStrike) && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm">
              <span className="text-green-400 font-medium">Engine Recommendation:</span>
              {recommendedPutStrike && (
                <span className="font-mono">
                  PUT: <span className="text-white">${recommendedPutStrike}</span>
                </span>
              )}
              {recommendedPutStrike && recommendedCallStrike && <span className="text-silver">|</span>}
              {recommendedCallStrike && (
                <span className="font-mono">
                  CALL: <span className="text-white">${recommendedCallStrike}</span>
                </span>
              )}
              <span className="text-silver">|</span>
              <span>
                Premium: <span className="text-emerald-400 font-mono">${expectedPremium?.toFixed(0) ?? '0'}/contract</span>
              </span>
            </div>
            <button
              onClick={onUseSuggestion}
              className="px-3 py-1 bg-green-500/20 hover:bg-green-500/30 text-green-400 text-sm rounded transition"
            >
              Use Suggestion
            </button>
          </div>
        </div>
      )}

      {/* Strike Selection Tables */}
      <div className="grid grid-cols-2 gap-4">
        {/* PUTS */}
        <div className="bg-black/20 rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-red-500/10 border-b border-white/10">
            <span className="text-sm font-medium text-red-400">PUTS (OTM)</span>
            <span className="ml-2 text-xs text-silver">
              {putCandidates.length} viable
            </span>
          </div>
          <div className="max-h-[200px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-black/30 sticky top-0">
                <tr className="text-silver">
                  <th className="py-1.5 px-2 text-left w-8"></th>
                  <th className="py-1.5 px-2 text-left">Strike</th>
                  <th className="py-1.5 px-2 text-right">Bid</th>
                  <th className="py-1.5 px-2 text-right">Delta</th>
                  <th className="py-1.5 px-2 text-right">Yield</th>
                  <th className="py-1.5 px-2 text-center">Quality</th>
                  <th className="py-1.5 px-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {putCandidates.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-4 text-center text-silver">
                      No viable PUT strikes
                    </td>
                  </tr>
                ) : (
                  putCandidates.map(candidate => (
                    <StrikeRow
                      key={candidate.strike}
                      candidate={candidate}
                      isSelected={selectedPutStrike === candidate.strike}
                      isRecommended={candidate.isEngineRecommended}
                      onSelect={() => onPutSelect(
                        selectedPutStrike === candidate.strike ? null : candidate.strike
                      )}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* CALLS */}
        <div className="bg-black/20 rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-green-500/10 border-b border-white/10">
            <span className="text-sm font-medium text-green-400">CALLS (OTM)</span>
            <span className="ml-2 text-xs text-silver">
              {callCandidates.length} viable
            </span>
          </div>
          <div className="max-h-[200px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-black/30 sticky top-0">
                <tr className="text-silver">
                  <th className="py-1.5 px-2 text-left w-8"></th>
                  <th className="py-1.5 px-2 text-left">Strike</th>
                  <th className="py-1.5 px-2 text-right">Bid</th>
                  <th className="py-1.5 px-2 text-right">Delta</th>
                  <th className="py-1.5 px-2 text-right">Yield</th>
                  <th className="py-1.5 px-2 text-center">Quality</th>
                  <th className="py-1.5 px-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {callCandidates.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-4 text-center text-silver">
                      No viable CALL strikes
                    </td>
                  </tr>
                ) : (
                  callCandidates.map(candidate => (
                    <StrikeRow
                      key={candidate.strike}
                      candidate={candidate}
                      isSelected={selectedCallStrike === candidate.strike}
                      isRecommended={candidate.isEngineRecommended}
                      onSelect={() => onCallSelect(
                        selectedCallStrike === candidate.strike ? null : candidate.strike
                      )}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Footer with actions */}
      <div className="flex items-center justify-between pt-2 border-t border-white/10">
        <button
          onClick={onViewFullChain}
          className="text-sm text-blue-400 hover:text-blue-300 transition"
        >
          View Full Option Chain →
        </button>

        <div className="flex items-center gap-4">
          {hasSelection && (
            <div className="text-sm">
              <span className="text-silver">Selected: </span>
              {selectedPutStrike && (
                <span className="font-mono text-red-400">${selectedPutStrike}P</span>
              )}
              {selectedPutStrike && selectedCallStrike && <span className="text-silver"> / </span>}
              {selectedCallStrike && (
                <span className="font-mono text-green-400">${selectedCallStrike}C</span>
              )}
              <span className="text-silver ml-2">|</span>
              <span className="ml-2 text-emerald-400 font-mono">
                ${currentPremium.toFixed(0)}/contract
              </span>
            </div>
          )}

          <button
            onClick={onConfirmSelection}
            disabled={!hasSelection || isConfirming}
            className={`
              px-4 py-2 rounded-lg font-medium text-sm transition
              ${hasSelection
                ? 'bg-blue-500 hover:bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-400 cursor-not-allowed'
              }
            `}
          >
            {isConfirming ? 'Confirming...' : 'Confirm & Continue →'}
          </button>
        </div>
      </div>
    </div>
  );
}
