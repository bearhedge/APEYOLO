/**
 * Step3Strikes - Strike Selection (Simplified)
 *
 * Two-column strike selection with recommended strikes highlighted
 * and full chain viewer link.
 */

import { Button } from '@/components/ui/button';
import { ExternalLink, Star } from 'lucide-react';
import type { SmartStrikeCandidate } from '@shared/types/engine';

interface Step3StrikesProps {
  underlyingPrice: number;
  putCandidates: SmartStrikeCandidate[];
  callCandidates: SmartStrikeCandidate[];
  selectedPutStrike: number | null;
  selectedCallStrike: number | null;
  recommendedPutStrike: number | null;
  recommendedCallStrike: number | null;
  onPutSelect: (strike: number) => void;
  onCallSelect: (strike: number) => void;
  onViewFullChain: () => void;
  onContinue: () => void;
  expectedPremium: number;
}

export function Step3Strikes({
  underlyingPrice,
  putCandidates,
  callCandidates,
  selectedPutStrike,
  selectedCallStrike,
  recommendedPutStrike,
  recommendedCallStrike,
  onPutSelect,
  onCallSelect,
  onViewFullChain,
  onContinue,
  expectedPremium,
}: Step3StrikesProps) {
  // Find selected candidates
  const selectedPut = putCandidates.find(c => c.strike === selectedPutStrike);
  const selectedCall = callCandidates.find(c => c.strike === selectedCallStrike);

  return (
    <div className="space-y-6">
      {/* Current Price Reference */}
      <div className="text-center p-4 bg-zinc-900/50 rounded-lg border border-zinc-800">
        <p className="text-xs text-zinc-500 mb-1 uppercase tracking-wider">Current Price</p>
        <p className="text-3xl font-bold font-mono text-white">${underlyingPrice.toFixed(2)}</p>
      </div>

      {/* Two Columns: PUT and CALL */}
      <div className="grid grid-cols-2 gap-4">
        {/* PUT Column */}
        <div className="space-y-3">
          <div className="text-center pb-2 border-b border-zinc-800">
            <h4 className="text-sm font-semibold text-red-400 uppercase tracking-wider">PUT</h4>
          </div>

          {/* PUT Strike Selector */}
          <select
            value={selectedPutStrike || ''}
            onChange={(e) => onPutSelect(Number(e.target.value))}
            className="w-full px-3 py-3 bg-zinc-900 border border-zinc-700 rounded-lg text-white font-mono focus:outline-none focus:ring-2 focus:ring-red-500/50"
          >
            <option value="">Select Strike</option>
            {putCandidates.map((candidate) => (
              <option key={candidate.strike} value={candidate.strike}>
                ${candidate.strike}{' '}
                {candidate.isEngineRecommended && '⭐ '}
                (Δ {Math.abs(candidate.delta).toFixed(2)})
              </option>
            ))}
          </select>

          {/* Selected PUT Details */}
          {selectedPut && (
            <div className="p-3 bg-red-500/5 rounded-lg border border-red-500/20">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-zinc-400">Delta:</span>
                  <span className="font-mono text-white">{Math.abs(selectedPut.delta).toFixed(3)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Premium:</span>
                  <span className="font-mono text-green-400">${selectedPut.bid.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">IV:</span>
                  <span className="font-mono text-white">{selectedPut.iv ? `${(selectedPut.iv * 100).toFixed(1)}%` : 'N/A'}</span>
                </div>
                {selectedPut.isEngineRecommended && (
                  <div className="flex items-center gap-1 text-xs text-amber-400 pt-1 border-t border-red-500/20">
                    <Star className="w-3 h-3 fill-amber-400" />
                    <span>Engine Recommended</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* CALL Column */}
        <div className="space-y-3">
          <div className="text-center pb-2 border-b border-zinc-800">
            <h4 className="text-sm font-semibold text-green-400 uppercase tracking-wider">CALL</h4>
          </div>

          {/* CALL Strike Selector */}
          <select
            value={selectedCallStrike || ''}
            onChange={(e) => onCallSelect(Number(e.target.value))}
            className="w-full px-3 py-3 bg-zinc-900 border border-zinc-700 rounded-lg text-white font-mono focus:outline-none focus:ring-2 focus:ring-green-500/50"
          >
            <option value="">Select Strike</option>
            {callCandidates.map((candidate) => (
              <option key={candidate.strike} value={candidate.strike}>
                ${candidate.strike}{' '}
                {candidate.isEngineRecommended && '⭐ '}
                (Δ {candidate.delta.toFixed(2)})
              </option>
            ))}
          </select>

          {/* Selected CALL Details */}
          {selectedCall && (
            <div className="p-3 bg-green-500/5 rounded-lg border border-green-500/20">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-zinc-400">Delta:</span>
                  <span className="font-mono text-white">{selectedCall.delta.toFixed(3)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Premium:</span>
                  <span className="font-mono text-green-400">${selectedCall.bid.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">IV:</span>
                  <span className="font-mono text-white">{selectedCall.iv ? `${(selectedCall.iv * 100).toFixed(1)}%` : 'N/A'}</span>
                </div>
                {selectedCall.isEngineRecommended && (
                  <div className="flex items-center gap-1 text-xs text-amber-400 pt-1 border-t border-green-500/20">
                    <Star className="w-3 h-3 fill-amber-400" />
                    <span>Engine Recommended</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Total Premium Display */}
      <div className="p-4 bg-green-500/5 rounded-lg border border-green-500/20">
        <div className="flex items-center justify-between">
          <span className="text-sm text-zinc-400 uppercase tracking-wider">Total Premium (per contract)</span>
          <span className="text-2xl font-bold font-mono text-green-400">${expectedPremium.toFixed(2)}</span>
        </div>
      </div>

      {/* View Full Chain Link */}
      <div className="text-center">
        <button
          onClick={onViewFullChain}
          className="inline-flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 transition-colors"
        >
          <ExternalLink className="w-4 h-4" />
          <span>View Full Option Chain</span>
        </button>
      </div>

      {/* CTA */}
      <Button
        onClick={onContinue}
        disabled={!selectedPutStrike && !selectedCallStrike}
        className="w-full py-6 text-base"
        size="lg"
      >
        Calculate Size
      </Button>
    </div>
  );
}
