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
import { useRailsEnforcement } from '@/hooks/useRailsEnforcement';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  TopBar,
  MainArea,
  SelectionBar,
  ActionBar,
  CommandInput,
  CommandMenu,
  TradeStructure,
  useKeyboardControls,
  type LogLine,
  type Strategy,
} from './engine';

// Selected strike with pricing data for reactive calculations
interface SelectedStrike {
  strike: number;
  bid: number;
  ask: number;
  delta: number;
}

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
  const [putStrike, setPutStrike] = useState<SelectedStrike | null>(null);
  const [callStrike, setCallStrike] = useState<SelectedStrike | null>(null);
  const [spreadWidth, setSpreadWidth] = useState(5);
  const [stopLossPrice, setStopLossPrice] = useState(0);

  // Engine recommended strikes (for comparison in TradeStructure)
  const [enginePutStrike, setEnginePutStrike] = useState<number | null>(null);
  const [engineCallStrike, setEngineCallStrike] = useState<number | null>(null);

  // Log lines for streaming display
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [hudState, setHudState] = useState<'idle' | 'analyzing' | 'strikes_selected' | 'structuring' | 'ready'>('idle');

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

  // Rails enforcement for DeFi rails validation
  const {
    validate: validateRails,
    result: railsResult,
    activeRail,
    isValidating: railsValidating,
    clearResult: clearRailsResult,
  } = useRailsEnforcement();

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

  // Helper to map server errors to user-friendly messages
  const mapErrorToUserMessage = (errData: any): string => {
    const reason = errData.reason || errData.error || 'Unknown error';

    // Check for specific error codes in the reason
    if (reason.includes('STRIKE_NOT_AVAILABLE')) {
      const match = reason.match(/Strike (\d+(?:\.\d+)?) (PUT|CALL)/);
      if (match) {
        return `Strike ${match[1]} ${match[2]} not available for today's expiration`;
      }
      return 'Selected strike not available for today';
    }

    if (reason.includes('EXPIRATION_NOT_FOUND')) {
      return "Today's expiration not available - market may be closed";
    }

    if (reason.includes('UNDERLYING_NOT_FOUND')) {
      return 'Symbol not found in IBKR';
    }

    if (reason.includes('TIMEOUT') || reason.includes('timed out')) {
      return 'IBKR response timeout - please try again';
    }

    if (reason.includes('API_ERROR') || reason.includes('5')) {
      return 'IBKR connection error - please try again';
    }

    if (reason.includes('401') || reason.includes('auth')) {
      return 'IBKR authentication error - check connection status';
    }

    return reason;
  };

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
        const errorMessage = mapErrorToUserMessage(errData);
        throw new Error(errorMessage);
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

  // Reactive credit and maxLoss calculation based on selected strikes
  // Max Loss is calculated from the 6x stop loss rule:
  //   Stop Loss Price = Premium × 6
  //   Max Loss = (Stop Price - Premium) × 100 × Contracts
  const STOP_MULTIPLIER = 6;

  const { credit, maxLoss: reactiveMaxLoss, calculatedStopLoss } = useMemo(() => {
    const putBid = putStrike?.bid ?? 0;
    const callBid = callStrike?.bid ?? 0;
    const premium = putBid + callBid; // Total premium per share
    const creditValue = premium * contracts * 100;

    // Stop loss price = premium × 6 (the Layer 2 stop rule from step5)
    const stopPrice = premium * STOP_MULTIPLIER;

    // Max loss = (stop price - premium) × 100 × contracts
    // This is the loss incurred if we buy back at 6x what we sold for
    const maxLossValue = (stopPrice - premium) * 100 * contracts;

    return { credit: creditValue, maxLoss: maxLossValue, calculatedStopLoss: stopPrice };
  }, [putStrike, callStrike, contracts]);

  // Add log line helper
  const addLogLine = useCallback((text: string, type: LogLine['type'], strikeData?: { strike: number; optionType: 'PUT' | 'CALL' }) => {
    const now = new Date();
    const timestamp = now.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    setLogLines((prev) => [...prev, { timestamp, text, type, strikeData }]);
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
      const putStrikeData = step3Data?.putStrike;
      const callStrikeData = step3Data?.callStrike;

      // Set selected strikes as full objects and store engine recommendations
      if (putStrikeData?.strike) {
        setPutStrike({
          strike: putStrikeData.strike,
          bid: putStrikeData.bid ?? 0,
          ask: putStrikeData.ask ?? 0,
          delta: putStrikeData.delta ?? 0,
        });
        setEnginePutStrike(putStrikeData.strike);
      }
      if (callStrikeData?.strike) {
        setCallStrike({
          strike: callStrikeData.strike,
          bid: callStrikeData.bid ?? 0,
          ask: callStrikeData.ask ?? 0,
          delta: callStrikeData.delta ?? 0,
        });
        setEngineCallStrike(callStrikeData.strike);
      }

      // Always use nearbyStrikes for complete chain (smartCandidates filters too aggressively)
      const putCandidates = step3Data?.nearbyStrikes?.puts || [];
      const callCandidates = step3Data?.nearbyStrikes?.calls || [];
      const expirationDate = stepResults?.step3?.expirationDate || '';
      const expirationLabel = expirationDate ? `0DTE ${expirationDate}` : '0DTE';

      // Add data timestamp with market status
      const now = new Date();
      const etTime = now.toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      // Determine market status based on ET time
      const etHour = parseInt(now.toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', hour12: false }));
      const etMinute = parseInt(now.toLocaleString('en-US', { timeZone: 'America/New_York', minute: '2-digit' }));
      const etTimeMinutes = etHour * 60 + etMinute;
      let marketStatus = 'Pre-market';
      if (etTimeMinutes >= 570 && etTimeMinutes < 960) { // 9:30 AM - 4:00 PM
        marketStatus = 'Market open';
      } else if (etTimeMinutes >= 960 && etTimeMinutes < 1200) { // 4:00 PM - 8:00 PM
        marketStatus = 'After-hours';
      } else if (etTimeMinutes >= 1200 || etTimeMinutes < 240) { // 8:00 PM - 4:00 AM
        marketStatus = 'Overnight';
      }
      addLogLine(`Data as of: ${etTime} ET (${marketStatus})`, 'info');

      // Print PUT option chain - CLICKABLE
      if (putCandidates.length > 0) {
        addLogLine(`PUTS (${expirationLabel}) - ${putCandidates.length} strikes (click to select):`, 'success');
        addLogLine('─────────────────────────────────', 'info');
        putCandidates.slice(0, 10).forEach((p: any) => {
          const isSelected = Number(p.strike) === Number(putStrikeData?.strike);
          const arrow = isSelected ? '→ ' : '  ';
          const selected = isSelected ? ' ← SELECTED' : '';
          const bid = p.bid ?? 0;
          const ask = p.ask ?? 0;
          const delta = Math.abs(p.delta ?? 0);
          const deltaStr = `.${(delta * 100).toFixed(0).padStart(2, '0')}`;
          // Include strikeData so row is clickable
          addLogLine(
            `${arrow}${p.strike}  │  ${bid.toFixed(2)}/${ask.toFixed(2)}  │  ${deltaStr}${selected}`,
            isSelected ? 'result' : 'info',
            { strike: p.strike, optionType: 'PUT' }
          );
        });
        addLogLine('─────────────────────────────────', 'info');
      }

      // Print CALL option chain - CLICKABLE
      if (callCandidates.length > 0) {
        addLogLine(`CALLS (${expirationLabel}) - ${callCandidates.length} strikes (click to select):`, 'success');
        addLogLine('─────────────────────────────────', 'info');
        callCandidates.slice(0, 10).forEach((c: any) => {
          const isSelected = Number(c.strike) === Number(callStrikeData?.strike);
          const arrow = isSelected ? '→ ' : '  ';
          const selected = isSelected ? ' ← SELECTED' : '';
          const bid = c.bid ?? 0;
          const ask = c.ask ?? 0;
          const delta = Math.abs(c.delta ?? 0);
          const deltaStr = `.${(delta * 100).toFixed(0).padStart(2, '0')}`;
          // Include strikeData so row is clickable
          addLogLine(
            `${arrow}${c.strike}  │  ${bid.toFixed(2)}/${ask.toFixed(2)}  │  ${deltaStr}${selected}`,
            isSelected ? 'result' : 'info',
            { strike: c.strike, optionType: 'CALL' }
          );
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
      setContracts(contractCount);

      // Calculate total premium from selected strikes (or step3 data)
      const putPremium = step3Data?.putStrike?.bid ?? 0;
      const callPremium = step3Data?.callStrike?.bid ?? 0;
      const totalPremiumPerShare = putPremium + callPremium;
      const totalCredit = step3Data?.expectedPremium ?? totalPremiumPerShare * 100;

      // Calculate stop loss using 6x multiplier (Layer 2 stop rule)
      const stopLoss = totalPremiumPerShare * STOP_MULTIPLIER;
      setStopLossPrice(stopLoss);

      // Calculate max loss from stop-based formula:
      // Max Loss = (Stop Price - Premium) × 100 × Contracts
      const maxLoss = (stopLoss - totalPremiumPerShare) * 100 * contractCount;

      addLogLine(`Contracts: ${contractCount} | Credit: $${totalCredit.toFixed(2)} | Stop: $${stopLoss.toFixed(2)} | Max Loss: $${maxLoss.toFixed(0)}`, 'result');
      addLogLine(`Click NEXT to review trade structure`, 'info');
      setLoggedSteps(prev => new Set([...prev, 'step4']));
    }

    // When all steps complete - transition to strikes_selected (user must click NEXT)
    if (completedSteps.size >= 4 && !isAnalyzing && hudState === 'analyzing') {
      setHudState('strikes_selected');
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
    setEnginePutStrike(null);
    setEngineCallStrike(null);
    clearRailsResult();
  }, [clearRailsResult]);

  // Handle NEXT button - transition to structuring and validate rails
  const handleNext = useCallback(() => {
    if (hudState !== 'strikes_selected') return;

    setHudState('structuring');

    // Get average delta from selected strikes for rails validation
    const putDelta = putStrike?.delta ?? 0;
    const callDelta = callStrike?.delta ?? 0;
    const avgDelta = (Math.abs(putDelta) + Math.abs(callDelta)) / 2;

    // Validate against DeFi Rails
    const result = validateRails({
      symbol: 'SPY',
      side: 'SELL', // Credit strategies are SELL
      delta: avgDelta,
      contracts,
    });

    // If rails pass, enable APE IN (transition to ready)
    if (result.allowed) {
      setHudState('ready');
    }
    // If rails fail, stay in structuring with blocked APE IN
  }, [hudState, putStrike, callStrike, contracts, validateRails]);

  // Handle BACK button - return to strikes_selected from structuring
  const handleBack = useCallback(() => {
    if (hudState === 'structuring' || hudState === 'ready') {
      setHudState('strikes_selected');
      clearRailsResult();
    }
  }, [hudState, clearRailsResult]);

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

  // Execute - allowed in structuring (if rails pass) or ready state
  const handleExecute = useCallback(() => {
    const canExecuteState = hudState === 'ready' || hudState === 'structuring';
    const railsAllow = !railsResult || railsResult.allowed;
    if (!canExecuteState || !railsAllow || !analysis?.tradeProposal) return;
    executeMutation.mutate(analysis.tradeProposal);
  }, [hudState, railsResult, analysis, executeMutation]);

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

  // Extract position sizing data from step 4
  const positionSizingData = useMemo(() => {
    const step4 = stepResults?.step4 || analysis?.q4Size;
    if (!step4) return null;

    // Check for new two-layer format
    if (step4.capacity && step4.kelly) {
      return {
        capacity: step4.capacity,
        kelly: step4.kelly,
        optimalContracts: step4.optimalContracts ?? step4.contracts ?? contracts,
        maxContracts: step4.maxContracts ?? step4.capacity.maxContracts,
      };
    }

    // Legacy format - no position sizing breakdown
    return null;
  }, [stepResults?.step4, analysis?.q4Size, contracts]);

  // Handle put strike adjustment (only when ready)
  const handlePutStrikeAdjust = useCallback((dir: 'up' | 'down') => {
    if (hudState !== 'ready' || putStrike === null) return;
    const candidates = stepResults?.step3?.nearbyStrikes?.puts || [];
    const currentIdx = candidates.findIndex((c: any) => c.strike === putStrike.strike);
    const newIdx = dir === 'up' ? currentIdx + 1 : currentIdx - 1;
    if (newIdx >= 0 && newIdx < candidates.length) {
      const newData = candidates[newIdx];
      const newStrikeObj = { strike: newData.strike, bid: newData.bid ?? 0, ask: newData.ask ?? 0, delta: newData.delta ?? 0 };
      setPutStrike(newStrikeObj);
      addLogLine(`Put strike: $${putStrike.strike} → $${newStrikeObj.strike}`, 'info');
    }
  }, [hudState, putStrike, addLogLine, stepResults]);

  // Handle call strike adjustment (only when ready)
  const handleCallStrikeAdjust = useCallback((dir: 'up' | 'down') => {
    if (hudState !== 'ready' || callStrike === null) return;
    const candidates = stepResults?.step3?.nearbyStrikes?.calls || [];
    const currentIdx = candidates.findIndex((c: any) => c.strike === callStrike.strike);
    const newIdx = dir === 'up' ? currentIdx + 1 : currentIdx - 1;
    if (newIdx >= 0 && newIdx < candidates.length) {
      const newData = candidates[newIdx];
      const newStrikeObj = { strike: newData.strike, bid: newData.bid ?? 0, ask: newData.ask ?? 0, delta: newData.delta ?? 0 };
      setCallStrike(newStrikeObj);
      addLogLine(`Call strike: $${callStrike.strike} → $${newStrikeObj.strike}`, 'info');
    }
  }, [hudState, callStrike, addLogLine, stepResults]);

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
    onEnter: () => {
      // Enter key behavior depends on state
      if (hudState === 'ready' || (hudState === 'structuring' && (!railsResult || railsResult.allowed))) {
        handleExecute();
      } else if (hudState === 'strikes_selected') {
        handleNext();
      } else {
        handleAnalyze();
      }
    },
    onEscape: () => {
      if (showCommandMenu) {
        setShowCommandMenu(false);
      } else if (hudState === 'structuring' || hudState === 'ready') {
        handleBack();
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

      {/* Main area - log view or trade structure view */}
      {hudState === 'structuring' || hudState === 'ready' ? (
        <TradeStructure
          putStrike={putStrike ? {
            strike: putStrike.strike,
            bid: putStrike.bid,
            ask: putStrike.ask,
            delta: putStrike.delta,
            premium: (putStrike.bid + putStrike.ask) / 2,
          } : null}
          callStrike={callStrike ? {
            strike: callStrike.strike,
            bid: callStrike.bid,
            ask: callStrike.ask,
            delta: callStrike.delta,
            premium: (callStrike.bid + callStrike.ask) / 2,
          } : null}
          enginePutStrike={enginePutStrike}
          engineCallStrike={engineCallStrike}
          contracts={contracts}
          strategy={strategy}
          expectedCredit={credit / 100}
          marginRequired={stepResults?.step3?.marginRequired ?? analysis?.q4Size?.totalMarginRequired ?? 0}
          maxLoss={reactiveMaxLoss}
          stopLossPrice={stopLossPrice}
          railsResult={railsResult}
          activeRail={activeRail}
          isValidating={railsValidating}
          onContractsChange={setContracts}
          onStopLossChange={setStopLossPrice}
          onBack={handleBack}
          positionSizing={positionSizingData}
          spyPrice={spyPrice}
          vix={vix}
          fxRate={7.8}
        />
      ) : (
        <MainArea
          lines={logLines}
          isAnalyzing={isAnalyzing}
          progress={progress}
          isReady={false}
          onPutSelect={(strikeNum) => {
            console.log('[EngineWindow] PUT selected:', strikeNum);
            // Toggle off if clicking the same strike
            if (putStrike?.strike === strikeNum) {
              setPutStrike(null);
              const callBid = callStrike?.bid ?? 0;
              const newCredit = callBid * contracts * 100;
              const label = callStrike ? '(CALL only)' : '(no strikes selected)';
              addLogLine(`PUT strike deselected: $${strikeNum} | Credit: $${newCredit.toFixed(2)} ${label}`, 'info');
              return;
            }
            // Look up full strike data from candidates
            const candidates = stepResults?.step3?.nearbyStrikes?.puts || [];
            const strikeData = candidates.find((c: any) => c.strike === strikeNum);
            if (strikeData) {
              const newStrike = {
                strike: strikeData.strike,
                bid: strikeData.bid ?? 0,
                ask: strikeData.ask ?? 0,
                delta: strikeData.delta ?? 0,
              };
              setPutStrike(newStrike);
              // Calculate new credit with this strike
              const putBid = newStrike.bid;
              const callBid = callStrike?.bid ?? 0;
              const newCredit = (putBid + callBid) * contracts * 100;
              addLogLine(`PUT strike selected: $${strikeNum} | Credit: $${newCredit.toFixed(2)}`, 'success');
            }
          }}
          onCallSelect={(strikeNum) => {
            console.log('[EngineWindow] CALL selected:', strikeNum);
            // Toggle off if clicking the same strike
            if (callStrike?.strike === strikeNum) {
              setCallStrike(null);
              const putBid = putStrike?.bid ?? 0;
              const newCredit = putBid * contracts * 100;
              const label = putStrike ? '(PUT only)' : '(no strikes selected)';
              addLogLine(`CALL strike deselected: $${strikeNum} | Credit: $${newCredit.toFixed(2)} ${label}`, 'info');
              return;
            }
            // Look up full strike data from candidates
            const candidates = stepResults?.step3?.nearbyStrikes?.calls || [];
            const strikeData = candidates.find((c: any) => c.strike === strikeNum);
            if (strikeData) {
              const newStrike = {
                strike: strikeData.strike,
                bid: strikeData.bid ?? 0,
                ask: strikeData.ask ?? 0,
                delta: strikeData.delta ?? 0,
              };
              setCallStrike(newStrike);
              // Calculate new credit with this strike
              const putBid = putStrike?.bid ?? 0;
              const callBid = newStrike.bid;
              const newCredit = (putBid + callBid) * contracts * 100;
              addLogLine(`CALL strike selected: $${strikeNum} | Credit: $${newCredit.toFixed(2)}`, 'success');
            }
          }}
          selectedPutStrike={putStrike?.strike ?? null}
          selectedCallStrike={callStrike?.strike ?? null}
        />
      )}

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
        putStrike={putStrike?.strike ?? null}
        callStrike={callStrike?.strike ?? null}
        putSpread={spreadWidth}
        callSpread={spreadWidth}
      />

      {/* Action bar */}
      <ActionBar
        state={hudState}
        onAnalyze={handleAnalyze}
        onNext={handleNext}
        onBack={handleBack}
        onExecute={handleExecute}
        onReset={handleReset}
        isExecuting={executeMutation.isPending}
        canExecute={!railsResult || railsResult.allowed}
        canNext={putStrike !== null || callStrike !== null}
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
