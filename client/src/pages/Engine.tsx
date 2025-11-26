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
import toast from 'react-hot-toast';

export function Engine() {
  const {
    status,
    decision,
    config,
    loading,
    error,
    fetchStatus,
    executeDecision,
    executeTrade,
    updateConfig,
    formatSteps
  } = useEngine();

  const [executionMode, setExecutionMode] = useState<'manual' | 'auto'>('manual');
  const [isExecuting, setIsExecuting] = useState(false);
  const [optionChainExpanded, setOptionChainExpanded] = useState(true);
  const [riskTier, setRiskTier] = useState<RiskTier>('balanced');
  const [stopMultiplier, setStopMultiplier] = useState<StopMultiplier>(3);

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

  // Handle running the engine decision process
  const handleRunEngine = useCallback(async () => {
    try {
      setIsExecuting(true);
      toast.loading('Running engine analysis...', { id: 'engine-execute' });
      const newDecision = await executeDecision({ riskTier, stopMultiplier });

      if (newDecision.canTrade) {
        toast.success('Engine analysis complete - Trade opportunity found!', { id: 'engine-execute' });

        // If in auto mode and guard rails passed, execute automatically
        if (executionMode === 'auto' && newDecision.passedGuardRails) {
          toast.loading('Auto-executing trade...', { id: 'auto-execute' });
          await executeTrade(newDecision, true);
          toast.success('Trade executed automatically!', { id: 'auto-execute' });
        }
      } else {
        toast.error(`Cannot trade: ${newDecision.reason}`, { id: 'engine-execute' });
      }
    } catch (err) {
      console.error('[Engine] Run error:', err);
      toast.error('Failed to run engine analysis', { id: 'engine-execute' });
    } finally {
      setIsExecuting(false);
    }
  }, [executeDecision, executeTrade, executionMode, riskTier, stopMultiplier]);

  // Handle manual trade execution
  const handleExecuteTrade = useCallback(async () => {
    if (!decision || !decision.executionReady) {
      toast.error('No valid decision available for execution');
      return;
    }

    try {
      setIsExecuting(true);
      toast.loading('Executing trade...', { id: 'manual-execute' });
      const result = await executeTrade(decision, false);
      toast.success('Trade executed successfully!', { id: 'manual-execute' });
    } catch (err) {
      console.error('[Engine] Execute trade error:', err);
      toast.error('Failed to execute trade', { id: 'manual-execute' });
    } finally {
      setIsExecuting(false);
    }
  }, [decision, executeTrade]);

  // Handle mode change
  const handleModeChange = useCallback(async (mode: 'manual' | 'auto') => {
    setExecutionMode(mode);
    if (config) {
      try {
        await updateConfig({ ...config, executionMode: mode });
        toast.success(`Switched to ${mode} mode`);
      } catch (err) {
        toast.error('Failed to update execution mode');
      }
    }
  }, [config, updateConfig]);

  // Format steps for display
  const steps = formatSteps(decision);

  // Determine engine readiness
  // Requires both trading window open AND broker connected
  // Broker connection is established on page load via auto-connect
  const engineReady = status?.tradingWindowOpen && status?.brokerConnected;

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
                {status?.brokerProvider === 'ibkr' ? 'IBKR Paper Trading' : 'Mock Trading'} - Automated 0DTE Options
              </p>
            </div>

            {/* Execution Mode Toggle */}
            <div className="flex items-center gap-2 bg-charcoal rounded-lg p-1">
              <button
                onClick={() => handleModeChange('manual')}
                className={`px-4 py-2 rounded-md transition ${
                  executionMode === 'manual'
                    ? 'bg-white text-black'
                    : 'text-silver hover:text-white'
                }`}
              >
                Manual
              </button>
              <button
                onClick={() => handleModeChange('auto')}
                className={`px-4 py-2 rounded-md transition ${
                  executionMode === 'auto'
                    ? 'bg-white text-black'
                    : 'text-silver hover:text-white'
                }`}
              >
                Auto
              </button>
            </div>
          </div>
        </div>

        {/* Engine Status Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <StatCard
            label="Engine Status"
            value={engineReady ? 'READY' : status?.tradingWindowOpen === false ? 'CLOSED' : 'WAITING'}
            icon={engineReady ? <CheckCircle className="w-5 h-5 text-green-500" /> : <Clock className="w-5 h-5" />}
            testId="engine-status"
          />
          <StatCard
            label="Broker"
            value={status?.brokerConnected ? 'Connected' : 'Disconnected'}
            icon={status?.brokerConnected ? <Zap className="w-5 h-5 text-green-500" /> : <XCircle className="w-5 h-5 text-red-500" />}
            testId="broker-status"
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
              disabled={!engineReady || isExecuting || loading}
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
                  Run Analysis
                </>
              )}
            </button>
          </div>

          <div className="space-y-2">
            {/* Step 1: Market Regime */}
            <StepCard
              stepNumber={1}
              title="Market Regime"
              status={steps[0]?.status as 'pending' | 'passed' | 'failed' || 'pending'}
              summary={decision?.marketRegime?.metadata?.vix
                ? `VIX ${decision.marketRegime.metadata.vix.toFixed(1)} ${decision.marketRegime.shouldTrade ? '✓ Safe' : '⚠ Caution'}`
                : 'Waiting for analysis'}
            >
              <MarketRegimeContent
                vix={decision?.marketRegime?.metadata?.vix}
                spyPrice={decision?.marketRegime?.metadata?.spyPrice}
                spyChange={decision?.marketRegime?.metadata?.spyChange}
                trend={decision?.marketRegime?.metadata?.trend}
              />
            </StepCard>

            {/* Step 2: Direction */}
            <StepCard
              stepNumber={2}
              title="Direction"
              status={steps[1]?.status as 'pending' | 'passed' | 'failed' || 'pending'}
              summary={decision?.direction
                ? `SELL ${decision.direction.direction}`
                : 'Waiting for analysis'}
            >
              <DirectionContent
                direction={decision?.direction?.direction}
                confidence={decision?.direction?.confidence}
                spyPrice={decision?.marketRegime?.metadata?.spyPrice}
                reasoning={decision?.direction?.reasoning}
              />
            </StepCard>

            {/* Step 3: Strike Selection */}
            <StepCard
              stepNumber={3}
              title="Strikes"
              status={steps[2]?.status as 'pending' | 'passed' | 'failed' || 'pending'}
              summary={decision?.strikes?.putStrike || decision?.strikes?.callStrike
                ? `${decision.strikes.putStrike ? `${decision.strikes.putStrike.strike}P` : ''}${decision.strikes.putStrike && decision.strikes.callStrike ? ' / ' : ''}${decision.strikes.callStrike ? `${decision.strikes.callStrike.strike}C` : ''}`
                : 'Waiting for analysis'}
            >
              <StrikeSelectionContent
                underlyingPrice={decision?.marketRegime?.metadata?.spyPrice}
                selectedPutStrike={decision?.strikes?.putStrike?.strike}
                selectedCallStrike={decision?.strikes?.callStrike?.strike}
                putStrikes={decision?.strikes?.nearbyStrikes?.puts}
                callStrikes={decision?.strikes?.nearbyStrikes?.calls}
                expectedPremium={decision?.strikes?.expectedPremium}
              />
            </StepCard>

            {/* Step 4: Position Size (CONFIGURABLE) */}
            <StepCard
              stepNumber={4}
              title="Size"
              status={steps[3]?.status as 'pending' | 'passed' | 'failed' || 'pending'}
              summary={decision?.positionSize
                ? `${decision.positionSize.contracts} contracts`
                : 'Waiting for analysis'}
            >
              <PositionSizeContent
                buyingPower={decision?.positionSize?.marginRequired ? decision.positionSize.marginRequired * 5 : undefined}
                marginPerContract={decision?.positionSize?.marginRequired ? Math.round(decision.positionSize.marginRequired / (decision.positionSize.contracts || 1)) : undefined}
                maxContracts={35}
                currentContracts={decision?.positionSize?.contracts}
                premium={decision?.strikes?.expectedPremium ? decision.strikes.expectedPremium / 100 : undefined}
                riskTier={riskTier}
                onRiskTierChange={setRiskTier}
              />
            </StepCard>

            {/* Step 5: Exit Rules (CONFIGURABLE) */}
            <StepCard
              stepNumber={5}
              title="Exit"
              status={steps[4]?.status as 'pending' | 'passed' | 'failed' || 'pending'}
              summary={decision?.exitRules
                ? `Stop @ $${decision.exitRules.stopLoss} (${stopMultiplier}x)`
                : 'Waiting for analysis'}
            >
              <ExitRulesContent
                entryPremium={decision?.strikes?.expectedPremium ? decision.strikes.expectedPremium / 100 : undefined}
                stopLoss={decision?.exitRules?.stopLoss}
                maxLossPerTrade={decision?.positionSize?.totalRisk}
                stopMultiplier={stopMultiplier}
                onStopMultiplierChange={setStopMultiplier}
                timeStop="3:30 PM"
              />
            </StepCard>
          </div>
        </div>

        {/* Current Decision */}
        {decision && decision.canTrade && (
          <div className="bg-charcoal rounded-2xl p-6 border border-white/10 shadow-lg">
            <h3 className="text-lg font-semibold mb-4">Trading Decision</h3>

            {/* Guard Rail Violations */}
            {decision.guardRailViolations && decision.guardRailViolations.length > 0 && (
              <div className="mb-4 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                <p className="text-sm font-medium text-red-500 mb-2">Guard Rail Violations:</p>
                <ul className="text-sm text-red-400 space-y-1">
                  {decision.guardRailViolations.map((violation, i) => (
                    <li key={i}>• {violation}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-silver mb-1">Strategy</p>
                <p className="font-medium">{decision.direction?.direction || 'N/A'}</p>
              </div>
              <div>
                <p className="text-xs text-silver mb-1">Strikes</p>
                <p className="font-medium">
                  {decision.strikes?.putStrike && `${decision.strikes.putStrike.strike}P`}
                  {decision.strikes?.putStrike && decision.strikes?.callStrike && ' / '}
                  {decision.strikes?.callStrike && `${decision.strikes.callStrike.strike}C`}
                  {!decision.strikes?.putStrike && !decision.strikes?.callStrike && 'N/A'}
                </p>
              </div>
              <div>
                <p className="text-xs text-silver mb-1">Premium</p>
                <p className="font-medium">
                  ${decision.strikes?.expectedPremium?.toFixed(0) || '0'}
                </p>
              </div>
              <div>
                <p className="text-xs text-silver mb-1">Margin</p>
                <p className="font-medium">
                  ${decision.strikes?.marginRequired?.toFixed(0) || '0'}
                </p>
              </div>
            </div>

            {/* Position Details */}
            {decision.positionSize && (
              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-silver mb-1">Contracts</p>
                  <p className="font-medium">{decision.positionSize.contracts}</p>
                </div>
                <div>
                  <p className="text-xs text-silver mb-1">Total Risk</p>
                  <p className="font-medium">${decision.positionSize.totalRisk?.toFixed(0) || '0'}</p>
                </div>
                <div>
                  <p className="text-xs text-silver mb-1">Stop Loss</p>
                  <p className="font-medium">${decision.exitRules?.stopLoss || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-xs text-silver mb-1">Take Profit</p>
                  <p className="font-medium">${decision.exitRules?.takeProfit || 'N/A'}</p>
                </div>
              </div>
            )}

            {/* Execute Buttons */}
            {executionMode === 'manual' && (
              <div className="mt-6 flex gap-3">
                <button
                  onClick={handleExecuteTrade}
                  disabled={!decision.executionReady || isExecuting || (decision.guardRailViolations && decision.guardRailViolations.length > 0)}
                  className="px-6 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  Execute Trade
                </button>
                <button
                  onClick={() => toast.info('Trade skipped')}
                  className="px-6 py-2 border border-white/20 rounded-lg hover:bg-white/5 transition"
                >
                  Skip Today
                </button>
              </div>
            )}

            {executionMode === 'auto' && (
              <div className="mt-6 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                <p className="text-sm text-blue-400">
                  Auto-execution is {decision.passedGuardRails ? 'enabled' : 'blocked by guard rails'}.
                  {decision.passedGuardRails && ' Trade will execute automatically when conditions are met.'}
                </p>
              </div>
            )}
          </div>
        )}

        {/* No Trade Decision */}
        {decision && !decision.canTrade && (
          <div className="bg-charcoal rounded-2xl p-6 border border-white/10 shadow-lg">
            <h3 className="text-lg font-semibold mb-4">Trading Decision</h3>
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
              <p className="text-red-400">{decision.reason}</p>
            </div>
          </div>
        )}

        {/* Option Chain Viewer */}
        {decision && (
          <OptionChainViewer
            underlyingPrice={decision.marketRegime?.metadata?.spyPrice || 450}
            selectedPutStrike={decision.strikes?.putStrike?.strike}
            selectedCallStrike={decision.strikes?.callStrike?.strike}
            optionChain={decision.strikes?.nearbyStrikes}
            isExpanded={optionChainExpanded}
            onToggle={() => setOptionChainExpanded(!optionChainExpanded)}
            expiration="0DTE"
          />
        )}

        {/* Guard Rails Configuration */}
        {status?.guardRails && (
          <div className="bg-charcoal rounded-2xl p-6 border border-white/10 shadow-lg">
            <h3 className="text-lg font-semibold mb-4">Guard Rails</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-silver mb-1">Delta Range</p>
                <p className="font-mono">{status.guardRails.minDelta} - {status.guardRails.maxDelta}</p>
              </div>
              <div>
                <p className="text-silver mb-1">Max Contracts</p>
                <p className="font-mono">{status.guardRails.maxContractsPerTrade}</p>
              </div>
              <div>
                <p className="text-silver mb-1">Stop Loss</p>
                <p className="font-mono">{status.guardRails.stopLossMultiplier}x premium</p>
              </div>
              <div>
                <p className="text-silver mb-1">Max Daily Loss</p>
                <p className="font-mono">{(status.guardRails.maxDailyLoss * 100).toFixed(0)}%</p>
              </div>
              <div>
                <p className="text-silver mb-1">Trading Window</p>
                <p className="font-mono">{status.guardRails.tradingWindow.start} - {status.guardRails.tradingWindow.end}</p>
              </div>
              <div>
                <p className="text-silver mb-1">Strategies</p>
                <p className="font-mono">{status.guardRails.allowedStrategies.join(', ')}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}