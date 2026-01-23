/**
 * EngineWindow - Full 5-step trading engine wizard in terminal style
 *
 * Step 1: Market Assessment (analyze market conditions)
 * Step 2: Direction (recommended direction, override option)
 * Step 3: Strike Selection (select PUT/CALL strikes from table)
 * Step 4: Position Sizing (risk tier selection)
 * Step 5: Execute (stop loss, confirm, execute)
 */

import { useState, useEffect, useMemo } from 'react';
import { useEngineAnalysis } from '@/hooks/useEngineAnalysis';
import { useMarketSnapshot } from '@/hooks/useMarketSnapshot';
import { useEngine } from '@/hooks/useEngine';
import { useQuery, useMutation } from '@tanstack/react-query';

type Strategy = 'strangle' | 'put-only' | 'call-only';
type RiskTier = 'conservative' | 'balanced' | 'aggressive';
type StopMultiplier = 2 | 3 | 4;

interface StrikeCandidate {
  strike: number;
  bid: number;
  ask: number;
  delta: number;
  isEngineRecommended?: boolean;
}

export function EngineWindow() {
  // Wizard state
  const [wizardStep, setWizardStep] = useState(1);
  const [strategy, setStrategy] = useState<Strategy>('strangle');
  const [riskTier, setRiskTier] = useState<RiskTier>('balanced');
  const [stopMultiplier, setStopMultiplier] = useState<StopMultiplier>(3);
  const [selectedPutStrike, setSelectedPutStrike] = useState<number | null>(null);
  const [selectedCallStrike, setSelectedCallStrike] = useState<number | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  // Engine analysis hook
  const {
    analyze,
    isAnalyzing,
    currentStep: engineStep,
    completedSteps,
    analysis,
    error: analysisError,
    stepResults,
  } = useEngineAnalysis({
    symbol: 'SPY',
    strategy,
    riskTier,
  });

  // Broker status - use EXACT same useQuery as SettingsWindow for shared cache
  const { data: ibkrStatus } = useQuery<{
    configured: boolean;
    connected: boolean;
    accountId?: string;
    nav?: number;
    environment?: string;
  }>({
    queryKey: ['/api/ibkr/status'],
    queryFn: async () => {
      const res = await fetch('/api/ibkr/status', { credentials: 'include' });
      if (!res.ok) return { configured: false, connected: false };
      return res.json();
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data?.configured) return false;
      if (data?.configured && !data?.connected) return 3000;
      return 30000;
    },
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  // Engine status - for tradingWindowOpen check
  const { status: engineStatus } = useEngine();

  // Market snapshot - use SSE streaming hook like Engine.tsx
  const { snapshot: marketSnapshot, connectionStatus: marketConnectionStatus } = useMarketSnapshot();

  // Execute trade mutation
  const executeMutation = useMutation({
    mutationFn: async (proposal: any) => {
      const res = await fetch('/api/engine/execute-paper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(proposal),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to execute trade');
      }
      return res.json();
    },
    onSuccess: () => {
      setShowConfirm(false);
      setWizardStep(1);
    },
  });

  // Auto-advance wizard when analysis completes
  useEffect(() => {
    if (analysis && !isAnalyzing && wizardStep === 1) {
      // Set default strikes from engine recommendation
      if (analysis.q3Strikes?.selectedPut?.strike) {
        setSelectedPutStrike(analysis.q3Strikes.selectedPut.strike);
      }
      if (analysis.q3Strikes?.selectedCall?.strike) {
        setSelectedCallStrike(analysis.q3Strikes.selectedCall.strike);
      }
      setWizardStep(2);
    }
  }, [analysis, isAnalyzing, wizardStep]);

  // Derived values
  // Use SSE streaming data from useMarketSnapshot hook
  const spyPrice = marketSnapshot?.spyPrice ?? analysis?.q1MarketRegime?.inputs?.spyPrice ?? 0;
  const vix = marketSnapshot?.vix ?? analysis?.q1MarketRegime?.inputs?.vixValue ?? 0;
  const spyChangePct = marketSnapshot?.spyChangePct ?? 0;
  const isConnected = ibkrStatus?.connected ?? false;
  // Match Engine.tsx logic: check marketState OR tradingWindowOpen from engine status
  const marketState = marketSnapshot?.marketState ?? 'CLOSED';
  const marketOpen = marketState === 'REGULAR' || marketState === 'OVERNIGHT' || engineStatus?.tradingWindowOpen;

  // Additional market data from SSE stream (matching Trade page)
  const spyBid = marketSnapshot?.spyBid ?? null;
  const spyAsk = marketSnapshot?.spyAsk ?? null;
  const bidAskSpread = spyBid && spyAsk ? spyAsk - spyBid : null;
  const vwap = marketSnapshot?.vwap ?? null;
  const ivRank = marketSnapshot?.ivRank ?? null;
  const dayHigh = marketSnapshot?.dayHigh ?? spyPrice;
  const dayLow = marketSnapshot?.dayLow ?? spyPrice;
  const vixChangePct = marketSnapshot?.vixChangePct ?? 0;
  const timestamp = marketSnapshot?.timestamp ?? null;

  // Strike candidates
  const putCandidates: StrikeCandidate[] = useMemo(() => {
    if (!analysis?.q3Strikes?.smartCandidates?.puts) return [];
    return analysis.q3Strikes.smartCandidates.puts.map((s: any) => ({
      strike: s.strike,
      bid: s.bid,
      ask: s.ask,
      delta: s.delta,
      isEngineRecommended: s.isEngineRecommended,
    }));
  }, [analysis]);

  const callCandidates: StrikeCandidate[] = useMemo(() => {
    if (!analysis?.q3Strikes?.smartCandidates?.calls) return [];
    return analysis.q3Strikes.smartCandidates.calls.map((s: any) => ({
      strike: s.strike,
      bid: s.bid,
      ask: s.ask,
      delta: s.delta,
      isEngineRecommended: s.isEngineRecommended,
    }));
  }, [analysis]);

  // Calculate contracts and premium
  const contracts = riskTier === 'conservative' ? 1 : riskTier === 'balanced' ? 2 : 3;
  const selectedPut = putCandidates.find(s => s.strike === selectedPutStrike);
  const selectedCall = callCandidates.find(s => s.strike === selectedCallStrike);
  const premiumPerContract = (selectedPut?.bid ?? 0) + (selectedCall?.bid ?? 0);
  const totalPremium = premiumPerContract * contracts * 100;
  const stopLossAmount = premiumPerContract * stopMultiplier * contracts * 100;
  const maxLoss = stopLossAmount - totalPremium;

  // Build trade proposal
  const buildProposal = () => {
    const legs: any[] = [];
    if (selectedPut && (strategy === 'strangle' || strategy === 'put-only')) {
      legs.push({
        optionType: 'PUT',
        action: 'SELL',
        strike: selectedPut.strike,
        delta: selectedPut.delta,
        premium: selectedPut.bid,
        bid: selectedPut.bid,
        ask: selectedPut.ask,
      });
    }
    if (selectedCall && (strategy === 'strangle' || strategy === 'call-only')) {
      legs.push({
        optionType: 'CALL',
        action: 'SELL',
        strike: selectedCall.strike,
        delta: selectedCall.delta,
        premium: selectedCall.bid,
        bid: selectedCall.bid,
        ask: selectedCall.ask,
      });
    }
    return {
      symbol: 'SPY',
      expiration: new Date().toISOString().split('T')[0],
      strategy: analysis?.tradeProposal?.strategy ?? 'STRANGLE',
      legs,
      contracts,
      entryPremiumTotal: totalPremium,
      entryPremiumPerContract: premiumPerContract * 100,
      stopLossPrice: premiumPerContract * stopMultiplier,
      stopLossAmount,
      maxLoss,
    };
  };

  // Navigation handlers
  const canGoNext = () => {
    if (wizardStep === 1) return !isAnalyzing && analysis;
    if (wizardStep === 2) return selectedPutStrike || selectedCallStrike;
    if (wizardStep === 3) return true;
    if (wizardStep === 4) return true;
    return false;
  };

  const goNext = () => {
    if (canGoNext() && wizardStep < 5) {
      setWizardStep(wizardStep + 1);
    }
  };

  const goBack = () => {
    if (wizardStep > 1) {
      setWizardStep(wizardStep - 1);
    }
  };

  return (
    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 14 }}>
      {/* Header */}
      <div style={{ marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid #333' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#87ceeb' }}>&gt; ENGINE v2.0 - STEP {wizardStep}/5</span>
          <span style={{ color: isConnected ? '#4ade80' : '#ef4444', fontSize: 12 }}>
            {isConnected ? 'CONNECTED' : 'DISCONNECTED'}
          </span>
        </div>
        {isAnalyzing && (
          <div style={{ color: '#f59e0b', fontSize: 13, marginTop: 4 }}>
            Analyzing step {engineStep}...
          </div>
        )}
      </div>

      {/* Error display */}
      {analysisError && (
        <div style={{ color: '#ef4444', marginBottom: 12, fontSize: 13 }}>
          &gt; ERROR: {analysisError}
        </div>
      )}
      {executeMutation.isError && (
        <div style={{ color: '#ef4444', marginBottom: 12, fontSize: 13 }}>
          &gt; ERROR: {executeMutation.error?.message}
        </div>
      )}

      {/* Step Content */}
      {wizardStep === 1 && (
        <Step1Market
          spyPrice={spyPrice}
          spyChangePct={spyChangePct}
          spyBid={spyBid}
          spyAsk={spyAsk}
          bidAskSpread={bidAskSpread}
          vix={vix}
          vixChangePct={vixChangePct}
          vwap={vwap}
          ivRank={ivRank}
          dayHigh={dayHigh}
          dayLow={dayLow}
          timestamp={timestamp}
          marketOpen={marketOpen}
          strategy={strategy}
          onStrategyChange={setStrategy}
          onAnalyze={analyze}
          isAnalyzing={isAnalyzing}
          isConnected={isConnected}
        />
      )}

      {wizardStep === 2 && (
        <Step2Direction
          analysis={analysis}
          strategy={strategy}
          onStrategyChange={setStrategy}
        />
      )}

      {wizardStep === 3 && (
        <Step3Strikes
          spyPrice={spyPrice}
          putCandidates={strategy === 'call-only' ? [] : putCandidates}
          callCandidates={strategy === 'put-only' ? [] : callCandidates}
          selectedPutStrike={selectedPutStrike}
          selectedCallStrike={selectedCallStrike}
          onPutSelect={setSelectedPutStrike}
          onCallSelect={setSelectedCallStrike}
          premiumPerContract={premiumPerContract}
        />
      )}

      {wizardStep === 4 && (
        <Step4Size
          riskTier={riskTier}
          onRiskTierChange={setRiskTier}
          contracts={contracts}
          premiumPerContract={premiumPerContract}
          totalPremium={totalPremium}
          nav={ibkrStatus?.nav ?? 0}
        />
      )}

      {wizardStep === 5 && (
        <Step5Execute
          selectedPut={selectedPut}
          selectedCall={selectedCall}
          contracts={contracts}
          totalPremium={totalPremium}
          stopMultiplier={stopMultiplier}
          onStopMultiplierChange={setStopMultiplier}
          stopLossAmount={stopLossAmount}
          maxLoss={maxLoss}
          showConfirm={showConfirm}
          onShowConfirm={() => setShowConfirm(true)}
          onCancel={() => setShowConfirm(false)}
          onExecute={() => executeMutation.mutate(buildProposal())}
          isExecuting={executeMutation.isPending}
        />
      )}

      {/* Navigation */}
      {wizardStep > 1 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 16, paddingTop: 12, borderTop: '1px solid #333' }}>
          <button
            onClick={goBack}
            disabled={executeMutation.isPending}
            style={{
              flex: 1,
              padding: '8px 0',
              background: 'none',
              border: '1px solid #333',
              color: '#888',
              fontSize: 13,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            BACK
          </button>
          {wizardStep < 5 && (
            <button
              onClick={goNext}
              disabled={!canGoNext()}
              style={{
                flex: 1,
                padding: '8px 0',
                background: canGoNext() ? '#3b82f6' : 'transparent',
                border: `1px solid ${canGoNext() ? '#3b82f6' : '#333'}`,
                color: canGoNext() ? '#fff' : '#666',
                fontSize: 13,
                cursor: canGoNext() ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit',
              }}
            >
              NEXT
            </button>
          )}
        </div>
      )}

      {/* Success message */}
      {executeMutation.isSuccess && (
        <div style={{ color: '#4ade80', marginTop: 12, fontSize: 13 }}>
          &gt; Trade executed successfully!
        </div>
      )}
    </div>
  );
}

// Step 1: Market Assessment
function Step1Market({
  spyPrice,
  spyChangePct,
  spyBid,
  spyAsk,
  bidAskSpread,
  vix,
  vixChangePct,
  vwap,
  ivRank,
  dayHigh,
  dayLow,
  timestamp,
  marketOpen,
  strategy,
  onStrategyChange,
  onAnalyze,
  isAnalyzing,
  isConnected,
}: {
  spyPrice: number;
  spyChangePct: number;
  spyBid: number | null;
  spyAsk: number | null;
  bidAskSpread: number | null;
  vix: number;
  vixChangePct: number;
  vwap: number | null;
  ivRank: number | null;
  dayHigh: number;
  dayLow: number;
  timestamp: string | null;
  marketOpen: boolean;
  strategy: Strategy;
  onStrategyChange: (s: Strategy) => void;
  onAnalyze: () => void;
  isAnalyzing: boolean;
  isConnected: boolean;
}) {
  return (
    <div>
      <p style={{ color: '#666', marginBottom: 12 }}>&gt; MARKET ASSESSMENT</p>

      {/* Strategy selector */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ color: '#888', fontSize: 12, display: 'block', marginBottom: 4 }}>Strategy</label>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['strangle', 'put-only', 'call-only'] as Strategy[]).map(s => (
            <button
              key={s}
              onClick={() => onStrategyChange(s)}
              style={{
                flex: 1,
                padding: '6px 0',
                background: strategy === s ? '#333' : 'transparent',
                border: `1px solid ${strategy === s ? '#555' : '#333'}`,
                color: strategy === s ? '#fff' : '#666',
                fontSize: 12,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {s.toUpperCase().replace('-', ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Market data */}
      <div style={{ background: '#111', border: '1px solid #222', padding: 12, marginBottom: 12 }}>
        <Row
          label="SPY"
          value={`$${spyPrice.toFixed(2)} (${spyChangePct >= 0 ? '+' : ''}${spyChangePct.toFixed(2)}%)`}
          valueColor={spyChangePct >= 0 ? '#4ade80' : '#ef4444'}
        />
        {(spyBid || spyAsk) && (
          <Row
            label="Bid/Ask"
            value={`$${spyBid?.toFixed(2) ?? '—'} / $${spyAsk?.toFixed(2) ?? '—'}${bidAskSpread ? ` ($${bidAskSpread.toFixed(2)})` : ''}`}
            valueColor="#888"
          />
        )}
        <Row
          label="VIX"
          value={`${vix.toFixed(2)}${vixChangePct !== 0 ? ` (${vixChangePct >= 0 ? '+' : ''}${vixChangePct.toFixed(1)}%)` : ''}`}
          valueColor={vix > 20 ? '#f59e0b' : '#888'}
        />
        {vwap && <Row label="VWAP" value={`$${vwap.toFixed(2)}`} valueColor="#87ceeb" />}
        {ivRank !== null && <Row label="IV Rank" value={`${ivRank.toFixed(0)}%`} valueColor="#87ceeb" />}
        {dayLow !== dayHigh && (
          <Row label="Day Range" value={`$${dayLow.toFixed(2)} - $${dayHigh.toFixed(2)}`} valueColor="#888" />
        )}
        <Row label="Market" value={marketOpen ? 'OPEN' : 'CLOSED'} valueColor={marketOpen ? '#4ade80' : '#ef4444'} />
      </div>
      {timestamp && (
        <p style={{ color: '#666', fontSize: 11, textAlign: 'center', marginBottom: 8 }}>
          Updated: {new Date(timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/New_York' })} ET
        </p>
      )}

      {/* Analyze button */}
      <button
        onClick={onAnalyze}
        disabled={isAnalyzing || !isConnected}
        style={{
          width: '100%',
          padding: '10px 0',
          background: isAnalyzing ? '#333' : '#3b82f6',
          border: 'none',
          color: '#fff',
          fontSize: 13,
          cursor: isAnalyzing || !isConnected ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit',
          fontWeight: 500,
        }}
      >
        {isAnalyzing ? 'ANALYZING...' : 'ANALYZE MARKET'}
      </button>
    </div>
  );
}

// Step 2: Direction
function Step2Direction({
  analysis,
  strategy,
  onStrategyChange,
}: {
  analysis: any;
  strategy: Strategy;
  onStrategyChange: (s: Strategy) => void;
}) {
  const direction = analysis?.q2Direction?.recommendedDirection ?? 'STRANGLE';
  const confidence = analysis?.q2Direction?.confidence ?? 0;
  const trend = analysis?.q2Direction?.signals?.trend ?? 'NEUTRAL';

  return (
    <div>
      <p style={{ color: '#666', marginBottom: 12 }}>&gt; DIRECTION</p>

      {/* Recommendation */}
      <div style={{ background: '#111', border: '1px solid #222', padding: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ color: '#888' }}>Recommendation</span>
          <span style={{ color: direction === 'PUT' ? '#ef4444' : direction === 'CALL' ? '#4ade80' : '#87ceeb', fontWeight: 500 }}>
            {direction === 'PUT' ? 'BEARISH PUT' : direction === 'CALL' ? 'BULLISH CALL' : 'STRANGLE'}
          </span>
        </div>
        <Row label="Confidence" value={`${(confidence * 100).toFixed(0)}%`} valueColor={confidence > 0.7 ? '#4ade80' : '#f59e0b'} />
        <Row label="Trend" value={trend} />
      </div>

      {/* Override */}
      <div style={{ marginBottom: 8 }}>
        <label style={{ color: '#888', fontSize: 12, display: 'block', marginBottom: 4 }}>Override Direction</label>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['put-only', 'call-only', 'strangle'] as Strategy[]).map(s => (
            <button
              key={s}
              onClick={() => onStrategyChange(s)}
              style={{
                flex: 1,
                padding: '6px 0',
                background: strategy === s ? '#333' : 'transparent',
                border: `1px solid ${strategy === s ? '#555' : '#333'}`,
                color: strategy === s ? '#fff' : '#666',
                fontSize: 12,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {s === 'put-only' ? 'PUT' : s === 'call-only' ? 'CALL' : 'STRANGLE'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Step 3: Strike Selection
function Step3Strikes({
  spyPrice,
  putCandidates,
  callCandidates,
  selectedPutStrike,
  selectedCallStrike,
  onPutSelect,
  onCallSelect,
  premiumPerContract,
}: {
  spyPrice: number;
  putCandidates: StrikeCandidate[];
  callCandidates: StrikeCandidate[];
  selectedPutStrike: number | null;
  selectedCallStrike: number | null;
  onPutSelect: (strike: number | null) => void;
  onCallSelect: (strike: number | null) => void;
  premiumPerContract: number;
}) {
  return (
    <div>
      <p style={{ color: '#666', marginBottom: 8 }}>&gt; SELECT STRIKES</p>
      <p style={{ color: '#888', fontSize: 12, marginBottom: 12 }}>SPY ${spyPrice.toFixed(2)}</p>

      {/* Puts */}
      {putCandidates.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <p style={{ color: '#ef4444', fontSize: 12, marginBottom: 4 }}>PUTS</p>
          <div style={{ maxHeight: 100, overflow: 'auto' }}>
            {putCandidates.slice(0, 6).map(s => (
              <StrikeRow
                key={s.strike}
                strike={s.strike}
                bid={s.bid}
                delta={s.delta}
                selected={selectedPutStrike === s.strike}
                recommended={s.isEngineRecommended}
                onClick={() => onPutSelect(selectedPutStrike === s.strike ? null : s.strike)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Calls */}
      {callCandidates.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <p style={{ color: '#4ade80', fontSize: 12, marginBottom: 4 }}>CALLS</p>
          <div style={{ maxHeight: 100, overflow: 'auto' }}>
            {callCandidates.slice(0, 6).map(s => (
              <StrikeRow
                key={s.strike}
                strike={s.strike}
                bid={s.bid}
                delta={s.delta}
                selected={selectedCallStrike === s.strike}
                recommended={s.isEngineRecommended}
                onClick={() => onCallSelect(selectedCallStrike === s.strike ? null : s.strike)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Summary */}
      <div style={{ background: '#111', border: '1px solid #222', padding: 8 }}>
        <Row label="Total Premium" value={`$${(premiumPerContract * 100).toFixed(0)}/contract`} valueColor="#4ade80" />
      </div>
    </div>
  );
}

function StrikeRow({
  strike,
  bid,
  delta,
  selected,
  recommended,
  onClick,
}: {
  strike: number;
  bid: number;
  delta: number;
  selected: boolean;
  recommended?: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '4px 8px',
        background: selected ? '#1e3a5f' : 'transparent',
        border: `1px solid ${selected ? '#3b82f6' : '#222'}`,
        marginBottom: 2,
        cursor: 'pointer',
        fontSize: 13,
      }}
    >
      <span style={{ color: recommended ? '#f59e0b' : '#fff' }}>
        {strike}{recommended ? '*' : ''}
      </span>
      <span style={{ color: '#888' }}>${bid.toFixed(2)}</span>
      <span style={{ color: '#666' }}>{Math.abs(delta).toFixed(2)}d</span>
    </div>
  );
}

// Step 4: Position Size
function Step4Size({
  riskTier,
  onRiskTierChange,
  contracts,
  premiumPerContract,
  totalPremium,
  nav,
}: {
  riskTier: RiskTier;
  onRiskTierChange: (tier: RiskTier) => void;
  contracts: number;
  premiumPerContract: number;
  totalPremium: number;
  nav: number;
}) {
  const pctOfNav = nav > 0 ? ((totalPremium / nav) * 100).toFixed(2) : '0.00';

  return (
    <div>
      <p style={{ color: '#666', marginBottom: 12 }}>&gt; POSITION SIZE</p>

      {/* Risk tier selector */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ color: '#888', fontSize: 12, display: 'block', marginBottom: 4 }}>Risk Tier</label>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['conservative', 'balanced', 'aggressive'] as RiskTier[]).map(tier => {
            const c = tier === 'conservative' ? 1 : tier === 'balanced' ? 2 : 3;
            const p = premiumPerContract * c * 100;
            return (
              <button
                key={tier}
                onClick={() => onRiskTierChange(tier)}
                style={{
                  flex: 1,
                  padding: '8px 4px',
                  background: riskTier === tier ? '#333' : 'transparent',
                  border: `1px solid ${riskTier === tier ? '#555' : '#333'}`,
                  color: riskTier === tier ? '#fff' : '#666',
                  fontSize: 12,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  textAlign: 'center',
                }}
              >
                <div>{tier.slice(0, 4).toUpperCase()}</div>
                <div style={{ color: '#888', fontSize: 9 }}>{c}x | ${p.toFixed(0)}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Summary */}
      <div style={{ background: '#111', border: '1px solid #222', padding: 12 }}>
        <Row label="Contracts" value={contracts.toString()} />
        <Row label="Premium" value={`$${totalPremium.toFixed(0)}`} valueColor="#4ade80" />
        {nav > 0 && <Row label="% of NAV" value={`${pctOfNav}%`} />}
      </div>
    </div>
  );
}

// Step 5: Execute
function Step5Execute({
  selectedPut,
  selectedCall,
  contracts,
  totalPremium,
  stopMultiplier,
  onStopMultiplierChange,
  stopLossAmount,
  maxLoss,
  showConfirm,
  onShowConfirm,
  onCancel,
  onExecute,
  isExecuting,
}: {
  selectedPut: StrikeCandidate | undefined;
  selectedCall: StrikeCandidate | undefined;
  contracts: number;
  totalPremium: number;
  stopMultiplier: StopMultiplier;
  onStopMultiplierChange: (m: StopMultiplier) => void;
  stopLossAmount: number;
  maxLoss: number;
  showConfirm: boolean;
  onShowConfirm: () => void;
  onCancel: () => void;
  onExecute: () => void;
  isExecuting: boolean;
}) {
  return (
    <div>
      <p style={{ color: '#666', marginBottom: 12 }}>&gt; EXECUTE TRADE</p>

      {/* Order preview */}
      <div style={{ background: '#111', border: '1px solid #222', padding: 12, marginBottom: 12 }}>
        <p style={{ color: '#87ceeb', marginBottom: 8, fontSize: 13 }}>ORDER PREVIEW</p>
        {selectedPut && (
          <Row label={`SELL SPY ${selectedPut.strike}P`} value={`$${selectedPut.bid.toFixed(2)}`} valueColor="#ef4444" />
        )}
        {selectedCall && (
          <Row label={`SELL SPY ${selectedCall.strike}C`} value={`$${selectedCall.bid.toFixed(2)}`} valueColor="#4ade80" />
        )}
        <div style={{ borderTop: '1px solid #333', marginTop: 8, paddingTop: 8 }}>
          <Row label="Contracts" value={contracts.toString()} />
          <Row label="Entry Premium" value={`$${totalPremium.toFixed(0)}`} valueColor="#4ade80" />
        </div>
      </div>

      {/* Stop loss selector */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ color: '#888', fontSize: 12, display: 'block', marginBottom: 4 }}>Stop Loss</label>
        <div style={{ display: 'flex', gap: 4 }}>
          {([2, 3, 4] as StopMultiplier[]).map(m => (
            <button
              key={m}
              onClick={() => onStopMultiplierChange(m)}
              style={{
                flex: 1,
                padding: '6px 0',
                background: stopMultiplier === m ? '#333' : 'transparent',
                border: `1px solid ${stopMultiplier === m ? '#555' : '#333'}`,
                color: stopMultiplier === m ? '#fff' : '#666',
                fontSize: 12,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {m}x
            </button>
          ))}
        </div>
        <div style={{ color: '#888', fontSize: 12, marginTop: 4 }}>
          Stop: ${stopLossAmount.toFixed(0)} | Max Loss: ${maxLoss.toFixed(0)}
        </div>
      </div>

      {/* Confirmation */}
      {showConfirm ? (
        <div style={{ background: '#1a1a1a', border: '1px solid #ef4444', padding: 12 }}>
          <p style={{ color: '#ef4444', marginBottom: 8, fontWeight: 500 }}>&gt; CONFIRM LIVE TRADE</p>
          <p style={{ color: '#888', fontSize: 13, marginBottom: 12 }}>
            This will place a real order. Max loss: ${maxLoss.toFixed(0)}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onExecute}
              disabled={isExecuting}
              style={{
                flex: 1,
                padding: '10px 0',
                background: '#ef4444',
                border: 'none',
                color: '#fff',
                fontSize: 13,
                cursor: isExecuting ? 'wait' : 'pointer',
                fontFamily: 'inherit',
                fontWeight: 500,
              }}
            >
              {isExecuting ? 'EXECUTING...' : 'EXECUTE'}
            </button>
            <button
              onClick={onCancel}
              disabled={isExecuting}
              style={{
                flex: 1,
                padding: '10px 0',
                background: 'none',
                border: '1px solid #333',
                color: '#888',
                fontSize: 13,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              CANCEL
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={onShowConfirm}
          style={{
            width: '100%',
            padding: '12px 0',
            background: '#4ade80',
            border: 'none',
            color: '#000',
            fontSize: 13,
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontWeight: 500,
          }}
        >
          EXECUTE TRADE
        </button>
      )}
    </div>
  );
}

// Helper row component
function Row({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13 }}>
      <span style={{ color: '#888' }}>{label}</span>
      <span style={{ color: valueColor || '#fff' }}>{value}</span>
    </div>
  );
}
