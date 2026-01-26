/**
 * EngineWindow - Gaming HUD style trading interface
 *
 * Single-screen layout with:
 * - Top bar: market data, connection, mode
 * - Main area: streaming analysis log
 * - Selection bar: strategy and strikes
 * - Action bar: analyze/execute
 *
 * Keyboard-driven with MANUAL/AUTO modes
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useWebSocket } from '@/hooks/use-websocket';
import { useEngineAnalysis } from '@/hooks/useEngineAnalysis';
import { useAgentOperator } from '@/hooks/useAgentOperator';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  TopBar,
  MainArea,
  SelectionBar,
  ActionBar,
  CommandInput,
  useKeyboardControls,
  type LogLine,
  type Strategy,
} from './engine';

// Agent command mapping
type AgentCommand = '/vix' | '/market' | '/positions' | '/analyze' | '/help';

const AGENT_COMMANDS: Record<AgentCommand, { operation: 'analyze' | 'positions'; params?: { focus?: string } }> = {
  '/vix': { operation: 'analyze', params: { focus: 'vix' } },
  '/market': { operation: 'analyze', params: { focus: 'market' } },
  '/positions': { operation: 'positions' },
  '/analyze': { operation: 'analyze' },
  '/help': { operation: 'analyze' }, // Will be handled specially
};

type Mode = 'MANUAL' | 'AUTO';

export function EngineWindow() {
  // Mode state
  const [mode, setMode] = useState<Mode>('MANUAL');
  const [autoCountdown, setAutoCountdown] = useState(300); // 5 minutes
  const [showHelp, setShowHelp] = useState(false);

  // Strategy and position state
  const [strategy, setStrategy] = useState<Strategy>('strangle');
  const [contracts, setContracts] = useState(2);
  const [putStrike, setPutStrike] = useState<number | null>(null);
  const [callStrike, setCallStrike] = useState<number | null>(null);
  const [spreadWidth, setSpreadWidth] = useState(5);

  // Log lines for streaming display
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [hudState, setHudState] = useState<'idle' | 'analyzing' | 'ready'>('idle');

  // WebSocket for real-time market data
  const { isConnected: wsConnected, onChartPriceUpdate } = useWebSocket();
  const [wsSpyPrice, setWsSpyPrice] = useState(0);
  const [wsVix, setWsVix] = useState(0);

  // Engine analysis hook - map HUD strategy to engine strategy
  const engineStrategy = strategy === 'put-spread' ? 'put-only' : strategy === 'call-spread' ? 'call-only' : 'strangle';
  const {
    analyze,
    isAnalyzing,
    currentStep: engineStep,
    completedSteps,
    analysis,
    error: analysisError,
  } = useEngineAnalysis({
    symbol: 'SPY',
    strategy: engineStrategy,
    riskTier: 'balanced',
  });

  // Agent operator for AI-powered commands
  const {
    operate: agentOperate,
    activities: agentActivities,
    isProcessing: agentProcessing,
  } = useAgentOperator({ enableStatusPolling: false });

  // Broker status
  const { data: ibkrStatus } = useQuery<{
    configured: boolean;
    connected: boolean;
    accountId?: string;
    nav?: number;
  }>({
    queryKey: ['/api/ibkr/status'],
    queryFn: async () => {
      const res = await fetch('/api/ibkr/status', { credentials: 'include' });
      if (!res.ok) return { configured: false, connected: false };
      return res.json();
    },
    refetchInterval: 30000,
  });

  // Subscribe to WebSocket price updates
  useEffect(() => {
    console.log('[EngineWindow] Setting up WebSocket price subscription, wsConnected:', wsConnected);

    const unsubscribe = onChartPriceUpdate((price, symbol, timestamp) => {
      console.log('[EngineWindow] Received price update:', { symbol, price, timestamp });
      if (symbol === 'SPY') {
        setWsSpyPrice(price);
      } else if (symbol === 'VIX') {
        setWsVix(price);
      }
    });
    return () => {
      console.log('[EngineWindow] Cleaning up WebSocket subscription');
      unsubscribe();
    };
  }, [onChartPriceUpdate, wsConnected]);

  // Execute trade mutation
  const executeMutation = useMutation({
    mutationFn: async (proposal: any) => {
      const res = await fetch('/api/engine/execute-paper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ tradeProposal: proposal }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to execute trade');
      }
      return res.json();
    },
    onSuccess: () => {
      addLogLine('TRADE EXECUTED SUCCESSFULLY', 'success');
      setHudState('idle');
      setLogLines([]);
    },
    onError: (err) => {
      addLogLine(`Execution failed: ${err.message}`, 'error');
    },
  });

  // Derived values - prefer WebSocket prices, fall back to analysis data
  const spyPrice = wsSpyPrice > 0 ? wsSpyPrice : (analysis?.q1MarketRegime?.inputs?.spyPrice ?? 0);
  const spyChangePct = 0; // Not available without market data API
  const vix = wsVix > 0 ? wsVix : (analysis?.q1MarketRegime?.inputs?.vixValue ?? 0);
  const isConnected = ibkrStatus?.connected ?? false;
  const isWsConnected = wsConnected;

  // Calculate credit
  const credit = useMemo(() => {
    if (!analysis?.q3Strikes) return 0;
    const putPremium = analysis.q3Strikes.selectedPut?.premium ?? 0;
    const callPremium = analysis.q3Strikes.selectedCall?.premium ?? 0;

    if (strategy === 'put-spread') return putPremium * contracts;
    if (strategy === 'call-spread') return callPremium * contracts;
    return (putPremium + callPremium) * contracts;
  }, [analysis, strategy, contracts]);

  // Add log line helper
  const addLogLine = useCallback((text: string, type: LogLine['type']) => {
    const now = new Date();
    const timestamp = now.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    setLogLines((prev) => [...prev, { timestamp, text, type }]);
  }, []);

  // Track which log entries we've added to prevent duplicates
  const [loggedSteps, setLoggedSteps] = useState<Set<string>>(new Set());

  // Handle analysis errors - show in log and reset state
  useEffect(() => {
    if (analysisError && !loggedSteps.has('error')) {
      addLogLine(analysisError, 'error');
      setLoggedSteps(prev => new Set([...prev, 'error']));
      setHudState('idle');
    }
  }, [analysisError, loggedSteps, addLogLine]);

  // Stream analysis steps to log
  useEffect(() => {
    if (isAnalyzing) {
      setHudState('analyzing');
    }

    // Log each step completion (with deduplication)
    if (completedSteps.has(1) && !loggedSteps.has('step1')) {
      const vixVal = analysis?.q1MarketRegime?.inputs?.vixValue ?? 0;
      const regime = analysis?.q1MarketRegime?.regimeLabel ?? 'NORMAL';
      addLogLine(`VIX ${vixVal.toFixed(1)} - ${regime.toLowerCase()}, ${regime === 'ELEVATED' ? 'caution advised' : 'safe to trade'}`, 'success');
      setLoggedSteps(prev => new Set([...prev, 'step1']));
    }

    if (completedSteps.has(2) && !loggedSteps.has('step2')) {
      const direction = analysis?.q2Direction?.recommendedDirection ?? 'NEUTRAL';
      const conf = analysis?.q2Direction?.confidencePct ?? 70;
      addLogLine(`${direction} bias detected (${conf}% confidence)`, 'success');
      setLoggedSteps(prev => new Set([...prev, 'step2']));
    }

    if (completedSteps.has(3) && !loggedSteps.has('step3')) {
      const putStrikeVal = analysis?.q3Strikes?.selectedPut?.strike;
      const callStrikeVal = analysis?.q3Strikes?.selectedCall?.strike;
      const putDelta = Math.abs(analysis?.q3Strikes?.selectedPut?.delta ?? 0.12);
      const callDelta = Math.abs(analysis?.q3Strikes?.selectedCall?.delta ?? 0.12);

      if (putStrikeVal) {
        setPutStrike(putStrikeVal);
        addLogLine(`PUT SPREAD: ${putStrikeVal}/${putStrikeVal - spreadWidth} @ $${(analysis?.q3Strikes?.selectedPut?.premium ?? 0).toFixed(2)} credit (${(putDelta * 100).toFixed(0)}d)`, 'success');
      }
      if (callStrikeVal) {
        setCallStrike(callStrikeVal);
        addLogLine(`CALL SPREAD: ${callStrikeVal}/${callStrikeVal + spreadWidth} @ $${(analysis?.q3Strikes?.selectedCall?.premium ?? 0).toFixed(2)} credit (${(callDelta * 100).toFixed(0)}d)`, 'success');
      }
      if (putStrikeVal && callStrikeVal) {
        const totalCredit = (analysis?.q3Strikes?.selectedPut?.premium ?? 0) + (analysis?.q3Strikes?.selectedCall?.premium ?? 0);
        addLogLine(`STRANGLE: $${totalCredit.toFixed(2)} total credit`, 'result');
      }
      setLoggedSteps(prev => new Set([...prev, 'step3']));
    }

    if (completedSteps.has(4) && !loggedSteps.has('step4')) {
      const contractCount = analysis?.q4Size?.recommendedContracts ?? contracts;
      const nav = ibkrStatus?.nav ?? 100000;
      const maxLoss = (analysis?.tradeProposal?.maxLoss ?? 0);
      const maxProfit = credit * 100;
      setContracts(contractCount);
      addLogLine(`Account: $${nav.toLocaleString()} | Risk: 2% | Contracts: ${contractCount}`, 'info');
      addLogLine(`Max loss: $${maxLoss.toFixed(0)} | Max profit: $${maxProfit.toFixed(0)}`, 'info');
      setLoggedSteps(prev => new Set([...prev, 'step4']));
    }

    // When all steps complete
    if (completedSteps.size >= 4 && !isAnalyzing && hudState === 'analyzing') {
      setHudState('ready');
    }
  }, [completedSteps, isAnalyzing, analysis, hudState, addLogLine, contracts, credit, ibkrStatus?.nav, spreadWidth, loggedSteps]);

  // Stream agent activities to log
  useEffect(() => {
    if (agentActivities.length === 0) return;

    // Get the most recent activity
    const latest = agentActivities[agentActivities.length - 1];

    // Skip if we've already logged this activity
    if (loggedSteps.has(`agent_${latest.id}`)) return;

    // Map agent activity types to log line types
    const typeMap: Record<string, LogLine['type']> = {
      action: 'header',
      thinking: 'info',
      result: 'success',
      tool_progress: 'success',
      info: 'info',
      error: 'error',
    };

    const logType = typeMap[latest.type] || 'info';
    addLogLine(latest.content, logType);
    setLoggedSteps(prev => new Set([...prev, `agent_${latest.id}`]));
  }, [agentActivities, loggedSteps, addLogLine]);

  // Start analysis header
  const handleAnalyze = useCallback(() => {
    setLogLines([]);
    setLoggedSteps(new Set());
    setHudState('analyzing');
    addLogLine('SCANNING MARKET...', 'header');
    analyze();
  }, [analyze, addLogLine]);

  // Reset
  const handleReset = useCallback(() => {
    setLogLines([]);
    setLoggedSteps(new Set());
    setHudState('idle');
    setPutStrike(null);
    setCallStrike(null);
  }, []);

  // Handle agent commands (V, M, P hotkeys or typed /commands)
  const handleAgentCommand = useCallback((command: AgentCommand) => {
    if (agentProcessing) return;

    // Handle /help specially
    if (command === '/help') {
      setLogLines([]);
      setLoggedSteps(new Set());
      addLogLine('AVAILABLE COMMANDS', 'header');
      addLogLine('/vix - VIX analysis and volatility regime', 'info');
      addLogLine('/market - Full market snapshot', 'info');
      addLogLine('/positions - Current holdings', 'info');
      addLogLine('/analyze - Full 5-step analysis', 'info');
      addLogLine('Press V, M, P, A for quick access', 'info');
      return;
    }

    const config = AGENT_COMMANDS[command];
    if (!config) return;

    // Clear log and start agent operation
    setLogLines([]);
    setLoggedSteps(new Set());
    setHudState('analyzing');
    addLogLine(`Running ${command.slice(1).toUpperCase()}...`, 'header');

    agentOperate(config.operation, { message: config.params?.focus });
  }, [agentProcessing, agentOperate, addLogLine]);

  // Handle typed command input (including natural language)
  const handleCommandInput = useCallback((input: string) => {
    // Check if it's a known command
    const command = input.toLowerCase() as AgentCommand;
    if (AGENT_COMMANDS[command]) {
      handleAgentCommand(command);
      return;
    }

    // Treat as natural language query
    if (!agentProcessing) {
      setLogLines([]);
      setLoggedSteps(new Set());
      setHudState('analyzing');
      addLogLine(`Query: ${input}`, 'header');
      agentOperate('analyze', { message: input });
    }
  }, [handleAgentCommand, agentProcessing, agentOperate, addLogLine]);

  // Execute
  const handleExecute = useCallback(() => {
    if (hudState !== 'ready' || !analysis?.tradeProposal) return;
    executeMutation.mutate(analysis.tradeProposal);
  }, [hudState, analysis, executeMutation]);

  // Mode toggle
  const handleModeToggle = useCallback(() => {
    setMode((m) => (m === 'MANUAL' ? 'AUTO' : 'MANUAL'));
    setAutoCountdown(300);
  }, []);

  // Auto mode countdown
  useEffect(() => {
    if (mode !== 'AUTO') return;

    const interval = setInterval(() => {
      setAutoCountdown((c) => {
        if (c <= 1) {
          // Auto-analyze when countdown hits 0
          if (hudState === 'idle' && isConnected) {
            handleAnalyze();
          }
          return 300; // Reset to 5 minutes
        }
        return c - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [mode, hudState, isConnected, handleAnalyze]);

  // Calculate progress
  const progress = useMemo(() => {
    if (!isAnalyzing) return completedSteps.size >= 4 ? 100 : 0;
    return (engineStep / 5) * 100;
  }, [isAnalyzing, engineStep, completedSteps.size]);

  // Keyboard controls
  useKeyboardControls({
    enabled: false, // DISABLED: Preventing accidental triggers while testing WebSocket
    onStrategyChange: setStrategy,
    onStrikeAdjust: (dir) => {
      setSpreadWidth((w) => (dir === 'wider' ? Math.min(w + 1, 10) : Math.max(w - 1, 1)));
    },
    onContractAdjust: (dir) => {
      setContracts((c) => (dir === 'up' ? Math.min(c + 1, 10) : Math.max(c - 1, 1)));
    },
    onModeToggle: handleModeToggle,
    onEnter: hudState === 'ready' ? handleExecute : handleAnalyze,
    onEscape: handleReset,
    onAnalyze: handleAnalyze,
    onRefresh: () => {
      // R key reserved for future agent commands
    },
    onShowHelp: () => setShowHelp((h) => !h),
    onPauseAuto: () => {
      if (mode === 'AUTO') {
        setMode('MANUAL');
        addLogLine('AUTO MODE PAUSED', 'info');
      }
    },
    // Agent command hotkeys
    onVix: () => handleAgentCommand('/vix'),
    onMarket: () => handleAgentCommand('/market'),
    onPositions: () => handleAgentCommand('/positions'),
  });

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#0a0a0a',
        color: '#00ff00',
        fontFamily: "'IBM Plex Mono', 'JetBrains Mono', monospace",
      }}
    >
      {/* Top bar */}
      <TopBar
        spyPrice={spyPrice}
        spyChangePct={spyChangePct}
        vix={vix}
        isConnected={isConnected}
        wsConnected={isWsConnected}
        mode={mode}
        autoCountdown={mode === 'AUTO' ? autoCountdown : undefined}
        onModeToggle={handleModeToggle}
      />

      {/* Main area */}
      <MainArea
        lines={logLines}
        isAnalyzing={isAnalyzing}
        progress={progress}
        isReady={hudState === 'ready'}
      />

      {/* Command input */}
      <CommandInput
        onCommand={handleCommandInput}
        disabled={agentProcessing || isAnalyzing}
        placeholder={agentProcessing ? 'Processing...' : '/help for commands'}
      />

      {/* Selection bar */}
      <SelectionBar
        strategy={strategy}
        onStrategyChange={setStrategy}
        putStrike={putStrike}
        callStrike={callStrike}
        putSpread={spreadWidth}
        callSpread={spreadWidth}
      />

      {/* Action bar */}
      <ActionBar
        state={hudState}
        credit={credit}
        contracts={contracts}
        onAnalyze={handleAnalyze}
        onExecute={handleExecute}
        onReset={handleReset}
        isExecuting={executeMutation.isPending}
      />

      {/* Help overlay */}
      {showHelp && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
          onClick={() => setShowHelp(false)}
        >
          <div
            style={{
              padding: 24,
              background: '#111',
              border: '1px solid #333',
              color: '#888',
              fontSize: 13,
              lineHeight: 1.8,
            }}
          >
            <div style={{ color: '#00ffff', marginBottom: 16, fontSize: 14 }}>KEYBOARD SHORTCUTS</div>
            <div style={{ color: '#888', marginBottom: 8 }}>TRADING</div>
            <div>[1] [2] [3] - Select strategy</div>
            <div>[{'\u2190'}] [{'\u2192'}] - Adjust spread width</div>
            <div>[{'\u2191'}] [{'\u2193'}] - Adjust contracts</div>
            <div>[Tab] - Toggle AUTO/MANUAL</div>
            <div>[Enter] - Analyze / Execute</div>
            <div>[Esc] - Reset</div>
            <div>[A] - Analyze now</div>
            <div>[Space] - Pause auto mode</div>
            <div style={{ color: '#888', marginTop: 12, marginBottom: 8 }}>AGENT COMMANDS</div>
            <div>[V] - VIX analysis</div>
            <div>[M] - Market snapshot</div>
            <div>[P] - Current positions</div>
            <div style={{ color: '#555', marginTop: 12 }}>Type /help in command bar for more</div>
            <div style={{ marginTop: 16, color: '#555', fontSize: 11 }}>Press any key to close</div>
          </div>
        </div>
      )}
    </div>
  );
}
