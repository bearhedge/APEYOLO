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
import { OptionChainModal } from '@/components/OptionChainModal';
import { useEngine } from '@/hooks/useEngine';
import { useBrokerStatus } from '@/hooks/useBrokerStatus';
import { useTradeEngineJob } from '@/hooks/useTradeEngineJob';
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
    analyzeEngine,
    executePaperTrade,
  } = useEngine();

  // Unified broker status hook
  const { connected: brokerConnectedHook, environment } = useBrokerStatus();

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
  const [isModalOpen, setIsModalOpen] = useState(false);

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
    if (analysis?.tradeProposal) {
      const legs = analysis.tradeProposal.legs.map(leg => ({
        optionType: leg.optionType,
        action: 'SELL' as const,
        strike: leg.strike,
        delta: leg.delta,
        premium: leg.premium,
        bid: leg.bid || leg.premium,
        ask: leg.ask || leg.premium * 1.1,
      }));

      let entryPremiumTotal = analysis.tradeProposal.entryPremiumTotal;
      const contracts = analysis.tradeProposal.contracts || 1;

      if (entryPremiumTotal === 0 || !entryPremiumTotal) {
        const legPremiumSum = legs.reduce((sum, leg) => sum + (leg.premium || 0), 0);
        entryPremiumTotal = legPremiumSum * contracts * 100;
      }

      const premiumPerShare = legs.reduce((sum, leg) => sum + (leg.premium || 0), 0);
      const maxLoss = analysis.tradeProposal.maxLoss ||
        (premiumPerShare * (stopMultiplier - 1) * contracts * 100);

      const proposalId = analysis.tradeProposal.proposalId || `engine-${Date.now()}`;
      const proposal: TradeProposal = {
        proposalId,
        symbol: analysis.tradeProposal.symbol || selectedSymbol,
        expiration: analysis.tradeProposal.expiration || SYMBOL_CONFIG[selectedSymbol].expiration,
        expirationDate: analysis.tradeProposal.expirationDate,
        createdAt: new Date().toISOString(),
        strategy: analysis.tradeProposal.strategy,
        bias: analysis.tradeProposal.bias,
        legs,
        contracts,
        entryPremiumTotal,
        entryPremiumPerContract: entryPremiumTotal / contracts,
        marginRequired: analysis.tradeProposal.marginRequired || 0,
        maxLoss,
        stopLossPrice: analysis.tradeProposal.stopLossPrice || (premiumPerShare * stopMultiplier),
        stopLossAmount: maxLoss,
        takeProfitPrice: null,
        timeStop: analysis.tradeProposal.expirationDate,
        context: {
          vix: analysis.q1MarketRegime?.inputs?.vixValue ?? 0,
          vixRegime: analysis.q1MarketRegime?.vixRegime ?? 'NORMAL',
          spyPrice: analysis.q1MarketRegime?.inputs?.spyPrice ?? 0,
          directionConfidence: analysis.q2Direction?.confidence ?? 50,
          riskProfile: riskTier,
        },
      };
      setLocalProposal(proposal);
    }
  }, [analysis?.tradeProposal, analysis?.q1MarketRegime, analysis?.q2Direction, selectedSymbol, stopMultiplier, riskTier]);

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

  // Handle Step 1: Analyze direction
  const handleAnalyze = useCallback(async () => {
    try {
      setIsExecuting(true);
      toast.loading('Analyzing market conditions...', { id: 'engine-analyze' });

      const result = await analyzeEngine({
        riskTier,
        stopMultiplier,
        symbol: selectedSymbol,
        strategy: strategyPreference
      });

      if (result.canTrade) {
        // Set default strikes from engine recommendation
        if (result.q3Strikes?.smartCandidates) {
          setSelectedPutStrike(result.q3Strikes.selectedPut?.strike ?? null);
          setSelectedCallStrike(result.q3Strikes.selectedCall?.strike ?? null);
        }

        toast.success('Analysis complete!', { id: 'engine-analyze' });
        advanceStep();
      } else {
        toast.error(`Cannot trade: ${result.reason}`, { id: 'engine-analyze' });
      }
    } catch (err: any) {
      console.error('[Engine] Analyze error:', err);
      toast.error(err.message || 'Failed to analyze market', { id: 'engine-analyze' });
    } finally {
      setIsExecuting(false);
    }
  }, [analyzeEngine, riskTier, stopMultiplier, selectedSymbol, strategyPreference, advanceStep]);

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
  const effectiveDirection = directionOverride || analysis?.q2Direction?.recommendedDirection || 'STRANGLE';
  const confidence = analysis?.q2Direction?.confidence ?? 50;
  const signals = analysis?.q2Direction?.signals ?
    Object.entries(analysis.q2Direction.signals)
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
  const premiumPerContract = analysis?.q3Strikes?.expectedPremiumPerContract
    ? analysis.q3Strikes.expectedPremiumPerContract / 100
    : 0;
  const marginPerContract = analysis?.q4Size?.marginPerContract ?? 0;
  const accountValue = analysis?.q4Size?.inputs?.accountValue ?? 0;
  const maxRiskPercent = accountValue > 0
    ? ((premiumPerContract * recommendedContracts * 100 * (stopMultiplier - 1)) / accountValue) * 100
    : 0;

  // Get market data from analysis or use placeholders
  const spyPrice = analysis?.q1MarketRegime?.inputs?.spyPrice ?? 0;
  const vixValue = analysis?.q1MarketRegime?.inputs?.vixValue ?? 0;

  // Render current step content
  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <Step1Market
            spyPrice={spyPrice}
            spyChangePct={analysis?.q1MarketRegime?.inputs?.spyChangePct ?? 0}
            vix={vixValue}
            vwap={spyPrice}
            ivRank={50}
            dayLow={spyPrice * 0.995}
            dayHigh={spyPrice * 1.005}
            marketOpen={status?.tradingWindowOpen ?? false}
            onAnalyze={handleAnalyze}
            isLoading={isExecuting || loading}
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
            isComplete={!!analysis?.q2Direction}
          />
        );

      case 3:
        return (
          <Step3Strikes
            underlyingPrice={analysis?.q3Strikes?.underlyingPrice ?? spyPrice}
            putCandidates={analysis?.q3Strikes?.smartCandidates?.puts ?? []}
            callCandidates={analysis?.q3Strikes?.smartCandidates?.calls ?? []}
            selectedPutStrike={selectedPutStrike}
            selectedCallStrike={selectedCallStrike}
            recommendedPutStrike={analysis?.q3Strikes?.selectedPut?.strike ?? null}
            recommendedCallStrike={analysis?.q3Strikes?.selectedCall?.strike ?? null}
            onPutSelect={setSelectedPutStrike}
            onCallSelect={setSelectedCallStrike}
            onViewFullChain={() => setIsModalOpen(true)}
            onContinue={handleStrikeContinue}
            expectedPremium={premiumPerContract}
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
            guardRailsPassed={analysis?.guardRails?.passed ?? true}
            violations={analysis?.guardRails?.violations ?? []}
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
          engineLog={analysis?.enhancedLog ?? null}
          isRunning={isExecuting}
        >
          {renderStepContent()}
        </EngineWizardLayout>
      </div>

      {/* Full Option Chain Modal */}
      {analysis?.q3Strikes?.smartCandidates && (
        <OptionChainModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          underlyingPrice={analysis.q3Strikes.underlyingPrice}
          vix={analysis.q1MarketRegime?.inputs?.vixValue ?? undefined}
          lastUpdate={new Date().toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'America/New_York'
          }) + ' ET'}
          putCandidates={analysis.q3Strikes.smartCandidates.puts}
          callCandidates={analysis.q3Strikes.smartCandidates.calls}
          rejectedStrikes={analysis.q3Strikes.rejectedStrikes}
          selectedPutStrike={selectedPutStrike}
          selectedCallStrike={selectedCallStrike}
          onPutSelect={setSelectedPutStrike}
          onCallSelect={setSelectedCallStrike}
          onConfirmSelection={handleStrikeContinue}
          isConfirming={isExecuting}
        />
      )}
    </div>
  );
}
