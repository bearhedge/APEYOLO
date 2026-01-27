/**
 * Step3Strikes - Strike Selection (Table View with Streaming)
 *
 * Two-column table layout showing 7 strikes per side (3 above + recommended + 3 below).
 * Click any row to select. Real-time streaming of bid/ask/delta via WebSocket.
 */

import { useMemo, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Star, TrendingUp, TrendingDown, Loader2 } from 'lucide-react';
import { useMarketSnapshot } from '@/hooks/useMarketSnapshot';
import { useOptionChainStream, StreamedStrike } from '@/hooks/useOptionChainStream';
import type { SmartStrikeCandidate } from '@shared/types/engine';

interface Step3StrikesProps {
  underlyingPrice: number;
  putCandidates: SmartStrikeCandidate[];
  callCandidates: SmartStrikeCandidate[];
  selectedPutStrike: number | null;
  selectedCallStrike: number | null;
  recommendedPutStrike: number | null;
  recommendedCallStrike: number | null;
  onPutSelect: (strike: number | null) => void;
  onCallSelect: (strike: number | null) => void;
  onContinue: () => void;
  expectedPremium: number;
  isStreamLoading?: boolean;
  streamLoadingMessage?: string;
  /** Whether this step is currently active (enables keyboard navigation) */
  isActive?: boolean;
}

/**
 * Get 7 visible strikes centered around the recommended strike
 */
function getVisibleStrikes(
  candidates: SmartStrikeCandidate[],
  recommendedStrike: number | null,
  ascending: boolean = true
): SmartStrikeCandidate[] {
  if (candidates.length === 0) return [];
  if (candidates.length <= 10) return candidates;

  // Sort by strike
  const sorted = [...candidates].sort((a, b) =>
    ascending ? a.strike - b.strike : b.strike - a.strike
  );

  // If no recommended, return first 10
  if (!recommendedStrike) return sorted.slice(0, 10);

  // Find index of recommended
  const recIdx = sorted.findIndex(c => c.strike === recommendedStrike);
  if (recIdx === -1) return sorted.slice(0, 10);

  // Get 5 above, recommended, 4 below (centered)
  const start = Math.max(0, recIdx - 5);
  const end = Math.min(sorted.length, start + 10);
  const adjustedStart = end === sorted.length ? Math.max(0, sorted.length - 10) : start;

  return sorted.slice(adjustedStart, adjustedStart + 10);
}

/**
 * Strike row component for the table
 */
interface StrikeRowProps {
  candidate: SmartStrikeCandidate;
  streamedData?: StreamedStrike;
  isSelected: boolean;
  isRecommended: boolean;
  optionType: 'PUT' | 'CALL';
  onSelect: () => void;
}

function StrikeRow({
  candidate,
  streamedData,
  isSelected,
  isRecommended,
  optionType,
  onSelect,
}: StrikeRowProps) {
  // Use streamed data if available, otherwise use candidate data
  const bid = streamedData?.bid ?? candidate.bid;
  const ask = streamedData?.ask ?? candidate.ask;
  const delta = streamedData?.delta ?? candidate.delta;

  const rowClasses = [
    'grid grid-cols-4 gap-2 px-3 py-3 rounded-lg cursor-pointer transition-all min-h-[44px]',
    isSelected
      ? 'bg-blue-500/20 border-l-2 border-l-blue-500 border border-blue-500/30'
      : isRecommended
      ? 'bg-amber-500/10 border border-amber-500/30'
      : 'bg-zinc-900/50 border border-zinc-800 hover:bg-zinc-700/50 hover:border-zinc-600',
  ].join(' ');

  const colorClass = optionType === 'PUT' ? 'text-red-400' : 'text-green-400';

  return (
    <div className={rowClasses} onClick={onSelect}>
      {/* Strike */}
      <div className="flex items-center gap-1">
        {isRecommended && <Star className="w-3 h-3 text-amber-400 fill-amber-400" />}
        <span className="font-mono font-semibold text-white">${candidate.strike}</span>
      </div>

      {/* Bid */}
      <div className="text-right">
        <span className="font-mono text-green-400">{bid.toFixed(2)}</span>
      </div>

      {/* Ask */}
      <div className="text-right">
        <span className="font-mono text-zinc-400">{ask.toFixed(2)}</span>
      </div>

      {/* Delta */}
      <div className="text-right">
        <span className={`font-mono ${colorClass}`}>
          {optionType === 'PUT' ? Math.abs(delta).toFixed(2) : delta.toFixed(2)}
        </span>
      </div>
    </div>
  );
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
  onContinue,
  expectedPremium,
  isStreamLoading = false,
  streamLoadingMessage = '',
  isActive = false,
}: Step3StrikesProps) {
  // Live market data (same as Step 1)
  const { snapshot } = useMarketSnapshot();
  const livePrice = snapshot?.spyPrice ?? underlyingPrice;
  const spyChangePct = snapshot?.spyChangePct ?? 0;
  const spyBid = snapshot?.spyBid ?? null;
  const spyAsk = snapshot?.spyAsk ?? null;
  const source = snapshot?.source ?? 'none';
  const marketState = snapshot?.marketState ?? 'CLOSED';

  // Refs to avoid stale closures in keyboard handler
  const putCandidatesRef = useRef(putCandidates);
  const callCandidatesRef = useRef(callCandidates);
  putCandidatesRef.current = putCandidates;
  callCandidatesRef.current = callCandidates;

  // Keyboard navigation handler
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const puts = putCandidatesRef.current;
    const calls = callCandidatesRef.current;

    // Handle PUT strikes with ↑/↓
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (puts.length === 0) return;
      e.preventDefault(); // Stop page scroll

      // Sort descending (higher strikes first - more OTM for puts)
      const sortedPuts = [...puts].sort((a, b) => b.strike - a.strike);
      const currentIdx = selectedPutStrike
        ? sortedPuts.findIndex(c => c.strike === selectedPutStrike)
        : -1;

      let newIdx: number;
      if (currentIdx === -1) {
        // No selection - start at recommended or first
        const recIdx = recommendedPutStrike
          ? sortedPuts.findIndex(c => c.strike === recommendedPutStrike)
          : 0;
        newIdx = recIdx >= 0 ? recIdx : 0;
      } else {
        // ↑ moves to higher strike (lower index), ↓ moves to lower strike (higher index)
        newIdx = e.key === 'ArrowUp'
          ? Math.max(0, currentIdx - 1)
          : Math.min(sortedPuts.length - 1, currentIdx + 1);
      }

      if (sortedPuts[newIdx]) {
        onPutSelect(sortedPuts[newIdx].strike);
      }
    }

    // Handle CALL strikes with ←/→
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (calls.length === 0) return;
      e.preventDefault(); // Stop page scroll

      // Sort ascending (lower strikes first - more ITM, higher strikes are more OTM for calls)
      const sortedCalls = [...calls].sort((a, b) => a.strike - b.strike);
      const currentIdx = selectedCallStrike
        ? sortedCalls.findIndex(c => c.strike === selectedCallStrike)
        : -1;

      let newIdx: number;
      if (currentIdx === -1) {
        // No selection - start at recommended or first
        const recIdx = recommendedCallStrike
          ? sortedCalls.findIndex(c => c.strike === recommendedCallStrike)
          : 0;
        newIdx = recIdx >= 0 ? recIdx : 0;
      } else {
        // → moves to higher strike (more OTM), ← moves to lower strike (more ITM)
        newIdx = e.key === 'ArrowRight'
          ? Math.min(sortedCalls.length - 1, currentIdx + 1)
          : Math.max(0, currentIdx - 1);
      }

      if (sortedCalls[newIdx]) {
        onCallSelect(sortedCalls[newIdx].strike);
      }
    }

    // Handle Enter to continue
    if (e.key === 'Enter' && (selectedPutStrike || selectedCallStrike)) {
      e.preventDefault();
      onContinue();
    }
  }, [selectedPutStrike, selectedCallStrike, recommendedPutStrike, recommendedCallStrike, onPutSelect, onCallSelect, onContinue]);

  // Attach/detach keyboard listener based on isActive
  useEffect(() => {
    if (!isActive) return;

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, handleKeyDown]);

  // Get visible strikes (7 per side)
  const visiblePuts = useMemo(
    () => getVisibleStrikes(putCandidates, recommendedPutStrike, false), // descending for puts
    [putCandidates, recommendedPutStrike]
  );

  const visibleCalls = useMemo(
    () => getVisibleStrikes(callCandidates, recommendedCallStrike, true), // ascending for calls
    [callCandidates, recommendedCallStrike]
  );

  // Streaming option data
  const putStrikesToStream = useMemo(() => visiblePuts.map(c => c.strike), [visiblePuts]);
  const callStrikesToStream = useMemo(() => visibleCalls.map(c => c.strike), [visibleCalls]);

  const { streamedPuts, streamedCalls, isStreaming } = useOptionChainStream({
    symbol: 'SPY',
    putStrikes: putStrikesToStream,
    callStrikes: callStrikesToStream,
    enabled: true,
  });

  // Find selected candidates for premium calculation
  const selectedPut = putCandidates.find(c => c.strike === selectedPutStrike);
  const selectedCall = callCandidates.find(c => c.strike === selectedCallStrike);

  // Calculate total premium from selected strikes
  const totalPremium = useMemo(() => {
    let total = 0;
    if (selectedPut) {
      const streamed = streamedPuts.get(selectedPut.strike);
      total += streamed?.bid ?? selectedPut.bid;
    }
    if (selectedCall) {
      const streamed = streamedCalls.get(selectedCall.strike);
      total += streamed?.bid ?? selectedCall.bid;
    }
    return total || expectedPremium;
  }, [selectedPut, selectedCall, streamedPuts, streamedCalls, expectedPremium]);

  return (
    <div className="space-y-6">
      {/* Stream Loading Indicator */}
      {isStreamLoading && (
        <div className="flex items-center justify-center gap-3 p-4 bg-blue-500/10 rounded-lg border border-blue-500/30">
          <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />
          <span className="text-sm text-blue-400 font-medium">
            {streamLoadingMessage || 'Connecting to option chain...'}
          </span>
        </div>
      )}

      {/* Live Price Display (matches Step 1) */}
      <div className="text-center p-4 bg-zinc-900/50 rounded-lg border border-zinc-800">
        <div className="flex items-center justify-center gap-2 mb-2">
          {/* Source Badge */}
          <div className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium uppercase tracking-wider ${
            source === 'ibkr' || source === 'ibkr-sse'
              ? 'bg-green-500/20 text-green-400 border border-green-500/30'
              : 'bg-red-500/20 text-red-400 border border-red-500/30'
          }`}>
            {source === 'ibkr' || source === 'ibkr-sse' ? 'LIVE' : 'NO DATA'}
          </div>
          {isStreaming && (
            <>
              <div className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30">
                OPTIONS STREAMING
              </div>
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                </span>
                REC
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-center gap-3 mb-1">
          <span className="text-4xl font-bold font-mono text-white">${livePrice.toFixed(2)}</span>
          <div className={`flex items-center gap-1 text-xl font-semibold ${
            spyChangePct >= 0 ? 'text-green-400' : 'text-red-400'
          }`}>
            {spyChangePct >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
            <span className="font-mono">{spyChangePct >= 0 ? '+' : ''}{spyChangePct.toFixed(2)}%</span>
          </div>
        </div>

        <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">SPY Current Price</p>

        {/* Bid/Ask Display */}
        {(spyBid || spyAsk) && (
          <div className="flex items-center justify-center gap-4 text-sm">
            <span className="text-zinc-500">
              Bid: <span className="font-mono text-zinc-300">${spyBid?.toFixed(2) ?? '—'}</span>
            </span>
            <span className="text-zinc-600">|</span>
            <span className="text-zinc-500">
              Ask: <span className="font-mono text-zinc-300">${spyAsk?.toFixed(2) ?? '—'}</span>
            </span>
          </div>
        )}
      </div>

      {/* Strike Tables */}
      <div className="grid grid-cols-2 gap-4">
        {/* PUT Table */}
        <div className="space-y-2">
          <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
            <h4 className="text-sm font-semibold text-red-400 uppercase tracking-wider">PUT</h4>
            <span className="text-xs text-zinc-500">Click to select</span>
          </div>

          {/* Table Header */}
          <div className="grid grid-cols-4 gap-2 px-3 py-1 text-xs text-zinc-500 uppercase tracking-wider">
            <div>Strike</div>
            <div className="text-right">Bid</div>
            <div className="text-right">Ask</div>
            <div className="text-right">Delta</div>
          </div>

          {/* Table Rows */}
          <div className="space-y-1">
            {visiblePuts.length > 0 ? (
              visiblePuts.map((candidate) => (
                <StrikeRow
                  key={candidate.strike}
                  candidate={candidate}
                  streamedData={streamedPuts.get(candidate.strike)}
                  isSelected={selectedPutStrike === candidate.strike}
                  isRecommended={recommendedPutStrike === candidate.strike}
                  optionType="PUT"
                  onSelect={() => onPutSelect(selectedPutStrike === candidate.strike ? null : candidate.strike)}
                />
              ))
            ) : (
              <div className="text-center py-4 text-zinc-500 text-sm">No PUT strikes available</div>
            )}
          </div>
        </div>

        {/* CALL Table */}
        <div className="space-y-2">
          <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
            <h4 className="text-sm font-semibold text-green-400 uppercase tracking-wider">CALL</h4>
            <span className="text-xs text-zinc-500">Click to select</span>
          </div>

          {/* Table Header */}
          <div className="grid grid-cols-4 gap-2 px-3 py-1 text-xs text-zinc-500 uppercase tracking-wider">
            <div>Strike</div>
            <div className="text-right">Bid</div>
            <div className="text-right">Ask</div>
            <div className="text-right">Delta</div>
          </div>

          {/* Table Rows */}
          <div className="space-y-1">
            {visibleCalls.length > 0 ? (
              visibleCalls.map((candidate) => (
                <StrikeRow
                  key={candidate.strike}
                  candidate={candidate}
                  streamedData={streamedCalls.get(candidate.strike)}
                  isSelected={selectedCallStrike === candidate.strike}
                  isRecommended={recommendedCallStrike === candidate.strike}
                  optionType="CALL"
                  onSelect={() => onCallSelect(selectedCallStrike === candidate.strike ? null : candidate.strike)}
                />
              ))
            ) : (
              <div className="text-center py-4 text-zinc-500 text-sm">No CALL strikes available</div>
            )}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 text-xs text-zinc-500">
        <div className="flex items-center gap-1">
          <Star className="w-3 h-3 text-amber-400 fill-amber-400" />
          <span>Engine Recommended</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-blue-500/30 border border-blue-500 rounded" />
          <span>Your Selection</span>
        </div>
      </div>

      {/* Keyboard Navigation Hint */}
      {isActive && (putCandidates.length > 0 || callCandidates.length > 0) && (
        <div className="flex items-center justify-center gap-4 py-2 text-xs text-zinc-500 bg-zinc-900/30 rounded border border-zinc-800">
          {putCandidates.length > 0 && <span className="font-mono">[↑↓ PUT]</span>}
          {callCandidates.length > 0 && <span className="font-mono">[←→ CALL]</span>}
          <span className="font-mono">[ENTER: Continue]</span>
        </div>
      )}

      {/* Total Premium Display */}
      <div className="p-4 bg-green-500/5 rounded-lg border border-green-500/20">
        <div className="flex items-center justify-between">
          <span className="text-sm text-zinc-400 uppercase tracking-wider">Total Premium (per contract)</span>
          <span className="text-2xl font-bold font-mono text-green-400">${totalPremium.toFixed(2)}</span>
        </div>
      </div>

      {/* CTA */}
      <Button
        onClick={onContinue}
        disabled={!selectedPutStrike && !selectedCallStrike}
        className="w-full py-6 text-base bg-green-600 hover:bg-green-700"
        size="lg"
      >
        APE IN
      </Button>
    </div>
  );
}
