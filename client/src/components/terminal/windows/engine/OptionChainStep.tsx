/**
 * OptionChainStep - Step 2: Live Option Chain Display
 *
 * Wires up option chain streaming from IBKR WebSocket.
 * Shows live bid/ask for puts and calls with streaming updates.
 */

import { useState, useEffect, useCallback } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useOptionChainStream, type StreamedStrike } from '@/hooks/useOptionChainStream';

interface OptionChainStepProps {
  symbol: string;
  strategy: 'put' | 'call' | 'strangle';
  onSelectPut: (strike: number) => void;
  onSelectCall: (strike: number) => void;
  selectedPutStrike: number | null;
  selectedCallStrike: number | null;
  onBack: () => void;
  onNext: () => void;
}

interface ChainData {
  underlyingPrice: number;
  puts: Array<{
    strike: number;
    bid: number;
    ask: number;
    delta?: number;
    iv?: number;
  }>;
  calls: Array<{
    strike: number;
    bid: number;
    ask: number;
    delta?: number;
    iv?: number;
  }>;
}

export function OptionChainStep({
  symbol,
  strategy,
  onSelectPut,
  onSelectCall,
  selectedPutStrike,
  selectedCallStrike,
  onBack,
  onNext,
}: OptionChainStepProps) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [chainData, setChainData] = useState<ChainData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // Get streaming status
  const { data: streamStatus, refetch: refetchStatus } = useQuery({
    queryKey: ['/api/broker/stream/status'],
    queryFn: async () => {
      const res = await fetch('/api/broker/stream/status', { credentials: 'include' });
      if (!res.ok) return { isStreaming: false, wsConnected: false };
      return res.json();
    },
    refetchInterval: 5000,
  });

  // Start streaming mutation
  const startStreamMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/broker/stream/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ symbol }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to start streaming');
      }
      return res.json();
    },
    onSuccess: () => {
      setIsStreaming(true);
      setError(null);
      refetchStatus();
      // Fetch initial chain data
      fetchChainData();
    },
    onError: (err: Error) => {
      setError(err.message);
      setIsStreaming(false);
    },
  });

  // Fetch cached chain data
  const fetchChainData = useCallback(async () => {
    try {
      const res = await fetch(`/api/broker/stream/chain/${symbol}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        console.log('[OptionChainStep] Chain not cached yet');
        return;
      }
      const data = await res.json();
      if (data.cached && data.chain) {
        setChainData({
          underlyingPrice: data.chain.underlyingPrice,
          puts: data.chain.puts || [],
          calls: data.chain.calls || [],
        });
        setLastUpdate(new Date());
      }
    } catch (err) {
      console.error('[OptionChainStep] Failed to fetch chain:', err);
    }
  }, [symbol]);

  // Get strikes to monitor for streaming
  const putStrikes = chainData?.puts.map(p => p.strike) || [];
  const callStrikes = chainData?.calls.map(c => c.strike) || [];

  // Use option chain stream hook for live updates
  const {
    streamedPuts,
    streamedCalls,
    isStreaming: wsStreaming,
    lastUpdateTimestamp,
  } = useOptionChainStream({
    symbol,
    putStrikes,
    callStrikes,
    enabled: isStreaming && putStrikes.length > 0,
  });

  // Update chain data with streamed values
  useEffect(() => {
    if (!chainData) return;

    let hasUpdates = false;
    const updatedPuts = chainData.puts.map(put => {
      const streamed = streamedPuts.get(put.strike);
      if (streamed) {
        hasUpdates = true;
        return {
          ...put,
          bid: streamed.bid,
          ask: streamed.ask,
          delta: streamed.delta,
          iv: streamed.iv,
        };
      }
      return put;
    });

    const updatedCalls = chainData.calls.map(call => {
      const streamed = streamedCalls.get(call.strike);
      if (streamed) {
        hasUpdates = true;
        return {
          ...call,
          bid: streamed.bid,
          ask: streamed.ask,
          delta: streamed.delta,
          iv: streamed.iv,
        };
      }
      return call;
    });

    if (hasUpdates) {
      setChainData(prev => prev ? {
        ...prev,
        puts: updatedPuts,
        calls: updatedCalls,
      } : null);
      setLastUpdate(new Date());
    }
  }, [streamedPuts, streamedCalls]);

  // Auto-start streaming on mount if not already streaming
  useEffect(() => {
    if (streamStatus?.isStreaming && streamStatus?.symbols?.includes(symbol)) {
      setIsStreaming(true);
      fetchChainData();
    }
  }, [streamStatus, symbol, fetchChainData]);

  // Poll for chain data updates
  useEffect(() => {
    if (!isStreaming) return;

    const interval = setInterval(fetchChainData, 2000);
    return () => clearInterval(interval);
  }, [isStreaming, fetchChainData]);

  const handleStartStreaming = () => {
    startStreamMutation.mutate();
  };

  const canProceed = () => {
    if (strategy === 'put') return selectedPutStrike !== null;
    if (strategy === 'call') return selectedCallStrike !== null;
    return selectedPutStrike !== null && selectedCallStrike !== null;
  };

  const showPuts = strategy === 'put' || strategy === 'strangle';
  const showCalls = strategy === 'call' || strategy === 'strangle';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 16 }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
        paddingBottom: 12,
        borderBottom: '1px solid #333',
      }}>
        <div>
          <span style={{ color: '#00ffff', fontSize: 14, fontWeight: 600 }}>
            STEP 2: SELECT STRIKES
          </span>
          <span style={{ color: '#666', marginLeft: 12, fontSize: 12 }}>
            {symbol} {strategy.toUpperCase()}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {lastUpdate && (
            <span style={{ color: '#4ade80', fontSize: 11 }}>
              LIVE • {lastUpdate.toLocaleTimeString()}
            </span>
          )}
          {chainData && (
            <span style={{ color: '#888', fontSize: 11 }}>
              ${chainData.underlyingPrice.toFixed(2)}
            </span>
          )}
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div style={{
          background: '#3a1a1a',
          border: '1px solid #ef4444',
          padding: 12,
          marginBottom: 16,
          color: '#ef4444',
          fontSize: 12,
        }}>
          {error}
        </div>
      )}

      {/* Start streaming button (if not streaming) */}
      {!isStreaming && (
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
        }}>
          <div style={{ color: '#888', fontSize: 13, textAlign: 'center' }}>
            Option chain streaming is not active.<br />
            Start streaming to see live bid/ask prices.
          </div>
          <button
            onClick={handleStartStreaming}
            disabled={startStreamMutation.isPending}
            style={{
              padding: '12px 24px',
              background: startStreamMutation.isPending ? '#333' : '#1a3a3a',
              border: '1px solid #00ffff',
              color: '#00ffff',
              fontSize: 13,
              cursor: startStreamMutation.isPending ? 'wait' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {startStreamMutation.isPending ? 'STARTING...' : 'START STREAMING'}
          </button>
          {streamStatus && (
            <div style={{ color: '#666', fontSize: 11 }}>
              WS: {streamStatus.wsConnected ? 'Connected' : 'Disconnected'} |
              Symbols: {streamStatus.symbols?.join(', ') || 'none'}
            </div>
          )}
        </div>
      )}

      {/* Option chain tables */}
      {isStreaming && chainData && (
        <div style={{ flex: 1, display: 'flex', gap: 16, overflow: 'hidden' }}>
          {/* PUTS */}
          {showPuts && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{
                color: '#ef4444',
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 8,
                padding: '4px 8px',
                background: '#1a1a1a',
              }}>
                PUTS
              </div>
              <div style={{ flex: 1, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr style={{ color: '#666', borderBottom: '1px solid #333' }}>
                      <th style={{ padding: '6px 4px', textAlign: 'left' }}>Strike</th>
                      <th style={{ padding: '6px 4px', textAlign: 'right' }}>Bid</th>
                      <th style={{ padding: '6px 4px', textAlign: 'right' }}>Ask</th>
                      <th style={{ padding: '6px 4px', textAlign: 'right' }}>Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chainData.puts.map(put => {
                      const isSelected = put.strike === selectedPutStrike;
                      const mid = (put.bid + put.ask) / 2;
                      return (
                        <tr
                          key={put.strike}
                          onClick={() => onSelectPut(put.strike)}
                          style={{
                            cursor: 'pointer',
                            background: isSelected ? '#1a3a3a' : 'transparent',
                            borderBottom: '1px solid #222',
                          }}
                        >
                          <td style={{
                            padding: '6px 4px',
                            color: isSelected ? '#00ffff' : '#fff',
                            fontWeight: isSelected ? 600 : 400,
                          }}>
                            {put.strike}
                          </td>
                          <td style={{ padding: '6px 4px', textAlign: 'right', color: '#4ade80' }}>
                            {put.bid > 0 ? put.bid.toFixed(2) : '--'}
                          </td>
                          <td style={{ padding: '6px 4px', textAlign: 'right', color: '#ef4444' }}>
                            {put.ask > 0 ? put.ask.toFixed(2) : '--'}
                          </td>
                          <td style={{ padding: '6px 4px', textAlign: 'right', color: '#888' }}>
                            {put.delta ? (put.delta * 100).toFixed(0) : '--'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* CALLS */}
          {showCalls && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{
                color: '#4ade80',
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 8,
                padding: '4px 8px',
                background: '#1a1a1a',
              }}>
                CALLS
              </div>
              <div style={{ flex: 1, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr style={{ color: '#666', borderBottom: '1px solid #333' }}>
                      <th style={{ padding: '6px 4px', textAlign: 'left' }}>Strike</th>
                      <th style={{ padding: '6px 4px', textAlign: 'right' }}>Bid</th>
                      <th style={{ padding: '6px 4px', textAlign: 'right' }}>Ask</th>
                      <th style={{ padding: '6px 4px', textAlign: 'right' }}>Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chainData.calls.map(call => {
                      const isSelected = call.strike === selectedCallStrike;
                      return (
                        <tr
                          key={call.strike}
                          onClick={() => onSelectCall(call.strike)}
                          style={{
                            cursor: 'pointer',
                            background: isSelected ? '#1a3a3a' : 'transparent',
                            borderBottom: '1px solid #222',
                          }}
                        >
                          <td style={{
                            padding: '6px 4px',
                            color: isSelected ? '#00ffff' : '#fff',
                            fontWeight: isSelected ? 600 : 400,
                          }}>
                            {call.strike}
                          </td>
                          <td style={{ padding: '6px 4px', textAlign: 'right', color: '#4ade80' }}>
                            {call.bid > 0 ? call.bid.toFixed(2) : '--'}
                          </td>
                          <td style={{ padding: '6px 4px', textAlign: 'right', color: '#ef4444' }}>
                            {call.ask > 0 ? call.ask.toFixed(2) : '--'}
                          </td>
                          <td style={{ padding: '6px 4px', textAlign: 'right', color: '#888' }}>
                            {call.delta ? (call.delta * 100).toFixed(0) : '--'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Loading state */}
      {isStreaming && !chainData && (
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#888',
        }}>
          Loading option chain...
        </div>
      )}

      {/* Footer with selection summary and navigation */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 16,
        paddingTop: 12,
        borderTop: '1px solid #333',
      }}>
        <button
          onClick={onBack}
          style={{
            padding: '8px 16px',
            background: 'transparent',
            border: '1px solid #444',
            color: '#888',
            fontSize: 12,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          ← BACK
        </button>

        <div style={{ color: '#888', fontSize: 12 }}>
          {selectedPutStrike && <span style={{ color: '#ef4444' }}>PUT: {selectedPutStrike}</span>}
          {selectedPutStrike && selectedCallStrike && <span style={{ margin: '0 8px' }}>|</span>}
          {selectedCallStrike && <span style={{ color: '#4ade80' }}>CALL: {selectedCallStrike}</span>}
        </div>

        <button
          onClick={onNext}
          disabled={!canProceed()}
          style={{
            padding: '8px 16px',
            background: canProceed() ? '#1a3a3a' : '#1a1a1a',
            border: `1px solid ${canProceed() ? '#00ffff' : '#333'}`,
            color: canProceed() ? '#00ffff' : '#666',
            fontSize: 12,
            cursor: canProceed() ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit',
          }}
        >
          NEXT →
        </button>
      </div>
    </div>
  );
}
