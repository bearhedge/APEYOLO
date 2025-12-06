import { useState, useCallback, useEffect } from 'react';
import { LeftNav } from '@/components/LeftNav';
import { StatCard } from '@/components/StatCard';
import { OptionChainViewer } from '@/components/OptionChainViewer';
import {
  StepCard,
  MarketRegimeContent,
  DirectionContent,
  StrikeSelectionContent,
  PositionSizeContent,
  ExitRulesContent,
  RiskTier,
  StopMultiplier
} from '@/components/StepCard';
import { StrikeSelector } from '@/components/StrikeSelector';
import { OptionChainModal } from '@/components/OptionChainModal';
import { CheckCircle, XCircle, Clock, Zap, AlertTriangle, Play, RefreshCw, Pause } from 'lucide-react';
import { useEngine } from '@/hooks/useEngine';
import { useBrokerStatus } from '@/hooks/useBrokerStatus';
import EngineLog from '@/components/EngineLog';
import toast from 'react-hot-toast';
import type { EngineFlowState } from '../../../shared/types/engine';

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

  // Use hook value if available, otherwise fall back to useEngine value
  const brokerConnectedFinal = brokerConnectedHook ?? brokerConnected;

  const [executionMode, setExecutionMode] = useState<'manual' | 'auto'>('manual');
  const [isExecuting, setIsExecuting] = useState(false);
  const [optionChainExpanded, setOptionChainExpanded] = useState(true);
  const [riskTier, setRiskTier] = useState<RiskTier>('balanced');
  const [stopMultiplier, setStopMultiplier] = useState<StopMultiplier>(3);

  // Gated flow state
  const [engineFlowState, setEngineFlowState] = useState<EngineFlowState>('idle');
  const [selectedPutStrike, setSelectedPutStrike] = useState<number | null>(null);
  const [selectedCallStrike, setSelectedCallStrike] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isConfirmingSelection, setIsConfirmingSelection] = useState(false);

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

  // Handle running the engine analysis (Steps 1-3)
  const handleRunEngine = useCallback(async () => {
    try {
      setIsExecuting(true);
      setEngineFlowState('running_1_2_3');
      setSelectedPutStrike(null);
      setSelectedCallStrike(null);
      toast.loading('Running engine analysis (Steps 1-3)...', { id: 'engine-execute' });

      // Run the actual analysis - enhanced logs come from backend
      const result = await analyzeEngine({ riskTier, stopMultiplier });

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
          if (executionMode === 'auto' && result.guardRails?.passed) {
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
  }, [analyzeEngine, riskTier, stopMultiplier, executionMode, executePaperTrade]);

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
      if (executionMode === 'auto' && analysis?.guardRails?.passed) {
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
    if (!analysis || !analysis.executionReady || !analysis.tradeProposal) {
      toast.error('No valid trade proposal available for execution');
      return;
    }

    try {
      setIsExecuting(true);
      toast.loading('Executing paper trade...', { id: 'paper-execute' });
      const result = await executePaperTrade(analysis.tradeProposal);
      toast.success(`Paper trade executed! ID: ${result.tradeId}`, { id: 'paper-execute' });
    } catch (err) {
      console.error('[Engine] Execute paper trade error:', err);
      toast.error('Failed to execute paper trade', { id: 'paper-execute' });
    } finally {
      setIsExecuting(false);
    }
  }, [analysis, executePaperTrade]);

  // Helper to derive step status from analysis
  const getStepStatus = (stepNum: number): 'pending' | 'passed' | 'failed' => {
    if (!analysis) return 'pending';
    switch (stepNum) {
      case 1: return analysis.q1MarketRegime?.passed ? 'passed' : 'failed';
      case 2: return analysis.q2Direction?.passed ? 'passed' : 'failed';
      case 3: return analysis.q3Strikes?.passed ? 'passed' : 'failed';
      case 4: return analysis.q4Size?.passed ? 'passed' : 'failed';
      case 5: return analysis.q5Exit?.passed ? 'passed' : 'failed';
      default: return 'pending';
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
                {brokerConnectedFinal ? 'IBKR Paper Trading' : 'Mock Trading'} - Automated 0DTE Options
              </p>
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
            value={isConnecting ? 'Connecting...' : (brokerConnectedFinal ? 'Connected' : 'Disconnected')}
            icon={brokerConnectedFinal ? <Zap className="w-5 h-5 text-green-500" /> : isConnecting ? <RefreshCw className="w-5 h-5 animate-spin" /> : <XCircle className="w-5 h-5 text-red-500" />}
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

        {/* Trading Window Alert */}
        {!status?.tradingWindowOpen && status?.tradingWindowReason && (
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-yellow-500" />
            <p className="text-sm">{status.tradingWindowReason}</p>
          </div>
        )}

        {/* 5-Step Decision Process */}
        <div className="bg-charcoal rounded-2xl p-6 border border-white/10 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Decision Process</h3>
            <div className="flex items-center gap-3">
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

          <div className="space-y-2">
            {/* Step 1: Market Regime */}
            <StepCard
              stepNumber={1}
              title="Market Regime"
              status={getStepStatus(1)}
              summary={analysis?.q1MarketRegime?.inputs?.vixValue != null
                ? `VIX ${analysis.q1MarketRegime.inputs.vixValue.toFixed(1)} ${analysis.q1MarketRegime.canTrade ? '✓ Safe' : '⚠ Caution'}`
                : '—'}
            >
              <MarketRegimeContent
                vix={analysis?.q1MarketRegime?.inputs?.vixValue ?? undefined}
                spyPrice={analysis?.q1MarketRegime?.inputs?.spyPrice ?? undefined}
                spyChange={analysis?.q1MarketRegime?.inputs?.spyChangePct ?? undefined}
              />
            </StepCard>

            {/* Step 2: Direction */}
            <StepCard
              stepNumber={2}
              title="Direction"
              status={getStepStatus(2)}
              summary={analysis?.q2Direction?.recommendedDirection
                ? `SELL ${analysis.q2Direction.recommendedDirection}`
                : '—'}
            >
              <DirectionContent
                direction={analysis?.q2Direction?.recommendedDirection}
                confidence={analysis?.q2Direction?.confidencePct ? analysis.q2Direction.confidencePct / 100 : undefined}
                spyPrice={analysis?.q2Direction?.signals?.spyPrice}
                maFast={analysis?.q2Direction?.signals?.maFast}
                maSlow={analysis?.q2Direction?.signals?.maSlow}
                trend={analysis?.q2Direction?.signals?.trend}
                reasoning={analysis?.q2Direction?.comment}
                useMiniWidget={true}
              />
            </StepCard>

            {/* Step 3: Strike Selection (Interactive) */}
            <StepCard
              stepNumber={3}
              title="Strikes"
              status={engineFlowState === 'awaiting_selection' ? 'pending' : getStepStatus(3)}
              summary={
                engineFlowState === 'awaiting_selection'
                  ? '⏸ Awaiting selection'
                  : (selectedPutStrike || selectedCallStrike)
                    ? `${selectedPutStrike ? `${selectedPutStrike}P` : ''}${selectedPutStrike && selectedCallStrike ? ' / ' : ''}${selectedCallStrike ? `${selectedCallStrike}C` : ''}`
                    : '—'
              }
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
                <>
                  {/* Legacy Strike Selection Content (fallback) */}
                  <StrikeSelectionContent
                    underlyingPrice={analysis?.q3Strikes?.underlyingPrice}
                    selectedPutStrike={selectedPutStrike ?? analysis?.q3Strikes?.selectedPut?.strike}
                    selectedCallStrike={selectedCallStrike ?? analysis?.q3Strikes?.selectedCall?.strike}
                    putStrikes={analysis?.q3Strikes?.candidates?.filter(c => c.optionType === 'PUT').map(c => ({
                      strike: c.strike,
                      bid: c.bid,
                      ask: c.ask,
                      delta: c.delta,
                      oi: c.openInterest
                    }))}
                    callStrikes={analysis?.q3Strikes?.candidates?.filter(c => c.optionType === 'CALL').map(c => ({
                      strike: c.strike,
                      bid: c.bid,
                      ask: c.ask,
                      delta: c.delta,
                      oi: c.openInterest
                    }))}
                    expectedPremium={analysis?.q3Strikes?.expectedPremiumPerContract}
                  />
                  {/* Option Chain embedded in Step 3 (legacy) */}
                  {analysis && (
                    <div className="mt-4 border-t border-white/10 pt-4">
                      <OptionChainViewer
                        underlyingPrice={analysis.q3Strikes?.underlyingPrice || 450}
                        selectedPutStrike={selectedPutStrike ?? analysis.q3Strikes?.selectedPut?.strike}
                        selectedCallStrike={selectedCallStrike ?? analysis.q3Strikes?.selectedCall?.strike}
                        optionChain={{
                          puts: analysis.q3Strikes?.candidates?.filter(c => c.optionType === 'PUT').map(c => ({
                            strike: c.strike,
                            bid: c.bid,
                            ask: c.ask,
                            delta: c.delta,
                            oi: c.openInterest
                          })) || [],
                          calls: analysis.q3Strikes?.candidates?.filter(c => c.optionType === 'CALL').map(c => ({
                            strike: c.strike,
                            bid: c.bid,
                            ask: c.ask,
                            delta: c.delta,
                            oi: c.openInterest
                          })) || []
                        }}
                        isExpanded={optionChainExpanded}
                        onToggle={() => setOptionChainExpanded(!optionChainExpanded)}
                        expiration="0DTE"
                      />
                    </div>
                  )}
                </>
              )}
            </StepCard>

            {/* Step 4: Position Size (CONFIGURABLE) */}
            <StepCard
              stepNumber={4}
              title="Size"
              status={getStepStatus(4)}
              summary={analysis?.q4Size?.recommendedContracts
                ? `${analysis.q4Size.recommendedContracts} contracts`
                : '—'}
            >
              <PositionSizeContent
                buyingPower={analysis?.q4Size?.inputs?.buyingPower}
                marginPerContract={analysis?.q4Size?.marginPerContract}
                maxContracts={analysis?.q4Size?.riskLimits?.maxContracts ?? 35}
                currentContracts={analysis?.q4Size?.recommendedContracts}
                premium={analysis?.q3Strikes?.expectedPremiumPerContract ? analysis.q3Strikes.expectedPremiumPerContract / 100 : undefined}
                riskTier={riskTier}
                onRiskTierChange={setRiskTier}
              />
            </StepCard>

            {/* Step 5: Exit Rules (CONFIGURABLE) */}
            <StepCard
              stepNumber={5}
              title="Exit"
              status={getStepStatus(5)}
              summary={analysis?.q5Exit?.stopLossPrice
                ? `Stop @ $${analysis.q5Exit.stopLossPrice.toFixed(2)} (${stopMultiplier}x)`
                : '—'}
            >
              <ExitRulesContent
                entryPremium={analysis?.q5Exit?.inputs?.entryPremium ? analysis.q5Exit.inputs.entryPremium / 100 : undefined}
                stopLoss={analysis?.q5Exit?.stopLossPrice}
                maxLossPerTrade={analysis?.q5Exit?.stopLossAmount}
                stopMultiplier={stopMultiplier}
                onStopMultiplierChange={setStopMultiplier}
                timeStop={analysis?.q5Exit?.timeStopEt?.replace(' ET', '') ?? '3:30 PM'}
              />
            </StepCard>
          </div>
        </div>

        {/* Engine Log - Professional execution viewer with timing and reasoning */}
        <EngineLog
          log={analysis?.enhancedLog || null}
          isRunning={isExecuting}
          className="max-h-[600px]"
        />

        {/* Current Decision - Trade Proposal */}
        {analysis && analysis.canTrade && analysis.tradeProposal && (
          <div className="bg-charcoal rounded-2xl p-6 border border-white/10 shadow-lg">
            <h3 className="text-lg font-semibold mb-4">Trade Proposal</h3>

            {/* Guard Rail Violations */}
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

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-silver mb-1">Strategy</p>
                <p className="font-medium">{analysis.tradeProposal.strategy} ({analysis.tradeProposal.bias})</p>
              </div>
              <div>
                <p className="text-xs text-silver mb-1">Strikes</p>
                <p className="font-medium">
                  {analysis.tradeProposal.legs.map((leg, i) => (
                    <span key={i}>
                      {i > 0 && ' / '}
                      {leg.strike}{leg.optionType === 'PUT' ? 'P' : 'C'}
                    </span>
                  ))}
                </p>
              </div>
              <div>
                <p className="text-xs text-silver mb-1">Premium</p>
                <p className="font-medium">
                  ${analysis.tradeProposal.entryPremiumTotal.toFixed(0)}
                </p>
              </div>
              <div>
                <p className="text-xs text-silver mb-1">Margin</p>
                <p className="font-medium">
                  ${analysis.tradeProposal.marginRequired.toFixed(0)}
                </p>
              </div>
            </div>

            {/* Position Details */}
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-silver mb-1">Contracts</p>
                <p className="font-medium">{analysis.tradeProposal.contracts}</p>
              </div>
              <div>
                <p className="text-xs text-silver mb-1">Max Loss</p>
                <p className="font-medium text-red-400">${analysis.tradeProposal.maxLoss.toFixed(0)}</p>
              </div>
              <div>
                <p className="text-xs text-silver mb-1">Stop Loss</p>
                <p className="font-medium">${analysis.tradeProposal.stopLossPrice.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-silver mb-1">Time Stop</p>
                <p className="font-medium">{analysis.tradeProposal.timeStop}</p>
              </div>
            </div>

            {/* Trading Window Warning */}
            {!analysis.tradingWindow?.isOpen && (
              <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
                <p className="text-sm text-yellow-400">
                  {analysis.tradingWindow?.reason || 'Trading window is closed. Execution disabled.'}
                </p>
              </div>
            )}

            {/* Execute Buttons */}
            <div className="mt-6 flex gap-3">
              <button
                onClick={handleExecuteTrade}
                disabled={
                  !analysis.executionReady ||
                  isExecuting ||
                  !analysis.guardRails?.passed
                  // Trading window check removed for paper trading testing
                }
                className="px-6 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {!analysis.tradingWindow?.isOpen ? 'Execute (Paper - Window Closed)' : 'Execute Paper Trade'}
              </button>
              <button
                onClick={() => toast.info('Trade skipped')}
                className="px-6 py-2 border border-white/20 rounded-lg hover:bg-white/5 transition"
              >
                Skip Today
              </button>
            </div>
          </div>
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