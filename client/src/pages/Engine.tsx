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
import { CheckCircle, XCircle, Clock, Zap, AlertTriangle, Play, RefreshCw } from 'lucide-react';
import { useEngine } from '@/hooks/useEngine';
import { useBrokerStatus } from '@/hooks/useBrokerStatus';
import EngineLog, { OperationEntry, LogEntry } from '@/components/EngineLog';
import toast from 'react-hot-toast';

// Session storage helpers for engine logs persistence
const ENGINE_LOGS_KEY = 'engine_logs';

function getLogsFromSession(): LogEntry[] {
  try {
    const stored = sessionStorage.getItem(ENGINE_LOGS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function persistLogsToSession(logs: LogEntry[]): void {
  try {
    sessionStorage.setItem(ENGINE_LOGS_KEY, JSON.stringify(logs));
  } catch (err) {
    console.warn('[Engine] Failed to persist logs to sessionStorage:', err);
  }
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
  const { connected: brokerConnectedHook, isConnecting } = useBrokerStatus();

  // Use hook value if available, otherwise fall back to useEngine value
  const brokerConnectedFinal = brokerConnectedHook ?? brokerConnected;

  const [executionMode, setExecutionMode] = useState<'manual' | 'auto'>('manual');
  const [isExecuting, setIsExecuting] = useState(false);
  const [optionChainExpanded, setOptionChainExpanded] = useState(true);
  const [riskTier, setRiskTier] = useState<RiskTier>('balanced');
  const [stopMultiplier, setStopMultiplier] = useState<StopMultiplier>(3);
  const [engineLogs, setEngineLogs] = useState<LogEntry[]>(() => getLogsFromSession());

  // Persist engine logs to sessionStorage when they change
  useEffect(() => {
    persistLogsToSession(engineLogs);
  }, [engineLogs]);

  // Helper to add operation log entries in real-time
  const addOperationLog = useCallback((
    category: OperationEntry['category'],
    message: string,
    status?: OperationEntry['status'],
    value?: string | number
  ) => {
    const entry: OperationEntry = {
      type: 'operation',
      category,
      message,
      timestamp: new Date().toISOString(),
      status,
      value,
    };
    setEngineLogs(prev => [...prev, entry]);
  }, []);

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

  // Handle running the engine analysis
  const handleRunEngine = useCallback(async () => {
    try {
      setIsExecuting(true);
      setEngineLogs([]); // Clear previous logs
      toast.loading('Running engine analysis...', { id: 'engine-execute' });

      // Real-time operation logs
      addOperationLog('IBKR', 'Checking connection status...', 'pending');
      await new Promise(r => setTimeout(r, 100)); // Allow UI to update

      addOperationLog('IBKR', brokerConnectedFinal
        ? 'Connected to paper trading account'
        : 'Using mock data (IBKR disconnected)', 'success');

      addOperationLog('MARKET', 'Fetching SPY price...', 'pending');
      await new Promise(r => setTimeout(r, 100));

      addOperationLog('MARKET', 'Fetching VIX data...', 'pending');
      await new Promise(r => setTimeout(r, 100));

      addOperationLog('OPTIONS', 'Loading 0DTE option chain...', 'pending');
      await new Promise(r => setTimeout(r, 100));

      addOperationLog('ANALYSIS', 'Starting 5-step decision process...', 'pending');

      // Run the actual analysis
      const result = await analyzeEngine({ riskTier, stopMultiplier });

      // Update operation logs with actual values
      if (result.q1MarketRegime?.inputs) {
        const vix = result.q1MarketRegime.inputs.vixValue;
        const spy = result.q1MarketRegime.inputs.spyPrice;
        addOperationLog('MARKET', `SPY price: $${spy?.toFixed(2) || 'N/A'}`, 'success');
        addOperationLog('MARKET', `VIX: ${vix?.toFixed(2) || 'N/A'} (${vix < 20 ? 'LOW - safe' : vix < 30 ? 'ELEVATED' : 'HIGH - caution'})`, 'success');
      }

      if (result.q3Strikes?.candidates?.length) {
        addOperationLog('OPTIONS', `Found ${result.q3Strikes.candidates.length} strikes for SPY`, 'success');
      }

      // Store audit logs from the result if available
      if (result.audit) {
        setEngineLogs(prev => [
          ...prev,
          ...result.audit.map((entry: any) => ({
            ...entry,
            timestamp: entry.timestamp || new Date().toISOString()
          }))
        ]);
      }

      // Final decision log
      if (result.canTrade) {
        addOperationLog('DECISION', 'Trade proposal ready for execution', 'success');
        toast.success('Engine analysis complete - Trade opportunity found!', { id: 'engine-execute' });

        // If in auto mode and guard rails passed, execute automatically
        if (executionMode === 'auto' && result.passedGuardRails) {
          toast.loading('Auto-executing trade...', { id: 'auto-execute' });
          await executePaperTrade(result.tradeProposal);
          toast.success('Trade executed automatically!', { id: 'auto-execute' });
        }
      } else {
        addOperationLog('DECISION', `No trade: ${result.reason}`, 'error');
        toast.error(`Cannot trade: ${result.reason}`, { id: 'engine-execute' });
      }
    } catch (err: any) {
      console.error('[Engine] Run error:', err);

      // Check if it's a structured engine error with step details
      if (err.isEngineError && err.failedStep) {
        addOperationLog('ANALYSIS', `Step ${err.failedStep} (${err.stepName}) FAILED`, 'error');
        addOperationLog('ANALYSIS', `Reason: ${err.reason || err.message}`, 'error');

        // Log audit trail if available
        if (err.audit && Array.isArray(err.audit)) {
          err.audit.forEach((entry: any) => {
            const status = entry.passed ? 'success' : 'error';
            addOperationLog('AUDIT', `Step ${entry.step}: ${entry.name} - ${entry.passed ? 'PASSED' : 'FAILED'}${entry.reason ? ': ' + entry.reason : ''}`, status);
          });
        }

        toast.error(`Step ${err.failedStep} failed: ${err.reason || err.message}`, { id: 'engine-execute' });
      } else {
        addOperationLog('ANALYSIS', `Engine analysis failed: ${err.message || 'Unknown error'}`, 'error');
        toast.error('Failed to run engine', { id: 'engine-execute' });
      }
    } finally {
      setIsExecuting(false);
    }
  }, [analyzeEngine, riskTier, stopMultiplier, executionMode, executePaperTrade, addOperationLog, brokerConnectedFinal]);

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
            <button
              onClick={handleRunEngine}
              disabled={!canRunAnalysis || isExecuting || loading}
              className="flex items-center gap-2 px-4 py-2 bg-white text-black rounded-lg font-medium hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {isExecuting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Run Engine
                </>
              )}
            </button>
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

            {/* Step 3: Strike Selection */}
            <StepCard
              stepNumber={3}
              title="Strikes"
              status={getStepStatus(3)}
              summary={analysis?.q3Strikes?.selectedPut || analysis?.q3Strikes?.selectedCall
                ? `${analysis.q3Strikes.selectedPut ? `${analysis.q3Strikes.selectedPut.strike}P` : ''}${analysis.q3Strikes.selectedPut && analysis.q3Strikes.selectedCall ? ' / ' : ''}${analysis.q3Strikes.selectedCall ? `${analysis.q3Strikes.selectedCall.strike}C` : ''}`
                : '—'}
            >
              <StrikeSelectionContent
                underlyingPrice={analysis?.q3Strikes?.underlyingPrice}
                selectedPutStrike={analysis?.q3Strikes?.selectedPut?.strike}
                selectedCallStrike={analysis?.q3Strikes?.selectedCall?.strike}
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
              {/* Option Chain embedded in Step 3 */}
              {analysis && (
                <div className="mt-4 border-t border-white/10 pt-4">
                  <OptionChainViewer
                    underlyingPrice={analysis.q3Strikes?.underlyingPrice || 450}
                    selectedPutStrike={analysis.q3Strikes?.selectedPut?.strike}
                    selectedCallStrike={analysis.q3Strikes?.selectedCall?.strike}
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

        {/* Engine Log - Terminal-like execution viewer */}
        <div className="bg-charcoal rounded-2xl p-6 border border-white/10 shadow-lg">
          <h3 className="text-lg font-semibold mb-4">Engine Log</h3>
          <EngineLog
            logs={engineLogs}
            isRunning={isExecuting}
            className="max-h-96"
          />
        </div>

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
                  !analysis.guardRails?.passed ||
                  !analysis.tradingWindow?.isOpen
                }
                className="px-6 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {!analysis.tradingWindow?.isOpen ? 'Execute (Window Closed)' : 'Execute Paper Trade'}
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

        {/* No Trade Decision */}
        {analysis && !analysis.canTrade && (
          <div className="bg-charcoal rounded-2xl p-6 border border-white/10 shadow-lg">
            <h3 className="text-lg font-semibold mb-4">Trading Decision</h3>
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
              <p className="text-red-400">{analysis.reason}</p>
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
    </div>
  );
}