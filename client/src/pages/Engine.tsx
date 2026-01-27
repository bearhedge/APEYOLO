import { useState, useCallback, useEffect, useMemo } from 'react';
import { LeftNav } from '@/components/LeftNav';
import {
  EngineWizardLayout,
  Step1Market,
  Step3Strikes,
  type StepId,
} from '@/components/engine';
import { useEngine } from '@/hooks/useEngine';
// useAgentEngineStream removed - now processing activities from parent directly
import { useBrokerStatus } from '@/hooks/useBrokerStatus';
import { useTradeEngineJob } from '@/hooks/useTradeEngineJob';
import { useMarketSnapshot } from '@/hooks/useMarketSnapshot';
import toast from 'react-hot-toast';
import type { TradeDirection, TradeProposal, StrategyPreference } from '@shared/types/engine';

type RiskTier = 'conservative' | 'balanced' | 'aggressive';
type StopMultiplier = 2 | 3 | 4;
type TradingSymbol = 'SPY';

// Symbol configuration for display
const SYMBOL_CONFIG: Record<TradingSymbol, { name: string; label: string; expiration: string }> = {
  SPY: { name: 'SPY', label: 'S&P 500 ETF', expiration: 'Daily' },
};

interface EngineProps {
  /** Hide LeftNav when embedded in another page (e.g., Trade page) */
  hideLeftNav?: boolean;
  /** Callback to trigger analysis */
  onAnalyze?: () => void;
  /** Is engine currently analyzing? */
  isAnalyzing?: boolean;
  /** Current step number (1-5) from streaming */
  currentStep?: number;
  /** Set of completed step numbers from streaming */
  completedSteps?: Set<number>;
  /** Final analysis result from stream */
  streamAnalysis?: any;
  /** Error from stream */
  streamError?: string | null;
  /** Callback when user changes strategy selection */
  onStrategyPrefChange?: (strategy: StrategyPreference) => void;
}

export function Engine({
  hideLeftNav = false,
  onAnalyze,
  isAnalyzing = false,
  currentStep: propCurrentStep,
  completedSteps: propCompletedSteps,
  streamAnalysis,
  streamError,
  onStrategyPrefChange,
}: EngineProps = {}) {
  const {
    status,
    brokerConnected,
    analysis,
    loading,
    fetchStatus,
    executePaperTrade,
  } = useEngine();

  // Use props for step tracking when analyzing via streaming
  const streamCurrentStep = propCurrentStep ?? 1;
  const streamCompletedSteps = propCompletedSteps ?? new Set<number>();
  const streamIsRunning = isAnalyzing;

  // Merge stream analysis with useEngine analysis
  const effectiveAnalysis = useMemo(() => {
    // Prefer stream analysis when available (from useEngineAnalysis)
    if (streamAnalysis) {
      console.log('[Engine] Using streamAnalysis, q3Strikes:', JSON.stringify({
        hasQ3Strikes: !!streamAnalysis.q3Strikes,
        smartCandidatesPuts: streamAnalysis.q3Strikes?.smartCandidates?.puts?.length ?? 'undefined',
        smartCandidatesCalls: streamAnalysis.q3Strikes?.smartCandidates?.calls?.length ?? 'undefined',
        selectedPut: streamAnalysis.q3Strikes?.selectedPut?.strike ?? 'null',
        selectedCall: streamAnalysis.q3Strikes?.selectedCall?.strike ?? 'null',
        candidates: streamAnalysis.q3Strikes?.candidates?.length ?? 'undefined',
      }));
      return streamAnalysis;
    }
    // Fall back to useEngine analysis
    return analysis;
  }, [streamAnalysis, analysis]);

  // Unified broker status hook
  const { connected: brokerConnectedHook, environment } = useBrokerStatus();

  // Real-time market data (shows before analysis runs)
  const { snapshot: marketSnapshot, connectionStatus, dataSourceMode } = useMarketSnapshot();

  // Automation toggle
  const { isEnabled: automationEnabled, setEnabled: setAutomationEnabled, isUpdating: isUpdatingAutomation } = useTradeEngineJob();

  // Use hook value if available
  const brokerConnectedFinal = brokerConnectedHook ?? brokerConnected;

  // Wizard state
  const [currentStep, setCurrentStep] = useState<StepId>(1);
  const [completedSteps, setCompletedSteps] = useState<Set<StepId>>(new Set());

  // Merge streaming steps with manual UI navigation
  const mergedCurrentStep = streamIsRunning ? streamCurrentStep : currentStep;
  const mergedCompletedSteps = new Set([...streamCompletedSteps, ...completedSteps]);

  // Trading state
  const [isExecuting, setIsExecuting] = useState(false);
  const [riskTier, setRiskTier] = useState<RiskTier>('balanced');
  const [stopMultiplier, setStopMultiplier] = useState<StopMultiplier>(3);
  const [selectedSymbol] = useState<TradingSymbol>('SPY');
  const [strategyPreference, setStrategyPreference] = useState<StrategyPreference>('strangle');

  // Strike selection state
  const [selectedPutStrike, setSelectedPutStrike] = useState<number | null>(null);
  const [selectedCallStrike, setSelectedCallStrike] = useState<number | null>(null);

  // Direction override state
  const [directionOverride, setDirectionOverride] = useState<TradeDirection | null>(null);

  // Local trade proposal (can be modified by user)
  const [localProposal, setLocalProposal] = useState<TradeProposal | null>(null);

  // Auto-connect to IBKR when page loads
  useEffect(() => {
    const connectBroker = async () => {
      try {
        await fetch('/api/ibkr/test', {
          method: 'POST',
          credentials: 'include'
        });
        fetchStatus();
      } catch (err) {
        console.error('[Engine] Auto-connect error:', err);
      }
    };
    connectBroker();
  }, [fetchStatus]);

  // Sync localProposal when analysis.tradeProposal changes or user selects different strikes
  useEffect(() => {
    if (effectiveAnalysis?.tradeProposal) {
      // Get all available candidates (same logic as Step 3 UI uses)
      const smartPuts = effectiveAnalysis.q3Strikes?.smartCandidates?.puts ?? [];
      const smartCalls = effectiveAnalysis.q3Strikes?.smartCandidates?.calls ?? [];

      // Fallback to regular candidates if smartCandidates is empty
      const allCandidates = effectiveAnalysis.q3Strikes?.candidates ?? [];
      const fallbackPuts = smartPuts.length === 0
        ? allCandidates.filter((c: any) => c.optionType === 'PUT')
        : [];
      const fallbackCalls = smartCalls.length === 0
        ? allCandidates.filter((c: any) => c.optionType === 'CALL')
        : [];

      const putCandidates = smartPuts.length > 0 ? smartPuts : fallbackPuts;
      const callCandidates = smartCalls.length > 0 ? smartCalls : fallbackCalls;

      // Build legs using user-selected strikes (not just engine recommendations)
      const legs = effectiveAnalysis.tradeProposal.legs.map(leg => {
        // Check if user selected a different strike than the engine recommended
        const userStrike = leg.optionType === 'PUT' ? selectedPutStrike : selectedCallStrike;
        const candidates = leg.optionType === 'PUT' ? putCandidates : callCandidates;

        // Find the user-selected candidate (or fall back to engine's choice)
        const selectedCandidate = userStrike ? candidates.find((c: any) => c.strike === userStrike) : null;
        const finalStrike = selectedCandidate?.strike ?? leg.strike;
        const finalDelta = selectedCandidate?.delta ?? leg.delta;
        const finalBid = selectedCandidate?.bid ?? leg.bid ?? leg.premium;

        return {
          optionType: leg.optionType,
          action: 'SELL' as const,
          strike: finalStrike,
          delta: finalDelta,
          premium: finalBid,
          bid: finalBid,
          ask: selectedCandidate?.ask ?? leg.ask ?? leg.premium * 1.1,
        };
      });

      let entryPremiumTotal = effectiveAnalysis.tradeProposal.entryPremiumTotal;
      const contracts = effectiveAnalysis.tradeProposal.contracts || 1;

      // Recalculate premium based on actual selected strikes
      const legPremiumSum = legs.reduce((sum, leg) => sum + (leg.premium || 0), 0);
      entryPremiumTotal = legPremiumSum * contracts * 100;

      const premiumPerShare = legs.reduce((sum, leg) => sum + (leg.premium || 0), 0);
      // Always calculate based on multiplier (user controls via buttons)
      const stopLossPrice = premiumPerShare * stopMultiplier;
      const maxLoss = premiumPerShare * (stopMultiplier - 1) * contracts * 100;

      const proposalId = effectiveAnalysis.tradeProposal.proposalId || `engine-${Date.now()}`;
      const proposal: TradeProposal = {
        proposalId,
        symbol: effectiveAnalysis.tradeProposal.symbol || selectedSymbol,
        expiration: effectiveAnalysis.tradeProposal.expiration || SYMBOL_CONFIG[selectedSymbol].expiration,
        expirationDate: effectiveAnalysis.tradeProposal.expirationDate,
        createdAt: new Date().toISOString(),
        strategy: effectiveAnalysis.tradeProposal.strategy,
        bias: effectiveAnalysis.tradeProposal.bias,
        legs,
        contracts,
        entryPremiumTotal,
        entryPremiumPerContract: entryPremiumTotal / contracts,
        marginRequired: effectiveAnalysis.tradeProposal.marginRequired || 0,
        maxLoss,
        stopLossPrice,
        stopLossAmount: maxLoss,
        takeProfitPrice: null,
        timeStop: effectiveAnalysis.tradeProposal.expirationDate,
        context: {
          vix: effectiveAnalysis.q1MarketRegime?.inputs?.vixValue ?? 0,
          vixRegime: effectiveAnalysis.q1MarketRegime?.vixRegime ?? 'NORMAL',
          spyPrice: effectiveAnalysis.q1MarketRegime?.inputs?.spyPrice ?? 0,
          directionConfidence: effectiveAnalysis.q2Direction?.confidence ?? 50,
          riskProfile: riskTier,
        },
      };
      setLocalProposal(proposal);
    }
  }, [effectiveAnalysis?.tradeProposal, effectiveAnalysis?.q1MarketRegime, effectiveAnalysis?.q2Direction, effectiveAnalysis?.q3Strikes, selectedSymbol, stopMultiplier, riskTier, selectedPutStrike, selectedCallStrike]);

  // Handle step navigation
  const handleStepClick = useCallback((step: StepId) => {
    // Can only go back to completed steps, not forward
    if (completedSteps.has(step) || step < currentStep) {
      setCurrentStep(step);
    }
  }, [completedSteps, currentStep]);

  // Advance to next step
  const advanceStep = useCallback(() => {
    setCompletedSteps(prev => new Set([...prev, currentStep]));
    if (currentStep < 3) {
      setCurrentStep((currentStep + 1) as StepId);
    }
  }, [currentStep]);

  // Handle Step 1: Analyze direction (uses SSE streaming)
  const handleAnalyze = useCallback(() => {
    console.log('[Engine] handleAnalyze called');
    console.log('[Engine] onAnalyze exists:', !!onAnalyze);

    if (!onAnalyze) {
      console.log('[Engine] onAnalyze is missing - showing error toast');
      toast.error('Engine can only run through Agent. Use /trade page.', { id: 'engine-analyze' });
      return;
    }

    console.log('[Engine] Calling onAnalyze');
    onAnalyze();
    toast.loading('Agent analyzing...', { id: 'engine-analyze' });
  }, [onAnalyze]);

  // Handle streaming completion
  useEffect(() => {
    if (streamAnalysis && !streamIsRunning) {
      // Streaming just completed
      if (streamAnalysis.canTrade) {
        // Set default strikes from engine recommendation
        if (streamAnalysis.q3Strikes?.smartCandidates) {
          setSelectedPutStrike(streamAnalysis.q3Strikes.selectedPut?.strike ?? null);
          setSelectedCallStrike(streamAnalysis.q3Strikes.selectedCall?.strike ?? null);
        }

        toast.success('Analysis complete! Select your strikes.', { id: 'engine-analyze' });
        // Mark step 1 as completed and advance to step 2 (Strikes)
        setCompletedSteps(new Set([1]));
        setCurrentStep(2); // Advance to step 2 (Strikes) so user can select
      } else {
        toast.error(`Cannot trade: ${streamAnalysis.reason}`, { id: 'engine-analyze' });
      }
    }
  }, [streamAnalysis, streamIsRunning]);


  // Step 3 stream loading state
  const [isStreamLoading, setIsStreamLoading] = useState(false);
  const [streamLoadingMessage, setStreamLoadingMessage] = useState('');

  // Start option chain streaming when entering Step 2 (Strikes)
  useEffect(() => {
    if (currentStep === 2) {
      // Trigger streaming if not already active
      setIsStreamLoading(true);
      setStreamLoadingMessage('Connecting to broker...');

      const startTime = Date.now();

      // Update message based on elapsed time
      const messageInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        if (elapsed > 20000) {
          setStreamLoadingMessage('Subscribing to option strikes...');
        } else if (elapsed > 10000) {
          setStreamLoadingMessage('Processing option chain...');
        } else if (elapsed > 5000) {
          setStreamLoadingMessage('Fetching option chain data...');
        }
      }, 1000);

      fetch('/api/broker/stream/start', {
        method: 'POST',
        body: JSON.stringify({ symbol: 'SPY' }),
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      })
        .then(() => {
          setStreamLoadingMessage('Stream connected');
        })
        .catch(() => {
          console.log('[Engine] Stream start failed - using static option data');
        })
        .finally(() => {
          clearInterval(messageInterval);
          setIsStreamLoading(false);
          setStreamLoadingMessage('');
        });

      return () => clearInterval(messageInterval);
    }
  }, [currentStep]);

  // Handle Step 2: Override direction
  const handleDirectionOverride = useCallback((newDirection: TradeDirection) => {
    setDirectionOverride(newDirection);
    setStrategyPreference(
      newDirection === 'PUT' ? 'put-only' :
      newDirection === 'CALL' ? 'call-only' :
      'strangle'
    );
  }, []);

  // Handle Step 3: Strike selection continue
  const handleStrikeContinue = useCallback(() => {
    if (!selectedPutStrike && !selectedCallStrike) {
      toast.error('Please select at least one strike');
      return;
    }
    advanceStep();
  }, [selectedPutStrike, selectedCallStrike, advanceStep]);

  // Handle Step 4: Risk tier change
  const handleRiskTierChange = useCallback((tier: RiskTier) => {
    setRiskTier(tier);
  }, []);

  // Handle Step 5: Execute trade
  const handleExecuteTrade = useCallback(async () => {
    if (!localProposal) {
      toast.error('No trade proposal available');
      return;
    }

    // Filter legs based on user's strike selections
    const legsToExecute = localProposal.legs.filter(leg => {
      if (leg.optionType === 'PUT') return selectedPutStrike !== null;
      if (leg.optionType === 'CALL') return selectedCallStrike !== null;
      return true;
    });

    if (legsToExecute.length === 0) {
      toast.error('No strikes selected');
      return;
    }

    // Create filtered proposal for execution
    const contracts = localProposal.contracts || 1;
    const entryPremiumTotal = legsToExecute.reduce((sum, leg) => sum + (leg.premium || 0), 0) * contracts * 100;
    const proposalToExecute = {
      ...localProposal,
      legs: legsToExecute,
      entryPremiumTotal,
      entryPremiumPerContract: entryPremiumTotal / contracts,
    };

    if (environment !== 'live') {
      toast('Paper mode: Order goes to paper account', { icon: 'ℹ️' });
    }

    try {
      setIsExecuting(true);
      toast.loading('Executing trade...', { id: 'execute' });

      const result = await executePaperTrade(proposalToExecute);
      toast.success(`Trade executed! ${result.message || 'ID: ' + result.tradeId}`, { id: 'execute' });

      // Mark step 3 (APE IN) complete
      setCompletedSteps(prev => new Set([...prev, 3]));
    } catch (err: any) {
      console.error('[Engine] Execute error:', err);
      toast.error(err.message || 'Failed to execute trade', { id: 'execute' });
    } finally {
      setIsExecuting(false);
    }
  }, [localProposal, selectedPutStrike, selectedCallStrike, executePaperTrade, environment]);

  // Handle cancel: go back to Strikes
  const handleCancel = useCallback(() => {
    setCurrentStep(2);
  }, []);

  // Derived values
  const effectiveDirection = directionOverride || effectiveAnalysis?.q2Direction?.recommendedDirection || 'STRANGLE';
  const confidence = effectiveAnalysis?.q2Direction?.confidence ?? 50;
  const signals = effectiveAnalysis?.q2Direction?.signals ?
    Object.entries(effectiveAnalysis.q2Direction.signals)
      .filter(([key, val]) => val && key !== 'spyPrice')
      .map(([key, val]) => `${key}: ${val}`)
    : [];

  // Get contracts based on risk tier
  const getContractsForTier = (tier: RiskTier): number => {
    switch (tier) {
      case 'conservative': return 1;
      case 'balanced': return 2;
      case 'aggressive': return 3;
    }
  };

  const recommendedContracts = getContractsForTier(riskTier);
  const premiumPerContract = effectiveAnalysis?.q3Strikes?.expectedPremiumPerContract
    ? effectiveAnalysis.q3Strikes.expectedPremiumPerContract / 100
    : 0;
  const marginPerContract = effectiveAnalysis?.q4Size?.marginPerContract ?? 0;
  const accountValue = effectiveAnalysis?.q4Size?.inputs?.accountValue ?? 0;
  const maxRiskPercent = accountValue > 0
    ? ((premiumPerContract * recommendedContracts * 100 * (stopMultiplier - 1)) / accountValue) * 100
    : 0;

  // Filter proposal to only include legs for strikes the user actually selected
  const filteredProposal = useMemo(() => {
    if (!localProposal) return null;

    const filteredLegs = localProposal.legs.filter(leg => {
      if (leg.optionType === 'PUT') return selectedPutStrike !== null;
      if (leg.optionType === 'CALL') return selectedCallStrike !== null;
      return true;
    });

    // Recalculate totals based on filtered legs
    const contracts = localProposal.contracts || 1;
    const entryPremiumTotal = filteredLegs.reduce((sum, leg) => sum + (leg.premium || 0), 0) * contracts * 100;

    return {
      ...localProposal,
      legs: filteredLegs,
      entryPremiumTotal,
      entryPremiumPerContract: entryPremiumTotal / contracts,
    };
  }, [localProposal, selectedPutStrike, selectedCallStrike]);

  // Get market data - ALWAYS use live snapshot for display (analysis data gets stale)
  // Use last traded price when valid, fall back to midpoint when last is stale
  const lastPrice = marketSnapshot?.spyPrice ?? 0;
  const bid = marketSnapshot?.spyBid;
  const ask = marketSnapshot?.spyAsk;
  const midpoint = bid && ask ? (bid + ask) / 2 : null;

  // Check if last price is stale (outside bid/ask range)
  const isLastPriceStale = bid && ask && lastPrice > 0 && (lastPrice < bid || lastPrice > ask);

  // Use midpoint only when last price is clearly stale, otherwise prefer last traded
  const spyPrice = isLastPriceStale && midpoint
    ? midpoint
    : lastPrice || midpoint || 0;
  const vixValue = effectiveAnalysis?.q1MarketRegime?.inputs?.vixValue ?? marketSnapshot?.vix ?? 0;
  // IMPORTANT: Prioritize live market data over cached analysis data
  // The analysis stored in sessionStorage may have stale spyChangePct (e.g., 0)
  // Always prefer the real-time snapshot value for display
  const spyChangePct = marketSnapshot?.spyChangePct ?? effectiveAnalysis?.q1MarketRegime?.inputs?.spyChangePct ?? 0;
  const vixChangePct = marketSnapshot?.vixChangePct ?? 0;
  // Use real day high/low from snapshot, fallback to calculated
  const dayHigh = marketSnapshot?.dayHigh || spyPrice * 1.005;
  const dayLow = marketSnapshot?.dayLow || spyPrice * 0.995;
  const marketState = marketSnapshot?.marketState ?? 'CLOSED';
  const marketOpen = marketState === 'REGULAR' || marketState === 'OVERNIGHT' || status?.tradingWindowOpen;
  const dataSource = marketSnapshot?.source ?? 'none';
  const dataTimestamp = marketSnapshot?.timestamp ?? null;
  // Use real VWAP and IV Rank from snapshot (calculated server-side)
  const vwap = marketSnapshot?.vwap ?? null;
  const ivRank = marketSnapshot?.ivRank ?? null;
  // Bid/Ask and Previous Close for extended hours display
  const spyBid = marketSnapshot?.spyBid ?? null;
  const spyAsk = marketSnapshot?.spyAsk ?? null;
  const spyPrevClose = marketSnapshot?.spyPrevClose ?? null;

  // Render current step content
  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <Step1Market
            spyPrice={spyPrice}
            spyChangePct={spyChangePct}
            spyBid={spyBid}
            spyAsk={spyAsk}
            spyPrevClose={spyPrevClose}
            vix={vixValue}
            vixChangePct={vixChangePct}
            vwap={vwap}
            ivRank={ivRank}
            dayLow={dayLow}
            dayHigh={dayHigh}
            marketOpen={marketOpen ?? false}
            marketState={marketState}
            source={dataSource}
            connectionStatus={connectionStatus}
            dataSourceMode={dataSourceMode}
            timestamp={dataTimestamp}
            strategy={strategyPreference}
            onStrategyChange={(newStrategy) => {
              setStrategyPreference(newStrategy);
              onStrategyPrefChange?.(newStrategy);
            }}
            onAnalyze={handleAnalyze}
            isLoading={isExecuting || loading || streamIsRunning || isAnalyzing}
          />
        );

      case 2:
        // Use smartCandidates if available, fall back to candidates (less filtered)
        const smartPuts = effectiveAnalysis?.q3Strikes?.smartCandidates?.puts ?? [];
        const smartCalls = effectiveAnalysis?.q3Strikes?.smartCandidates?.calls ?? [];

        // Fallback: convert candidates to SmartStrikeCandidate format if smartCandidates is empty
        const convertToSmartCandidate = (c: any, type: 'PUT' | 'CALL', recommendedStrike?: number) => ({
          strike: c.strike,
          optionType: type,
          bid: c.bid,
          ask: c.ask,
          spread: c.ask - c.bid,
          delta: c.delta,
          openInterest: c.openInterest ?? 0,
          yield: c.premium / (effectiveAnalysis?.q3Strikes?.underlyingPrice ?? spyPrice),
          yieldPct: `${((c.premium / (effectiveAnalysis?.q3Strikes?.underlyingPrice ?? spyPrice)) * 100).toFixed(3)}%`,
          qualityScore: 3 as const,
          qualityReasons: ['From candidates fallback'],
          isEngineRecommended: c.strike === recommendedStrike,
          isUserSelected: false,
        });

        const fallbackPuts = smartPuts.length === 0 && effectiveAnalysis?.q3Strikes?.candidates
          ? effectiveAnalysis.q3Strikes.candidates
              .filter((c: any) => c.optionType === 'PUT')
              .map((c: any) => convertToSmartCandidate(c, 'PUT', effectiveAnalysis?.q3Strikes?.selectedPut?.strike))
          : [];
        const fallbackCalls = smartCalls.length === 0 && effectiveAnalysis?.q3Strikes?.candidates
          ? effectiveAnalysis.q3Strikes.candidates
              .filter((c: any) => c.optionType === 'CALL')
              .map((c: any) => convertToSmartCandidate(c, 'CALL', effectiveAnalysis?.q3Strikes?.selectedCall?.strike))
          : [];

        // Filter strikes based on user's strategy selection
        const showPuts = strategyPreference === 'strangle' || strategyPreference === 'put-only';
        const showCalls = strategyPreference === 'strangle' || strategyPreference === 'call-only';

        const putCandidates = showPuts ? (smartPuts.length > 0 ? smartPuts : fallbackPuts) : [];
        const callCandidates = showCalls ? (smartCalls.length > 0 ? smartCalls : fallbackCalls) : [];

        return (
          <Step3Strikes
            underlyingPrice={effectiveAnalysis?.q3Strikes?.underlyingPrice ?? spyPrice}
            putCandidates={putCandidates}
            callCandidates={callCandidates}
            selectedPutStrike={selectedPutStrike}
            selectedCallStrike={selectedCallStrike}
            recommendedPutStrike={effectiveAnalysis?.q3Strikes?.selectedPut?.strike ?? null}
            recommendedCallStrike={effectiveAnalysis?.q3Strikes?.selectedCall?.strike ?? null}
            onPutSelect={setSelectedPutStrike}
            onCallSelect={setSelectedCallStrike}
            onContinue={handleStrikeContinue}
            expectedPremium={premiumPerContract}
            isStreamLoading={isStreamLoading}
            streamLoadingMessage={streamLoadingMessage}
            isActive={currentStep === 2}
          />
        );

      case 3:
        // Combined Review & APE IN step
        if (!filteredProposal || filteredProposal.legs.length === 0) {
          return (
            <div className="text-center py-12 text-zinc-400">
              <p>No trade proposal available. Please select at least one strike.</p>
            </div>
          );
        }

        return (
          <div className="space-y-6">
            {/* Position Summary */}
            <div className="bg-zinc-900/50 rounded-lg p-4 border border-zinc-800">
              <h3 className="text-sm font-medium text-zinc-400 mb-3">Position Summary</h3>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-zinc-500">Contracts:</span>
                  <span className="ml-2 text-white font-mono">{recommendedContracts}</span>
                </div>
                <div>
                  <span className="text-zinc-500">Credit:</span>
                  <span className="ml-2 text-green-400 font-mono">${(premiumPerContract * 100 * recommendedContracts).toFixed(0)}</span>
                </div>
                <div>
                  <span className="text-zinc-500">Max Loss:</span>
                  <span className="ml-2 text-red-400 font-mono">${filteredProposal.maxLoss?.toFixed(0) || 'N/A'}</span>
                </div>
              </div>
            </div>

            {/* Selected Strikes */}
            <div className="bg-zinc-900/50 rounded-lg p-4 border border-zinc-800">
              <h3 className="text-sm font-medium text-zinc-400 mb-3">Selected Strikes</h3>
              <div className="space-y-2">
                {filteredProposal.legs.map((leg, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className={leg.optionType === 'PUT' ? 'text-red-400' : 'text-green-400'}>
                      {leg.optionType} ${leg.strike}
                    </span>
                    <span className="text-zinc-300 font-mono">
                      ${leg.bid?.toFixed(2)} / ${leg.ask?.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Exit Rules */}
            <div className="bg-zinc-900/50 rounded-lg p-4 border border-zinc-800">
              <h3 className="text-sm font-medium text-zinc-400 mb-3">Exit Rules</h3>
              <div className="text-sm text-zinc-300">
                <p>Stop Loss: {stopMultiplier}x premium (${(filteredProposal.entryPremiumTotal * stopMultiplier).toFixed(0)})</p>
                <p>Take Profit: 50% of max profit</p>
              </div>
            </div>

            {/* APE IN Button */}
            <div className="flex gap-3">
              <button
                onClick={handleCancel}
                className="flex-1 px-4 py-3 border border-zinc-700 text-zinc-300 rounded-lg hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleExecuteTrade}
                disabled={isExecuting || !(effectiveAnalysis?.guardRails?.passed ?? true)}
                className="flex-1 px-4 py-3 bg-green-600 hover:bg-green-700 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-semibold rounded-lg transition-colors"
              >
                {isExecuting ? 'Executing...' : 'APE IN'}
              </button>
            </div>

            {/* Guard Rails Warnings */}
            {effectiveAnalysis?.guardRails?.violations?.length > 0 && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                <p className="text-red-400 text-sm font-medium">Guard Rails Violated:</p>
                <ul className="text-red-300 text-xs mt-1">
                  {effectiveAnalysis.guardRails.violations.map((v: string, i: number) => (
                    <li key={i}>• {v}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
    }
  };

  return (
    <div className="flex h-[calc(100vh-64px)]">
      {!hideLeftNav && <LeftNav />}
      <div className="flex-1 overflow-hidden">
        <EngineWizardLayout
          symbol={selectedSymbol}
          brokerConnected={brokerConnectedFinal}
          environment={environment || 'simulation'}
          currentStep={mergedCurrentStep}
          completedSteps={mergedCompletedSteps}
          onStepClick={handleStepClick}
        >
          {renderStepContent()}
        </EngineWizardLayout>
      </div>

    </div>
  );
}
