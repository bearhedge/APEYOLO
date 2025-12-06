/**
 * OptionChainModal - Full Option Chain with All Greeks
 *
 * Modal view showing complete option chain data including all Greeks,
 * IV, and open interest. For power users who want full visibility.
 */

import { useState, useEffect } from 'react';
import { X, Star, Check } from 'lucide-react';
import type { SmartStrikeCandidate, QualityRating, StrikeRejection } from '../../../shared/types/engine';

interface OptionChainModalProps {
  isOpen: boolean;
  onClose: () => void;

  // Market context
  underlyingPrice: number;
  vix?: number;
  lastUpdate?: string;

  // Candidates from engine
  putCandidates: SmartStrikeCandidate[];
  callCandidates: SmartStrikeCandidate[];

  // Rejections for transparency
  rejectedStrikes?: StrikeRejection[];

  // Selection state
  selectedPutStrike: number | null;
  selectedCallStrike: number | null;
  onPutSelect: (strike: number | null) => void;
  onCallSelect: (strike: number | null) => void;

  // Actions
  onConfirmSelection: () => void;
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
 * Full option chain table component
 */
function OptionChainTable({
  candidates,
  optionType,
  selectedStrike,
  onSelect,
}: {
  candidates: SmartStrikeCandidate[];
  optionType: 'PUT' | 'CALL';
  selectedStrike: number | null;
  onSelect: (strike: number | null) => void;
}) {
  const colorClass = optionType === 'PUT' ? 'text-red-400' : 'text-green-400';
  const bgClass = optionType === 'PUT' ? 'bg-red-500/10' : 'bg-green-500/10';

  return (
    <div className="bg-black/20 rounded-lg overflow-hidden">
      <div className={`px-4 py-2 ${bgClass} border-b border-white/10`}>
        <span className={`text-sm font-medium ${colorClass}`}>
          {optionType}S (OTM)
        </span>
        <span className="ml-2 text-xs text-silver">
          {candidates.length} viable strikes
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-black/30 sticky top-0">
            <tr className="text-silver">
              <th className="py-2 px-2 text-left w-8"></th>
              <th className="py-2 px-2 text-left">Strike</th>
              <th className="py-2 px-2 text-right">Bid</th>
              <th className="py-2 px-2 text-right">Ask</th>
              <th className="py-2 px-2 text-right">Delta</th>
              <th className="py-2 px-2 text-right">Gamma</th>
              <th className="py-2 px-2 text-right">Theta</th>
              <th className="py-2 px-2 text-right">IV</th>
              <th className="py-2 px-2 text-right">OI</th>
              <th className="py-2 px-2 text-right">Yield</th>
              <th className="py-2 px-2 text-center">Quality</th>
            </tr>
          </thead>
          <tbody>
            {candidates.length === 0 ? (
              <tr>
                <td colSpan={11} className="py-8 text-center text-silver">
                  No viable {optionType} strikes found
                </td>
              </tr>
            ) : (
              candidates.map(candidate => {
                const isSelected = selectedStrike === candidate.strike;
                return (
                  <tr
                    key={candidate.strike}
                    className={`
                      cursor-pointer transition-colors
                      ${isSelected ? 'bg-blue-500/20 border-l-2 border-l-blue-500' : ''}
                      ${candidate.isEngineRecommended && !isSelected ? 'bg-green-500/10' : ''}
                      hover:bg-white/5
                    `}
                    onClick={() => onSelect(isSelected ? null : candidate.strike)}
                  >
                    {/* Radio */}
                    <td className="py-2 px-2">
                      <div className={`
                        w-4 h-4 rounded-full border-2 flex items-center justify-center
                        ${isSelected ? 'border-blue-500 bg-blue-500' : 'border-gray-500'}
                      `}>
                        {isSelected && <Check className="w-3 h-3 text-white" />}
                      </div>
                    </td>

                    {/* Strike */}
                    <td className="py-2 px-2 font-mono font-medium">
                      ${candidate.strike}
                      {candidate.isEngineRecommended && (
                        <span className="ml-1 text-[10px] text-green-400 font-normal">REC</span>
                      )}
                    </td>

                    {/* Bid */}
                    <td className="py-2 px-2 font-mono text-right">
                      ${candidate.bid.toFixed(2)}
                    </td>

                    {/* Ask */}
                    <td className="py-2 px-2 font-mono text-right">
                      ${candidate.ask.toFixed(2)}
                    </td>

                    {/* Delta */}
                    <td className={`py-2 px-2 font-mono text-right ${colorClass}`}>
                      {candidate.delta.toFixed(2)}
                    </td>

                    {/* Gamma */}
                    <td className="py-2 px-2 font-mono text-right text-silver">
                      {candidate.gamma?.toFixed(3) ?? '—'}
                    </td>

                    {/* Theta */}
                    <td className="py-2 px-2 font-mono text-right text-orange-400">
                      {candidate.theta?.toFixed(2) ?? '—'}
                    </td>

                    {/* IV */}
                    <td className="py-2 px-2 font-mono text-right text-purple-400">
                      {candidate.iv ? `${(candidate.iv * 100).toFixed(1)}%` : '—'}
                    </td>

                    {/* Open Interest */}
                    <td className="py-2 px-2 font-mono text-right">
                      {candidate.openInterest.toLocaleString()}
                    </td>

                    {/* Yield */}
                    <td className="py-2 px-2 font-mono text-right text-emerald-400">
                      {candidate.yieldPct}
                    </td>

                    {/* Quality */}
                    <td className="py-2 px-2">
                      <QualityStars rating={candidate.qualityScore} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Rejected strikes section (collapsed by default)
 */
function RejectedStrikesSection({ rejections }: { rejections: StrikeRejection[] }) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (rejections.length === 0) return null;

  const putRejections = rejections.filter(r => r.optionType === 'PUT');
  const callRejections = rejections.filter(r => r.optionType === 'CALL');

  const reasonCounts: Record<string, number> = {};
  for (const r of rejections) {
    reasonCounts[r.reason] = (reasonCounts[r.reason] || 0) + 1;
  }

  return (
    <div className="mt-4">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-sm text-silver hover:text-white transition"
      >
        <span className="text-xs">▼</span>
        {rejections.length} strikes filtered out
      </button>

      {isExpanded && (
        <div className="mt-2 p-3 bg-black/20 rounded-lg text-xs">
          <div className="grid grid-cols-2 gap-4 mb-3">
            <div>
              <span className="text-silver">Filtered PUTs: </span>
              <span className="font-mono">{putRejections.length}</span>
            </div>
            <div>
              <span className="text-silver">Filtered CALLs: </span>
              <span className="font-mono">{callRejections.length}</span>
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-silver mb-2">Rejection reasons:</p>
            {Object.entries(reasonCounts).map(([reason, count]) => (
              <div key={reason} className="flex items-center gap-2">
                <span className="text-red-400">✖</span>
                <span className="text-silver">{reason.replace(/_/g, ' ')}:</span>
                <span className="font-mono">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Main OptionChainModal component
 */
export function OptionChainModal({
  isOpen,
  onClose,
  underlyingPrice,
  vix,
  lastUpdate,
  putCandidates,
  callCandidates,
  rejectedStrikes = [],
  selectedPutStrike,
  selectedCallStrike,
  onPutSelect,
  onCallSelect,
  onConfirmSelection,
  isConfirming,
}: OptionChainModalProps) {
  // Prevent scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  // Calculate combined premium
  const calculatePremium = () => {
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
  };

  const currentPremium = calculatePremium();
  const hasSelection = selectedPutStrike !== null || selectedCallStrike !== null;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-charcoal rounded-2xl border border-white/10 shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-6">
            <h2 className="text-lg font-semibold">Option Chain (SPY 0DTE)</h2>
            <div className="flex items-center gap-4 text-sm text-silver">
              <span>
                SPY: <span className="text-white font-mono">${underlyingPrice.toFixed(2)}</span>
              </span>
              <span className="text-white/20">|</span>
              <span>
                VIX: <span className="text-white font-mono">{vix?.toFixed(1) ?? 'N/A'}</span>
              </span>
              {lastUpdate && (
                <>
                  <span className="text-white/20">|</span>
                  <span>Last: {lastUpdate}</span>
                </>
              )}
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          <div className="grid grid-cols-2 gap-6">
            {/* PUTS */}
            <OptionChainTable
              candidates={putCandidates}
              optionType="PUT"
              selectedStrike={selectedPutStrike}
              onSelect={onPutSelect}
            />

            {/* CALLS */}
            <OptionChainTable
              candidates={callCandidates}
              optionType="CALL"
              selectedStrike={selectedCallStrike}
              onSelect={onCallSelect}
            />
          </div>

          {/* Rejected strikes section */}
          <RejectedStrikesSection rejections={rejectedStrikes} />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/10 bg-black/20">
          <div className="text-sm text-silver">
            {hasSelection ? (
              <div className="flex items-center gap-4">
                <span>Selected:</span>
                {selectedPutStrike && (
                  <span className="font-mono text-red-400">${selectedPutStrike}P</span>
                )}
                {selectedPutStrike && selectedCallStrike && <span>+</span>}
                {selectedCallStrike && (
                  <span className="font-mono text-green-400">${selectedCallStrike}C</span>
                )}
                <span className="text-white/20">|</span>
                <span>
                  Premium: <span className="text-emerald-400 font-mono">${currentPremium.toFixed(0)}/contract</span>
                </span>
              </div>
            ) : (
              'Select a PUT and/or CALL strike to continue'
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-silver hover:text-white transition"
            >
              Cancel
            </button>

            <button
              onClick={() => {
                onConfirmSelection();
                onClose();
              }}
              disabled={!hasSelection || isConfirming}
              className={`
                px-6 py-2 rounded-lg font-medium text-sm transition
                ${hasSelection
                  ? 'bg-blue-500 hover:bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-400 cursor-not-allowed'
                }
              `}
            >
              {isConfirming ? 'Confirming...' : 'Confirm Selection →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
