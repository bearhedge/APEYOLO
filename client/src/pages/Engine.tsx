import { useState, useCallback, useEffect, useMemo } from 'react';
import { LeftNav } from '@/components/LeftNav';
import {
  EngineWizardLayout,
  Step1Market,
  Step2Direction,
  Step3Strikes,
  Step4Size,
  Step5Exit,
  type StepId,
} from '@/components/engine';
import { useEngine } from '@/hooks/useEngine';
import { useEngineStream } from '@/hooks/useEngineStream';
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

export function Engine() {
  const {
    status,
    brokerConnected,
    analysis,
    loading,
    fetchStatus,
    executePaperTrade,
  } = useEngine();

  // SSE streaming for real-time engine log updates
  const {
    isRunning: streamIsRunning,
    engineLog: streamingEngineLog,
    analysis: streamingAnalysis,
    error: streamError,
    startAnalysis,
  } = useEngineStream();

  // Use streaming analysis when available, fall back to regular analysis
  const effectiveAnalysis = streamingAnalysis || analysis;

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

  // Sync localProposal when analysis.tradeProposal changes
  useEffect(() => {
    if (effectiveAnalysis?.tradeProposal) {
      const legs = effectiveAnalysis.tradeProposal.legs.map(leg => ({
        optionType: leg.optionType,
        action: 'SELL' as const,
        strike: leg.strike,
        delta: leg.delta,
        premium: leg.premium,
        bid: leg.bid || leg.premium,
        ask: leg.ask || leg.premium * 1.1,
      }));

      let entryPremiumTotal = effectiveAnalysis.tradeProposal.entryPremiumTotal;
      const contracts = effectiveAnalysis.tradeProposal.contracts || 1;

      if (entryPremiumTotal === 0 || !entryPremiumTotal) {
        const legPremiumSum = legs.reduce((sum, leg) => sum + (leg.premium || 0), 0);
        entryPremiumTotal = legPremiumSum * contracts * 100;
      }

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
  }, [effectiveAnalysis?.tradeProposal, effectiveAnalysis?.q1MarketRegime, effectiveAnalysis?.q2Direction, selectedSymbol, stopMultiplier, riskTier]);

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
    if (currentStep < 5) {
      setCurrentStep((currentStep + 1) as StepId);
    }
  }, [currentStep]);

  // Handle Step 1: Analyze direction (uses SSE streaming)
  const handleAnalyze = useCallback(() => {
    // Start streaming analysis - this will update streamingEngineLog in real-time
    startAnalysis({
      riskTier,
      stopMultiplier,
      symbol: selectedSymbol,
      strategy: strategyPreference
    });
    toast.loading('Analyzing market conditions...', { id: 'engine-analyze' });
  }, [startAnalysis, riskTier, stopMultiplier, selectedSymbol, strategyPreference]);

  // Handle streaming completion
  useEffect(() => {
    if (streamingAnalysis && !streamIsRunning) {
      // Streaming just completed
      if (streamingAnalysis.canTrade) {
        // Set default strikes from engine recommendation
        if (streamingAnalysis.q3Strikes?.smartCandidates) {
          setSelectedPutStrike(streamingAnalysis.q3Strikes.selectedPut?.strike ?? null);
          setSelectedCallStrike(streamingAnalysis.q3Strikes.selectedCall?.strike ?? null);
        }

        toast.success('Analysis complete!', { id: 'engine-analyze' });
        // Skip step 2 (direction) - go straight to step 3 (strikes)
        setCompletedSteps(prev => new Set([...prev, 1, 2]));
        setCurrentStep(3);
      } else {
        toast.error(`Cannot trade: ${streamingAnalysis.reason}`, { id: 'engine-analyze' });
      }
    }
  }, [streamingAnalysis, streamIsRunning]);

  // Handle streaming error
  useEffect(() => {
    if (streamError) {
      console.error('[Engine] Stream error:', streamError);
      toast.error(streamError || 'Failed to analyze market', { id: 'engine-analyze' });
    }
  }, [streamError]);

  // Step 3 stream loading state
  const [isStreamLoading, setIsStreamLoading] = useState(false);
  const [streamLoadingMessage, setStreamLoadingMessage] = useState('');

  // Start option chain streaming when entering Step 3
  useEffect(() => {
    if (currentStep === 3) {
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

    if (environment !== 'live') {
      toast('Paper mode: Order goes to paper account', { icon: 'ℹ️' });
    }

    try {
      setIsExecuting(true);
      toast.loading('Executing trade...', { id: 'execute' });

      const result = await executePaperTrade(localProposal);
      toast.success(`Trade executed! ${result.message || 'ID: ' + result.tradeId}`, { id: 'execute' });

      // Mark step 5 complete
      setCompletedSteps(prev => new Set([...prev, 5]));
    } catch (err: any) {
      console.error('[Engine] Execute error:', err);
      toast.error(err.message || 'Failed to execute trade', { id: 'execute' });
    } finally {
      setIsExecuting(false);
    }
  }, [localProposal, executePaperTrade, environment]);

  // Handle Step 5: Cancel
  const handleCancel = useCallback(() => {
    setCurrentStep(3);
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
            onStrategyChange={setStrategyPreference}
            onAnalyze={handleAnalyze}
            isLoading={isExecuting || loading || streamIsRunning}
          />
        );

      case 2:
        return (
          <Step2Direction
            direction={effectiveDirection}
            confidence={confidence}
            signals={signals}
            onOverride={handleDirectionOverride}
            onContinue={advanceStep}
            isComplete={!!effectiveAnalysis?.q2Direction}
          />
        );

      case 3:
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

        const putCandidates = smartPuts.length > 0 ? smartPuts : fallbackPuts;
        const callCandidates = smartCalls.length > 0 ? smartCalls : fallbackCalls;

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
          />
        );

      case 4:
        return (
          <Step4Size
            riskTier={riskTier}
            onRiskTierChange={handleRiskTierChange}
            accountValue={accountValue}
            recommendedContracts={recommendedContracts}
            premiumPerContract={premiumPerContract * 100}
            marginRequired={marginPerContract}
            maxRiskPercent={maxRiskPercent}
            onContinue={advanceStep}
          />
        );

      case 5:
        if (!localProposal) {
          return (
            <div className="text-center py-12 text-zinc-400">
              <p>No trade proposal available. Please complete previous steps.</p>
            </div>
          );
        }

        return (
          <Step5Exit
            stopMultiplier={stopMultiplier}
            onStopMultiplierChange={(m) => setStopMultiplier(m)}
            proposal={localProposal}
            entryPremium={localProposal.entryPremiumTotal}
            stopLossPrice={localProposal.stopLossPrice || 0}
            maxLoss={localProposal.maxLoss || 0}
            guardRailsPassed={effectiveAnalysis?.guardRails?.passed ?? true}
            violations={effectiveAnalysis?.guardRails?.violations ?? []}
            onExecute={handleExecuteTrade}
            onCancel={handleCancel}
            isExecuting={isExecuting}
          />
        );
    }
  };

  return (
    <div className="flex h-[calc(100vh-64px)]">
      <LeftNav />
      <div className="flex-1 overflow-hidden">
        <EngineWizardLayout
          symbol={selectedSymbol}
          brokerConnected={brokerConnectedFinal}
          environment={environment || 'simulation'}
          currentStep={currentStep}
          completedSteps={completedSteps}
          onStepClick={handleStepClick}
          engineLog={streamingEngineLog ?? effectiveAnalysis?.enhancedLog ?? null}
          isRunning={streamIsRunning || isExecuting}
        >
          {renderStepContent()}
        </EngineWizardLayout>
      </div>

    </div>
  );
}
