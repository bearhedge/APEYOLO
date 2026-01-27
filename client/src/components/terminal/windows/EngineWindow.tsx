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
  CommandMenu,
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
  const [showCommandMenu, setShowCommandMenu] = useState(false);

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
  const [wsSpyBid, setWsSpyBid] = useState(0);
  const [wsSpyAsk, setWsSpyAsk] = useState(0);
  const [wsSpyPrevClose, setWsSpyPrevClose] = useState(0);
  const [wsVix, setWsVix] = useState(0);
  const [wsVixBid, setWsVixBid] = useState(0);
  const [wsVixAsk, setWsVixAsk] = useState(0);
  const [wsVixPrevClose, setWsVixPrevClose] = useState(0);
  const [wsVixIsClose, setWsVixIsClose] = useState(false);

  // Delayed data indicator (when using Yahoo fallback during extended hours)
  const [isDelayed, setIsDelayed] = useState(false);

  // Engine analysis hook - map HUD strategy to engine strategy
  const engineStrategy = strategy === 'put-spread' ? 'put-only' : strategy === 'call-spread' ? 'call-only' : 'strangle';
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

    const unsubscribe = onChartPriceUpdate((data) => {
      console.log('[EngineWindow] Received price update:', data);
      if (data.symbol === 'SPY') {
        setWsSpyPrice(data.price);
        setWsSpyBid(data.bid);
        setWsSpyAsk(data.ask);
        setWsSpyPrevClose(data.previousClose);
      } else if (data.symbol === 'VIX') {
        setWsVix(data.price);
        setWsVixBid(data.bid);
        setWsVixAsk(data.ask);
        setWsVixPrevClose(data.previousClose);
        setWsVixIsClose(data.isClose || false);
      }
    });
    return () => {
      console.log('[EngineWindow] Cleaning up WebSocket subscription');
      unsubscribe();
    };
  }, [onChartPriceUpdate, wsConnected]);

  // Poll for extended hours data (OVERNIGHT, PRE, POST sessions)
  // When IBKR WebSocket is stale, server uses Yahoo Finance fallback
  useEffect(() => {
    // Detect extended hours (client-side approximation)
    const getMarketSession = () => {
      const now = new Date();
      const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const day = et.getDay();
      const hour = et.getHours();
      const min = et.getMinutes();
      const time = hour * 60 + min;

      // Weekend
      if (day === 0 || day === 6) return 'CLOSED';
      // Pre-market: 4:00 AM - 9:30 AM
      if (time >= 240 && time < 570) return 'PRE';
      // Regular: 9:30 AM - 4:00 PM
      if (time >= 570 && time < 960) return 'OPEN';
      // After-hours: 4:00 PM - 8:00 PM
      if (time >= 960 && time < 1200) return 'AH';
      // Overnight: 8:00 PM - 4:00 AM
      return 'OVERNIGHT';
    };

    const session = getMarketSession();
    const isExtendedHours = session === 'OVERNIGHT' || session === 'PRE' || session === 'AH';

    if (!isExtendedHours) {
      setIsDelayed(false);
      return;
    }

    // Poll every 2 minutes during extended hours
    const fetchSnapshot = async () => {
      try {
        const res = await fetch('/api/broker/stream/snapshot', { credentials: 'include' });
        if (!res.ok) return;

        const data = await res.json();
        if (data.ok && data.available) {
          // Update delayed flag
          setIsDelayed(data.isDelayed || false);

          // Update prices from snapshot if WebSocket is stale
          if (data.isDelayed && data.snapshot) {
            const snap = data.snapshot;
            if (snap.spyPrice > 0) {
              setWsSpyPrice(snap.spyPrice);
              setWsSpyBid(snap.spyBid || snap.spyPrice);
              setWsSpyAsk(snap.spyAsk || snap.spyPrice);
              setWsSpyPrevClose(snap.spyPrevClose || 0);
            }
            if (snap.vix > 0) {
              setWsVix(snap.vix);
            }
          }
        }
      } catch (err) {
        console.warn('[EngineWindow] Overnight snapshot fetch failed:', err);
      }
    };

    // Fetch immediately and then every 2 minutes
    fetchSnapshot();
    const interval = setInterval(fetchSnapshot, 2 * 60 * 1000);
    console.log('[EngineWindow] Started extended hours polling (every 2 min)');

    return () => {
      clearInterval(interval);
      console.log('[EngineWindow] Stopped extended hours polling');
    };
  }, []); // Run once on mount, session detection happens inside

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
  const spyBid = wsSpyBid > 0 ? wsSpyBid : spyPrice;
  const spyAsk = wsSpyAsk > 0 ? wsSpyAsk : spyPrice;
  const spyPrevClose = wsSpyPrevClose;
  const spyChangePct = analysis?.q1MarketRegime?.inputs?.spyChangePct ?? 0;
  const vix = wsVix > 0 ? wsVix : (analysis?.q1MarketRegime?.inputs?.vixValue ?? 0);
  const vixBid = wsVixBid > 0 ? wsVixBid : vix;
  const vixAsk = wsVixAsk > 0 ? wsVixAsk : vix;
  const vixPrevClose = wsVixPrevClose;
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
      // Use WebSocket VIX if available, otherwise fall back to analysis result
      const vixVal = wsVix > 0 ? wsVix : (analysis?.q1MarketRegime?.inputs?.vixValue ?? 0);
      const regime = analysis?.q1MarketRegime?.regimeLabel ?? 'NORMAL';
      const regimeStr = String(regime);
      addLogLine(`VIX ${vixVal.toFixed(1)} - ${regimeStr.toLowerCase()}, ${regimeStr === 'ELEVATED' ? 'caution advised' : 'safe to trade'}`, 'success');
      setLoggedSteps(prev => new Set([...prev, 'step1']));
    }

    if (completedSteps.has(2) && !loggedSteps.has('step2')) {
      // Skip bias message per user request - just mark step as logged
      setLoggedSteps(prev => new Set([...prev, 'step2']));
    }

    if (completedSteps.has(3) && !loggedSteps.has('step3')) {
      // Use stepResults for streaming (available immediately when step completes),
      // fall back to analysis for after final assembly
      const step3Data = stepResults?.step3;
      const putStrikeVal = step3Data?.putStrike?.strike;
      const callStrikeVal = step3Data?.callStrike?.strike;

      // Set selected strikes
      if (putStrikeVal) setPutStrike(putStrikeVal);
      if (callStrikeVal) setCallStrike(callStrikeVal);

      // Get candidate strikes from step3 results (smartCandidates or nearbyStrikes)
      const putCandidates = step3Data?.smartCandidates?.puts || step3Data?.nearbyStrikes?.puts || [];
      const callCandidates = step3Data?.smartCandidates?.calls || step3Data?.nearbyStrikes?.calls || [];

      // Print PUT option chain
      if (putCandidates.length > 0) {
        addLogLine(`PUTS (0DTE) - ${putCandidates.length} strikes:`, 'success');
        addLogLine('─────────────────────────────────', 'info');
        putCandidates.slice(0, 5).forEach((p: any) => {
          const isSelected = p.strike === putStrikeVal;
          const arrow = isSelected ? '→ ' : '  ';
          const selected = isSelected ? ' ← SELECTED' : '';
          const bid = p.bid ?? 0;
          const ask = p.ask ?? 0;
          const delta = Math.abs(p.delta ?? 0);
          const deltaStr = `.${(delta * 100).toFixed(0).padStart(2, '0')}`;
          addLogLine(`${arrow}${p.strike}  │  ${bid.toFixed(2)}/${ask.toFixed(2)}  │  ${deltaStr}${selected}`, isSelected ? 'result' : 'info');
        });
        addLogLine('─────────────────────────────────', 'info');
      }

      // Print CALL option chain
      if (callCandidates.length > 0) {
        addLogLine(`CALLS (0DTE) - ${callCandidates.length} strikes:`, 'success');
        addLogLine('─────────────────────────────────', 'info');
        callCandidates.slice(0, 5).forEach((c: any) => {
          const isSelected = c.strike === callStrikeVal;
          const arrow = isSelected ? '→ ' : '  ';
          const selected = isSelected ? ' ← SELECTED' : '';
          const bid = c.bid ?? 0;
          const ask = c.ask ?? 0;
          const delta = Math.abs(c.delta ?? 0);
          const deltaStr = `.${(delta * 100).toFixed(0).padStart(2, '0')}`;
          addLogLine(`${arrow}${c.strike}  │  ${bid.toFixed(2)}/${ask.toFixed(2)}  │  ${deltaStr}${selected}`, isSelected ? 'result' : 'info');
        });
        addLogLine('─────────────────────────────────', 'info');
      }

      // Show error if no strikes available
      if (putCandidates.length === 0 && callCandidates.length === 0) {
        addLogLine('No option strikes available from IBKR', 'error');
        addLogLine('Check: 1) IBKR connected 2) Market open 3) Try refresh', 'info');
      }

      setLoggedSteps(prev => new Set([...prev, 'step3']));
    }

    if (completedSteps.has(4) && !loggedSteps.has('step4')) {
      // Use stepResults for immediate streaming
      const step3Data = stepResults?.step3;
      const step4Data = stepResults?.step4;
      const contractCount = step4Data?.contracts ?? analysis?.q4Size?.recommendedContracts ?? contracts;
      const maxLoss = step3Data?.marginRequired ? step3Data.marginRequired * contractCount * 0.1 : (analysis?.tradeProposal?.maxLoss ?? 0);
      const totalCredit = step3Data?.expectedPremium ?? ((analysis?.q3Strikes?.selectedPut?.premium ?? 0) + (analysis?.q3Strikes?.selectedCall?.premium ?? 0));
      setContracts(contractCount);
      addLogLine(`Contracts: ${contractCount} | Credit: $${totalCredit.toFixed(2)} | Max Loss: $${maxLoss.toFixed(0)}`, 'result');
      addLogLine(`[↑↓ put strike] [←→ call strike] [ENTER: APE IN]`, 'info');
      setLoggedSteps(prev => new Set([...prev, 'step4']));
    }

    // When all steps complete
    if (completedSteps.size >= 4 && !isAnalyzing && hudState === 'analyzing') {
      setHudState('ready');
    }
  }, [completedSteps, isAnalyzing, analysis, hudState, addLogLine, contracts, credit, ibkrStatus?.nav, spreadWidth, loggedSteps, wsVix, stepResults]);

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

  // Handle agent commands (typed /commands)
  const handleAgentCommand = useCallback((command: AgentCommand) => {
    if (agentProcessing) return;

    // Handle /help specially - show clickable command menu
    if (command === '/help') {
      setLogLines([]);
      setLoggedSteps(new Set());
      setShowCommandMenu(true);
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

  // Handle put strike adjustment (only when ready)
  const handlePutStrikeAdjust = useCallback((dir: 'up' | 'down') => {
    if (hudState !== 'ready' || putStrike === null) return;
    const newStrike = dir === 'up' ? putStrike + 1 : putStrike - 1;
    setPutStrike(newStrike);
    addLogLine(`Put strike: ${putStrike} → ${newStrike}`, 'info');
  }, [hudState, putStrike, addLogLine]);

  // Handle call strike adjustment (only when ready)
  const handleCallStrikeAdjust = useCallback((dir: 'up' | 'down') => {
    if (hudState !== 'ready' || callStrike === null) return;
    const newStrike = dir === 'up' ? callStrike + 1 : callStrike - 1;
    setCallStrike(newStrike);
    addLogLine(`Call strike: ${callStrike} → ${newStrike}`, 'info');
  }, [hudState, callStrike, addLogLine]);

  // Keyboard controls - enabled when ready
  useKeyboardControls({
    enabled: true,
    onStrategyChange: setStrategy,
    onPutStrikeAdjust: handlePutStrikeAdjust,
    onCallStrikeAdjust: handleCallStrikeAdjust,
    onContractAdjust: (dir) => {
      setContracts((c) => (dir === 'up' ? Math.min(c + 1, 10) : Math.max(c - 1, 1)));
    },
    onModeToggle: handleModeToggle,
    onEnter: hudState === 'ready' ? handleExecute : handleAnalyze,
    onEscape: () => {
      if (showCommandMenu) {
        setShowCommandMenu(false);
      } else {
        handleReset();
      }
    },
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
        spyBid={wsSpyBid}
        spyAsk={wsSpyAsk}
        spyPrevClose={wsSpyPrevClose}
        vixPrice={wsVix}
        vixBid={wsVixBid}
        vixAsk={wsVixAsk}
        vixPrevClose={wsVixPrevClose}
        vixIsClose={wsVixIsClose}
        isConnected={isConnected}
        wsConnected={isWsConnected}
        isDelayed={isDelayed}
        mode={mode}
        autoCountdown={mode === 'AUTO' ? autoCountdown : undefined}
        onModeToggle={handleModeToggle}
      />

      {/* Main area - terminal log only */}
      <MainArea
        lines={logLines}
        isAnalyzing={isAnalyzing}
        progress={progress}
        isReady={hudState === 'ready'}
      />

      {/* Command input - always visible */}
      <CommandInput
        onCommand={handleCommandInput}
        disabled={agentProcessing || isAnalyzing}
        placeholder={agentProcessing ? 'Processing...' : '/help for commands'}
      />

      {/* Selection bar - always visible */}
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
            <div>[1] [2] [3] - Select strategy</div>
            <div>[{'\u2191'}] [{'\u2193'}] - Adjust put strike</div>
            <div>[{'\u2190'}] [{'\u2192'}] - Adjust call strike</div>
            <div>[Tab] - Toggle AUTO/MANUAL</div>
            <div>[Enter] - Analyze / Execute</div>
            <div>[Esc] - Reset / Close menu</div>
            <div>[A] - Analyze now</div>
            <div>[Space] - Pause auto mode</div>
            <div>[?] - Show this help</div>
            <div style={{ color: '#555', marginTop: 12 }}>Type /help in command bar for commands</div>
            <div style={{ marginTop: 16, color: '#555', fontSize: 11 }}>Press any key to close</div>
          </div>
        </div>
      )}

      {/* Command menu overlay */}
      {showCommandMenu && (
        <CommandMenu
          onCommand={(cmd) => handleAgentCommand(cmd as AgentCommand)}
          onClose={() => setShowCommandMenu(false)}
        />
      )}
    </div>
  );
}
