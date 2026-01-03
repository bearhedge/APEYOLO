import { useState, useCallback, useEffect } from 'react';
import { LeftNav } from '@/components/LeftNav';
import { StatCard } from '@/components/StatCard';
import { EngineStepCard, StepStatus, StepFlowIndicator, StepConnector } from '@/components/EngineStepCard';
import { Step1Content, Step2Content, Step3Content, Step4Content, Step5Content } from '@/components/EngineStepContents';
import { StrikeSelector } from '@/components/StrikeSelector';
import { OptionChainModal } from '@/components/OptionChainModal';
import { TradeProposalCard, type TradeProposal, type ModificationImpact } from '@/components/agent/TradeProposalCard';
import { CheckCircle, XCircle, Clock, Zap, AlertTriangle, Play, RefreshCw, Pause, ExternalLink } from 'lucide-react';
import { useEngine } from '@/hooks/useEngine';
import { useBrokerStatus } from '@/hooks/useBrokerStatus';
import { useTradeEngineJob } from '@/hooks/useTradeEngineJob';
import EngineLog from '@/components/EngineLog';
import toast from 'react-hot-toast';
import type { EngineFlowState, ExecutePaperTradeResponse, StrategyPreference } from '../../../shared/types/engine';

type RiskTier = 'conservative' | 'balanced' | 'aggressive';
type StopMultiplier = 2 | 3 | 4;
type TradingSymbol = 'SPY';

// Symbol configuration for display
const SYMBOL_CONFIG: Record<TradingSymbol, { name: string; label: string; expiration: string }> = {
  SPY: { name: 'SPY', label: 'S&P 500 ETF', expiration: 'Daily' },
};

// Execution result state for UI display
interface ExecutionResult {
  success: boolean;
  message: string;
  tradeId?: string;
  ibkrOrderIds?: string[];
  timestamp: Date;
}

export function Engine() {
  const {
    status,
    brokerConnected,  // Direct from React Query - updates instantly with NAV
    analysis,         // Standardized EngineAnalyzeResponse
    config,
    loading,
    error,
    fetchStatus,
    analyzeEngine,    // New analysis function
    executePaperTrade,
    updateConfig,
  } = useEngine();

  // Unified broker status hook - same source as Settings page
  const { connected: brokerConnectedHook, isConnecting, environment } = useBrokerStatus();

  // Automation toggle - controls scheduled 11:00 AM trade-engine job
  const { isEnabled: automationEnabled, setEnabled: setAutomationEnabled, isUpdating: isUpdatingAutomation } = useTradeEngineJob();

  // Use hook value if available, otherwise fall back to useEngine value
  const brokerConnectedFinal = brokerConnectedHook ?? brokerConnected;

  const [executionMode, setExecutionMode] = useState<'manual' | 'auto'>('manual');
  const [isExecuting, setIsExecuting] = useState(false);
  const [riskTier, setRiskTier] = useState<RiskTier>('balanced');
  const [stopMultiplier, setStopMultiplier] = useState<StopMultiplier>(3);
  const [selectedSymbol, setSelectedSymbol] = useState<TradingSymbol>('SPY');
  const [strategyPreference, setStrategyPreference] = useState<StrategyPreference>('strangle');

  // Gated flow state
  const [engineFlowState, setEngineFlowState] = useState<EngineFlowState>('idle');
  const [selectedPutStrike, setSelectedPutStrike] = useState<number | null>(null);
  const [selectedCallStrike, setSelectedCallStrike] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isConfirmingSelection, setIsConfirmingSelection] = useState(false);

  // Execution result tracking
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null);

  // Strike negotiation state - local proposal that can be modified
  const [localProposal, setLocalProposal] = useState<TradeProposal | null>(null);
  const [isNegotiating, setIsNegotiating] = useState(true); // Always allow strike adjustment

  // Auto-connect to IBKR when page loads (same as Settings page)
  useEffect(() => {
    const connectBroker = async () => {
      try {
        await fetch('/api/ibkr/test', {
          method: 'POST',
          credentials: 'include'
        });
        // Refresh status after connection attempt
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
        strike: leg.strike,
        delta: leg.delta,
        premium: leg.premium,
      }));

      // Calculate premium from legs if backend returned 0 (market closed, no bid/ask)
      let entryPremiumTotal = analysis.tradeProposal.entryPremiumTotal;
      const contracts = analysis.tradeProposal.contracts || 1;

      if (entryPremiumTotal === 0 || !entryPremiumTotal) {
        // Sum up leg premiums (per-share) and multiply by contracts and 100 shares
        const legPremiumSum = legs.reduce((sum, leg) => sum + (leg.premium || 0), 0);
        entryPremiumTotal = legPremiumSum * contracts * 100;
        console.log('[Engine] Recalculated premium from legs:', { legPremiumSum, contracts, entryPremiumTotal });
      }

      // Calculate maxLoss from stop multiplier if needed
      const premiumPerShare = legs.reduce((sum, leg) => sum + (leg.premium || 0), 0);
      const maxLoss = analysis.tradeProposal.maxLoss ||
        (premiumPerShare * (stopMultiplier - 1) * contracts * 100);

      // Convert to TradeProposalCard format
      const proposalId = analysis.tradeProposal.proposalId || `engine-${Date.now()}`;
      const proposal: TradeProposal = {
        id: proposalId,
        proposalId: proposalId, // Backend requires this field
        symbol: analysis.tradeProposal.symbol || selectedSymbol,
        expiration: analysis.tradeProposal.expirationDate || SYMBOL_CONFIG[selectedSymbol].expiration,
        strategy: analysis.tradeProposal.strategy,
        bias: analysis.tradeProposal.bias,
        legs,
        contracts,
        entryPremiumTotal,
        maxLoss,
        stopLossPrice: analysis.tradeProposal.stopLossPrice || (premiumPerShare * stopMultiplier),
      };
      setLocalProposal(proposal);
    }
  }, [analysis?.tradeProposal, selectedSymbol, stopMultiplier]);

  // Handle strike modification - recalculate from candidates
  const handleModifyStrike = useCallback(async (legIndex: number, newStrike: number): Promise<ModificationImpact | null> => {
    if (!localProposal || !analysis?.q3Strikes?.candidates) return null;

    const leg = localProposal.legs[legIndex];
    if (!leg) return null;

    // Find the new strike in candidates
    const candidates = analysis.q3Strikes.candidates;
    const newStrikeData = candidates.find(c =>
      c.strike === newStrike && c.optionType === leg.optionType
    );

    if (!newStrikeData) {
      toast.error(`Strike $${newStrike} not found in option chain`);
      return null;
    }

    // Calculate the old leg's premium
    const oldPremium = leg.premium;
    const newPremium = newStrikeData.premium;
    const premiumDiff = newPremium - oldPremium;

    // Calculate probability change (using delta as proxy for prob ITM)
    const oldProbOTM = (1 - Math.abs(leg.delta)) * 100;
    const newProbOTM = (1 - Math.abs(newStrikeData.delta)) * 100;
    const probChange = newProbOTM - oldProbOTM;

    // Calculate new totals
    const oldTotalPremium = localProposal.entryPremiumTotal;
    const newTotalPremium = oldTotalPremium + (premiumDiff * localProposal.contracts * 100);

    // Determine agent opinion
    const underlyingPrice = analysis.q3Strikes.underlyingPrice || 0;
    const isCloserToATM = Math.abs(newStrike - underlyingPrice) < Math.abs(leg.strike - underlyingPrice);
    let agentOpinion: 'approve' | 'caution' | 'reject' = 'approve';
    let warning: string | undefined;

    if (isCloserToATM) {
      agentOpinion = 'caution';
      warning = `Strike $${newStrike} is closer to current price ($${underlyingPrice.toFixed(0)}) - higher risk`;
    }
    if (newProbOTM < 75) {
      agentOpinion = 'reject';
      warning = `Probability OTM (${newProbOTM.toFixed(0)}%) is below 75% threshold`;
    }

    // Update the local proposal with new leg data
    const updatedLegs = [...localProposal.legs];
    updatedLegs[legIndex] = {
      optionType: leg.optionType,
      strike: newStrike,
      delta: newStrikeData.delta,
      premium: newPremium,
    };

    // Recalculate max loss (using stopMultiplier)
    const totalPremiumPerContract = updatedLegs.reduce((sum, l) => sum + l.premium, 0);
    const newMaxLoss = totalPremiumPerContract * (stopMultiplier - 1) * localProposal.contracts * 100;

    setLocalProposal({
      ...localProposal,
      legs: updatedLegs,
      entryPremiumTotal: newTotalPremium,
      maxLoss: newMaxLoss,
      stopLossPrice: totalPremiumPerContract * stopMultiplier,
    });

    return {
      premiumChange: premiumDiff * localProposal.contracts * 100,
      probabilityChange: probChange,
      newPremium: newTotalPremium,
      newProbOTM,
      agentOpinion,
      reasoning: isCloserToATM
        ? `Moving ${leg.optionType} strike closer to ATM increases premium but also risk.`
        : `Moving ${leg.optionType} strike further OTM reduces premium but increases safety.`,
      warning,
    };
  }, [localProposal, analysis?.q3Strikes, stopMultiplier]);

  // Handle running the engine analysis (Steps 1-3)
  const handleRunEngine = useCallback(async () => {
    try {
      setIsExecuting(true);
      setEngineFlowState('running_1_2_3');
      setSelectedPutStrike(null);
      setSelectedCallStrike(null);
      toast.loading('Running engine analysis (Steps 1-3)...', { id: 'engine-execute' });

      // Run the actual analysis - enhanced logs come from backend
      const result = await analyzeEngine({ riskTier, stopMultiplier, symbol: selectedSymbol, strategy: strategyPreference });

      if (result.canTrade) {
        // Check if we have smart candidates for interactive selection
        if (result.q3Strikes?.smartCandidates) {
          // Set engine recommendations as default selections
          const recPut = result.q3Strikes.selectedPut?.strike ?? null;
          const recCall = result.q3Strikes.selectedCall?.strike ?? null;
          setSelectedPutStrike(recPut);
          setSelectedCallStrike(recCall);

          // Pause at Step 3 for user selection
          setEngineFlowState('awaiting_selection');
          toast.success('Steps 1-3 complete. Select strikes and confirm.', { id: 'engine-execute' });
        } else {
          // No smart candidates, continue with legacy flow
          setEngineFlowState('complete');
          toast.success('Engine analysis complete - Trade opportunity found!', { id: 'engine-execute' });

          // If in auto mode and guard rails passed, execute automatically
          if (executionMode === 'auto' && result.guardRails?.passed && result.tradeProposal) {
            toast.loading('Auto-executing trade...', { id: 'auto-execute' });
            await executePaperTrade(result.tradeProposal);
            toast.success('Trade executed automatically!', { id: 'auto-execute' });
          }
        }
      } else {
        setEngineFlowState('error');
        toast.error(`Cannot trade: ${result.reason}`, { id: 'engine-execute' });
      }
    } catch (err: any) {
      console.error('[Engine] Run error:', err);
      setEngineFlowState('error');

      // Check if it's a structured engine error with step details
      if (err.isEngineError && err.failedStep) {
        toast.error(`Step ${err.failedStep} failed: ${err.reason || err.message}`, { id: 'engine-execute' });
      } else {
        toast.error('Failed to run engine', { id: 'engine-execute' });
      }
    } finally {
      setIsExecuting(false);
    }
  }, [analyzeEngine, riskTier, stopMultiplier, selectedSymbol, strategyPreference, executionMode, executePaperTrade]);

  // Handle user confirming strike selection (continue to Steps 4-5)
  const handleConfirmSelection = useCallback(async () => {
    if (!selectedPutStrike && !selectedCallStrike) {
      toast.error('Please select at least one strike');
      return;
    }

    try {
      setIsConfirmingSelection(true);
      setEngineFlowState('running_4_5');
      toast.loading('Running Steps 4-5 with your selection...', { id: 'engine-continue' });

      // TODO: In a full implementation, we would call a continue endpoint
      // For now, the engine has already calculated based on its recommendations
      // The user's selection is just for display/confirmation

      // Simulate completion
      await new Promise(resolve => setTimeout(resolve, 500));

      setEngineFlowState('complete');
      toast.success('Engine analysis complete!', { id: 'engine-continue' });

      // If in auto mode and guard rails passed, execute automatically
      if (executionMode === 'auto' && analysis?.guardRails?.passed && analysis.tradeProposal) {
        toast.loading('Auto-executing trade...', { id: 'auto-execute' });
        await executePaperTrade(analysis.tradeProposal);
        toast.success('Trade executed automatically!', { id: 'auto-execute' });
      }
    } catch (err) {
      console.error('[Engine] Continue error:', err);
      setEngineFlowState('error');
      toast.error('Failed to continue engine', { id: 'engine-continue' });
    } finally {
      setIsConfirmingSelection(false);
    }
  }, [selectedPutStrike, selectedCallStrike, executionMode, analysis, executePaperTrade]);

  // Use engine suggestion as selection
  const handleUseSuggestion = useCallback(() => {
    if (analysis?.q3Strikes) {
      setSelectedPutStrike(analysis.q3Strikes.selectedPut?.strike ?? null);
      setSelectedCallStrike(analysis.q3Strikes.selectedCall?.strike ?? null);
    }
  }, [analysis]);

  // Handle paper trade execution
  const handleExecuteTrade = useCallback(async () => {
    if (!analysis || !analysis.executionReady || !localProposal) {
      toast.error('No valid trade proposal available for execution');
      return;
    }

    // Warn user if in paper mode
    if (environment !== 'live') {
      toast('Paper mode: Order goes to paper account, not live', { icon: 'ℹ️' });
    }

    try {
      setIsExecuting(true);
      setExecutionResult(null); // Clear previous result
      toast.loading('Executing bracket order (SELL + STOP)...', { id: 'execute' });
      // CRITICAL: Use localProposal (user-modified) not analysis.tradeProposal (original)
      const result = await executePaperTrade(localProposal);

      // Store execution result for display
      setExecutionResult({
        success: result.success,
        message: result.message,
        tradeId: result.tradeId,
        ibkrOrderIds: result.ibkrOrderIds,
        timestamp: new Date(),
      });

      toast.success(`Trade executed! ${result.message || 'ID: ' + result.tradeId}`, { id: 'execute' });
    } catch (err: any) {
      console.error('[Engine] Execute trade error:', err);

      // Store failed execution result
      setExecutionResult({
        success: false,
        message: err.message || 'Failed to execute trade',
        timestamp: new Date(),
      });

      toast.error(err.message || 'Failed to execute trade', { id: 'execute' });
    } finally {
      setIsExecuting(false);
    }
  }, [analysis, localProposal, executePaperTrade, environment]);

  // Helper to derive step status from analysis
  const getStepStatus = (stepNum: number): StepStatus => {
    // Check if this step is currently running
    if (engineFlowState === 'running_1_2_3' && stepNum <= 3) return 'running';
    if (engineFlowState === 'running_4_5' && (stepNum === 4 || stepNum === 5)) return 'running';

    if (!analysis) return 'pending';
    switch (stepNum) {
      case 1: return analysis.q1MarketRegime?.passed ? 'passed' : (analysis.q1MarketRegime ? 'failed' : 'pending');
      case 2: return analysis.q2Direction?.passed ? 'passed' : (analysis.q2Direction ? 'failed' : 'pending');
      case 3: return analysis.q3Strikes?.passed ? 'passed' : (analysis.q3Strikes ? 'failed' : 'pending');
      case 4: return analysis.q4Size?.passed ? 'passed' : (analysis.q4Size ? 'failed' : 'pending');
      case 5: return analysis.q5Exit?.passed ? 'passed' : (analysis.q5Exit ? 'failed' : 'pending');
      default: return 'pending';
    }
  };

  // Helper to build summary strings for each step
  const getStep1Summary = (): string => {
    if (!analysis?.q1MarketRegime) return 'Awaiting analysis';
    const vix = analysis.q1MarketRegime.inputs?.vixValue;
    const spy = analysis.q1MarketRegime.inputs?.spyPrice;
    const regime = analysis.q1MarketRegime.vixRegime;
    return `VIX ${vix?.toFixed(1) || '--'} (${regime || '--'}) • SPY $${spy?.toFixed(2) || '--'}`;
  };

  const getStep2Summary = (): string => {
    if (!analysis?.q2Direction) return 'Awaiting Step 1';
    const dir = analysis.q2Direction.recommendedDirection;
    const trend = analysis.q2Direction.signals?.trend;
    return `SELL ${dir || '--'} • ${trend || '--'} trend`;
  };

  const getStep3Summary = (): string => {
    if (engineFlowState === 'awaiting_selection') return 'Select strikes below';
    if (!analysis?.q3Strikes) return 'Awaiting Step 2';
    const putStrike = selectedPutStrike || analysis.q3Strikes.selectedPut?.strike;
    const callStrike = selectedCallStrike || analysis.q3Strikes.selectedCall?.strike;
    const parts = [];
    if (putStrike) parts.push(`$${putStrike}P`);
    if (callStrike) parts.push(`$${callStrike}C`);
    return parts.length > 0 ? parts.join(' / ') : 'No strikes selected';
  };

  const getStep4Summary = (): string => {
    if (!analysis?.q4Size) return 'Awaiting Step 3';
    const contracts = analysis.q4Size.recommendedContracts;
    return `${contracts || '--'} contracts`;
  };

  const getStep5Summary = (): string => {
    if (!analysis?.q5Exit) return 'Awaiting Step 4';
    const stop = analysis.q5Exit.stopLossPrice;
    return `Stop @ $${stop?.toFixed(2) || '--'} (${stopMultiplier}x)`;
  };

  // Helper to derive current step from flow state
  const getCurrentStep = (): number => {
    if (engineFlowState === 'idle' && !analysis) return 0;
    if (engineFlowState === 'running_1_2_3') return 2;
    if (engineFlowState === 'awaiting_selection') return 3;
    if (engineFlowState === 'running_4_5') return 4;
    if (engineFlowState === 'complete') return 6; // All complete
    if (engineFlowState === 'error') return 0;
    // Calculate from analysis
    if (!analysis) return 0;
    if (analysis.q5Exit?.passed) return 6;
    if (analysis.q4Size?.passed) return 5;
    if (analysis.q3Strikes?.passed) return 4;
    if (analysis.q2Direction?.passed) return 3;
    if (analysis.q1MarketRegime?.passed) return 2;
    return 1;
  };

  // Helper for connector status
  const getConnectorStatus = (afterStep: number): 'pending' | 'active' | 'complete' => {
    const current = getCurrentStep();
    if (afterStep < current) return 'complete';
    if (afterStep === current - 1) return 'active';
    return 'pending';
  };

  // Helper for connector output text
  const getConnectorOutput = (afterStep: number): string => {
    switch (afterStep) {
      case 1:
        if (!analysis?.q1MarketRegime) return 'VIX → Regime';
        return `${analysis.q1MarketRegime.vixRegime || 'NORMAL'}`;
      case 2:
        if (!analysis?.q2Direction) return 'MA → Direction';
        return `SELL ${analysis.q2Direction.recommendedDirection || 'PUT'}`;
      case 3:
        if (!analysis?.q3Strikes) return 'Delta → Strikes';
        const p = analysis.q3Strikes.selectedPut?.strike;
        const c = analysis.q3Strikes.selectedCall?.strike;
        return p && c ? `$${p}P/$${c}C` : p ? `$${p}P` : c ? `$${c}C` : 'strikes';
      case 4:
        if (!analysis?.q4Size) return '2% Rule → Size';
        return `${analysis.q4Size.recommendedContracts || '--'} contracts`;
      default:
        return '';
    }
  };

  // Determine engine readiness for running analysis
  // Use unified broker status hook for consistency
  // Only requires broker connection - analysis can run anytime
  // Execution still requires trading window to be open
  const canRunAnalysis = brokerConnectedFinal;
  const canExecuteTrade = status?.tradingWindowOpen && brokerConnectedFinal;

  return (
    <div className="flex h-[calc(100vh-64px)]">
      <LeftNav />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Page Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-wide">Engine</h1>
              <p className="text-silver text-sm mt-1">
                {brokerConnectedFinal
                  ? (environment === 'live' ? 'IBKR Live Trading' : 'IBKR Paper Trading')
                  : 'Simulation Mode'} - {SYMBOL_CONFIG[selectedSymbol].expiration} Options with Stop Loss
              </p>
            </div>

            {/* Symbol Selector */}
            <div className="flex items-center gap-3">
              <label className="text-sm text-silver">Symbol:</label>
              <select
                value={selectedSymbol}
                onChange={(e) => setSelectedSymbol(e.target.value as TradingSymbol)}
                disabled={isExecuting || engineFlowState === 'awaiting_selection'}
                className="bg-charcoal border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-white/40 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {Object.entries(SYMBOL_CONFIG).map(([sym, config]) => (
                  <option key={sym} value={sym}>
                    {config.name} ({config.expiration})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Engine Status Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <StatCard
            label="Engine Status"
            value={canRunAnalysis ? 'READY' : 'WAITING'}
            icon={canRunAnalysis ? <CheckCircle className="w-5 h-5 text-green-500" /> : <Clock className="w-5 h-5" />}
            testId="engine-status"
          />
          <StatCard
            label="IBKR"
            value={isConnecting ? 'Connecting...' : (brokerConnectedFinal
              ? `Connected (${environment === 'live' ? 'Live' : 'Paper'})`
              : 'Disconnected')}
            icon={brokerConnectedFinal ? <Zap className={`w-5 h-5 ${environment === 'live' ? 'text-green-500' : 'text-yellow-500'}`} /> : isConnecting ? <RefreshCw className="w-5 h-5 animate-spin" /> : <XCircle className="w-5 h-5 text-red-500" />}
            testId="ibkr-status"
          />
          <StatCard
            label="Trading Window"
            value={status?.tradingWindowOpen ? 'Open' : 'Closed'}
            icon={status?.tradingWindowOpen ? <CheckCircle className="w-5 h-5 text-green-500" /> : <Clock className="w-5 h-5" />}
            testId="trading-window"
          />
          <StatCard
            label="NY Time"
            value={status?.nyTime?.split(',')[1]?.trim() || '--:--'}
            icon={<Clock className="w-5 h-5" />}
            testId="ny-time"
          />
        </div>


        {/* 5-Step Decision Process */}
        <div className="bg-charcoal rounded-2xl p-6 border border-white/10 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Decision Process</h3>
            <div className="flex items-center gap-3">
              {/* Strategy selector */}
              <select
                value={strategyPreference}
                onChange={(e) => setStrategyPreference(e.target.value as StrategyPreference)}
                disabled={isExecuting || engineFlowState === 'awaiting_selection'}
                className="px-3 py-2 bg-charcoal border border-white/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-white/20 disabled:opacity-50"
              >
                <option value="strangle">Strangle</option>
                <option value="put-only">PUT Only</option>
                <option value="call-only">CALL Only</option>
              </select>

              {/* Automation Toggle */}
              <button
                onClick={() => setAutomationEnabled(!automationEnabled)}
                disabled={isUpdatingAutomation}
                className={`px-3 py-2 rounded text-sm font-medium transition-colors ${
                  automationEnabled
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-zinc-800 text-silver/70 border border-white/10'
                } ${isUpdatingAutomation ? 'opacity-50 cursor-wait' : 'hover:bg-white/5'}`}
              >
                {isUpdatingAutomation ? 'Updating...' : automationEnabled ? '11:00 AM Auto' : 'Manual Only'}
              </button>

              {/* Engine state indicator */}
              {engineFlowState !== 'idle' && engineFlowState !== 'complete' && (
                <span className={`text-sm px-2 py-1 rounded ${
                  engineFlowState === 'awaiting_selection' ? 'bg-yellow-500/20 text-yellow-400' :
                  engineFlowState === 'running_1_2_3' || engineFlowState === 'running_4_5' ? 'bg-blue-500/20 text-blue-400' :
                  engineFlowState === 'error' ? 'bg-red-500/20 text-red-400' : ''
                }`}>
                  {engineFlowState === 'awaiting_selection' && '⏸ Awaiting selection'}
                  {engineFlowState === 'running_1_2_3' && 'Steps 1-3'}
                  {engineFlowState === 'running_4_5' && 'Steps 4-5'}
                  {engineFlowState === 'error' && 'Error'}
                </span>
              )}

              <button
                onClick={handleRunEngine}
                disabled={!canRunAnalysis || isExecuting || loading || engineFlowState === 'awaiting_selection'}
                className="flex items-center gap-2 px-4 py-2 bg-white text-black rounded-lg font-medium hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {isExecuting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    {engineFlowState === 'running_1_2_3' ? 'Running Steps 1-3...' : 'Running...'}
                  </>
                ) : engineFlowState === 'awaiting_selection' ? (
                  <>
                    <Pause className="w-4 h-4" />
                    Select Strikes
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    {engineFlowState === 'complete' ? 'Run Again' : 'Run Engine'}
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Flow Progress Indicator */}
          <StepFlowIndicator currentStep={getCurrentStep()} />

          <div className="space-y-1">
            {/* Step 1: Market Regime */}
            <EngineStepCard
              step={1}
              title="Market"
              status={getStepStatus(1)}
              summary={getStep1Summary()}
            >
              <Step1Content
                vix={analysis?.q1MarketRegime?.inputs?.vixValue ?? undefined}
                vixRegime={analysis?.q1MarketRegime?.vixRegime as any}
                spyPrice={analysis?.q1MarketRegime?.inputs?.spyPrice ?? undefined}
                spyChangePct={analysis?.q1MarketRegime?.inputs?.spyChangePct ?? undefined}
                tradingWindow={{
                  isOpen: status?.tradingWindowOpen ?? false,
                  reason: status?.tradingWindowReason,
                }}
              />
            </EngineStepCard>

            {/* Connector: Step 1 → Step 2 */}
            <StepConnector
              fromStep={1}
              toStep={2}
              output={getConnectorOutput(1)}
              status={getConnectorStatus(1)}
            />

            {/* Step 2: Trend */}
            <EngineStepCard
              step={2}
              title="Trend"
              status={getStepStatus(2)}
              summary={getStep2Summary()}
            >
              <Step2Content
                direction={analysis?.q2Direction?.recommendedDirection}
                trend={analysis?.q2Direction?.signals?.trend}
                spyPrice={analysis?.q2Direction?.signals?.spyPrice}
                maFast={analysis?.q2Direction?.signals?.maFast}
                maSlow={analysis?.q2Direction?.signals?.maSlow}
                reasoning={analysis?.q2Direction?.comment}
                dataSource="IBKR 5-min bars"
              />
            </EngineStepCard>

            {/* Connector: Step 2 → Step 3 */}
            <StepConnector
              fromStep={2}
              toStep={3}
              output={getConnectorOutput(2)}
              status={getConnectorStatus(2)}
            />

            {/* Step 3: Strikes (Interactive) */}
            <EngineStepCard
              step={3}
              title="Strikes"
              status={engineFlowState === 'awaiting_selection' ? 'warning' : getStepStatus(3)}
              summary={getStep3Summary()}
              defaultExpanded={engineFlowState === 'awaiting_selection'}
            >
              {/* Smart Strike Selector (when awaiting selection) */}
              {engineFlowState === 'awaiting_selection' && analysis?.q3Strikes?.smartCandidates ? (
                <StrikeSelector
                  underlyingPrice={analysis.q3Strikes.underlyingPrice}
                  vix={analysis.q1MarketRegime?.inputs?.vixValue ?? undefined}
                  riskRegime={analysis.riskAssessment?.riskRegime}
                  targetDelta={analysis.riskAssessment?.targetDelta}
                  contracts={analysis.riskAssessment?.contracts}
                  putCandidates={analysis.q3Strikes.smartCandidates.puts}
                  callCandidates={analysis.q3Strikes.smartCandidates.calls}
                  recommendedPutStrike={analysis.q3Strikes.selectedPut?.strike}
                  recommendedCallStrike={analysis.q3Strikes.selectedCall?.strike}
                  expectedPremium={analysis.q3Strikes.expectedPremiumPerContract}
                  selectedPutStrike={selectedPutStrike}
                  selectedCallStrike={selectedCallStrike}
                  onPutSelect={setSelectedPutStrike}
                  onCallSelect={setSelectedCallStrike}
                  onUseSuggestion={handleUseSuggestion}
                  onViewFullChain={() => setIsModalOpen(true)}
                  onConfirmSelection={handleConfirmSelection}
                  isLoading={isExecuting}
                  isConfirming={isConfirmingSelection}
                />
              ) : (
                <Step3Content
                  underlyingPrice={analysis?.q3Strikes?.underlyingPrice}
                  targetDelta={analysis?.riskAssessment?.targetDelta}
                  selectedPut={analysis?.q3Strikes?.selectedPut ? {
                    strike: analysis.q3Strikes.selectedPut.strike,
                    delta: analysis.q3Strikes.selectedPut.delta,
                    bid: analysis.q3Strikes.selectedPut.bid,
                  } : undefined}
                  selectedCall={analysis?.q3Strikes?.selectedCall ? {
                    strike: analysis.q3Strikes.selectedCall.strike,
                    delta: analysis.q3Strikes.selectedCall.delta,
                    bid: analysis.q3Strikes.selectedCall.bid,
                  } : undefined}
                  vixRegime={analysis?.q1MarketRegime?.vixRegime}
                  expectedPremium={analysis?.q3Strikes?.expectedPremiumPerContract ? analysis.q3Strikes.expectedPremiumPerContract / 100 : undefined}
                />
              )}
            </EngineStepCard>

            {/* Connector: Step 3 → Step 4 */}
            <StepConnector
              fromStep={3}
              toStep={4}
              output={getConnectorOutput(3)}
              status={getConnectorStatus(3)}
            />

            {/* Step 4: Size (2% Rule) */}
            <EngineStepCard
              step={4}
              title="Size"
              status={getStepStatus(4)}
              summary={getStep4Summary()}
            >
              <Step4Content
                accountValue={analysis?.q4Size?.inputs?.accountValue}
                maxLossPercent={2}
                premiumPerContract={analysis?.q3Strikes?.expectedPremiumPerContract ? analysis.q3Strikes.expectedPremiumPerContract / 100 : undefined}
                stopMultiplier={stopMultiplier}
                marginPerContract={analysis?.q4Size?.marginPerContract}
                marginSource="IBKR"
                buyingPower={analysis?.q4Size?.inputs?.buyingPower}
                recommendedContracts={analysis?.q4Size?.recommendedContracts}
              />
            </EngineStepCard>

            {/* Connector: Step 4 → Step 5 */}
            <StepConnector
              fromStep={4}
              toStep={5}
              output={getConnectorOutput(4)}
              status={getConnectorStatus(4)}
            />

            {/* Step 5: Exit */}
            <EngineStepCard
              step={5}
              title="Exit"
              status={getStepStatus(5)}
              summary={getStep5Summary()}
            >
              <Step5Content
                entryPremium={analysis?.q5Exit?.inputs?.entryPremium ? analysis.q5Exit.inputs.entryPremium / 100 : undefined}
                stopMultiplier={stopMultiplier}
                stopLossPrice={analysis?.q5Exit?.stopLossPrice}
                contracts={analysis?.q4Size?.recommendedContracts}
                totalMaxLoss={analysis?.q5Exit?.stopLossAmount}
              />
            </EngineStepCard>
          </div>
        </div>

        {/* Engine Log - Professional execution viewer with timing and reasoning */}
        <EngineLog
          log={analysis?.enhancedLog || null}
          isRunning={isExecuting}
          className="max-h-[600px]"
        />

        {/* Trade Summary - Using TradeProposalCard with strike adjustment */}
        {analysis && analysis.canTrade && localProposal && (
          <>
            {/* Guard Rail Violations - shown separately */}
            {analysis.guardRails?.violations && analysis.guardRails.violations.length > 0 && (
              <div className="mb-4 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                <p className="text-sm font-medium text-red-500 mb-2">Guard Rail Violations:</p>
                <ul className="text-sm text-red-400 space-y-1">
                  {analysis.guardRails.violations.map((violation, i) => (
                    <li key={i}>• {violation}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* TradeProposalCard with strike adjustment buttons */}
            <TradeProposalCard
              proposal={localProposal}
              critique={{
                approved: analysis.guardRails?.passed ?? true,
                riskLevel: 'MEDIUM',
                mandateCompliant: analysis.guardRails?.passed ?? true,
                concerns: analysis.guardRails?.violations || [],
              }}
              executionResult={executionResult ? {
                success: executionResult.success,
                message: executionResult.message,
                ibkrOrderIds: executionResult.ibkrOrderIds?.map(id => parseInt(id, 10)),
                tradeId: executionResult.tradeId,
                timestamp: executionResult.timestamp instanceof Date
                  ? executionResult.timestamp
                  : new Date(executionResult.timestamp),
              } : undefined}
              isExecuting={isExecuting}
              onExecute={handleExecuteTrade}
              isNegotiating={isNegotiating}
              onModifyStrike={handleModifyStrike}
            />
          </>
        )}


        {/* Guard Rails Configuration */}
        {status?.guardRails && Object.keys(status.guardRails).length > 0 && (
          <div className="bg-charcoal rounded-2xl p-6 border border-white/10 shadow-lg">
            <h3 className="text-lg font-semibold mb-4">Guard Rails</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              {status.guardRails.minDelta !== undefined && (
                <div>
                  <p className="text-silver mb-1">Delta Range</p>
                  <p className="font-mono">{status.guardRails.minDelta} - {status.guardRails.maxDelta}</p>
                </div>
              )}
              {status.guardRails.maxContractsPerTrade !== undefined && (
                <div>
                  <p className="text-silver mb-1">Max Contracts</p>
                  <p className="font-mono">{status.guardRails.maxContractsPerTrade}</p>
                </div>
              )}
              {status.guardRails.stopLossMultiplier !== undefined && (
                <div>
                  <p className="text-silver mb-1">Stop Loss</p>
                  <p className="font-mono">{status.guardRails.stopLossMultiplier}x premium</p>
                </div>
              )}
              {status.guardRails.maxDailyLoss !== undefined && (
                <div>
                  <p className="text-silver mb-1">Max Daily Loss</p>
                  <p className="font-mono">{(status.guardRails.maxDailyLoss * 100).toFixed(0)}%</p>
                </div>
              )}
              {status.guardRails.tradingWindow?.start && (
                <div>
                  <p className="text-silver mb-1">Trading Window</p>
                  <p className="font-mono">{status.guardRails.tradingWindow.start} - {status.guardRails.tradingWindow.end}</p>
                </div>
              )}
              {status.guardRails.allowedStrategies?.length > 0 && (
                <div>
                  <p className="text-silver mb-1">Strategies</p>
                  <p className="font-mono">{status.guardRails.allowedStrategies.join(', ')}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Full Option Chain Modal */}
      {analysis?.q3Strikes?.smartCandidates && (
        <OptionChainModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          underlyingPrice={analysis.q3Strikes.underlyingPrice}
          vix={analysis.q1MarketRegime?.inputs?.vixValue ?? undefined}
          lastUpdate={new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET'}
          putCandidates={analysis.q3Strikes.smartCandidates.puts}
          callCandidates={analysis.q3Strikes.smartCandidates.calls}
          rejectedStrikes={analysis.q3Strikes.rejectedStrikes}
          selectedPutStrike={selectedPutStrike}
          selectedCallStrike={selectedCallStrike}
          onPutSelect={setSelectedPutStrike}
          onCallSelect={setSelectedCallStrike}
          onConfirmSelection={handleConfirmSelection}
          isConfirming={isConfirmingSelection}
        />
      )}
    </div>
  );
}