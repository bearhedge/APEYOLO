/**
 * TradingFlow - 3-Step Trading Process
 *
 * Step 1: Select Strategy (PUT / CALL / STRANGLE)
 * Step 2: Option Chain - Stream and select strikes
 * Step 3: Configure and Execute trade
 */

import { useState, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { OptionChainStep } from './OptionChainStep';

type Strategy = 'put' | 'call' | 'strangle';
type Step = 1 | 2 | 3;

interface TradingFlowProps {
  symbol?: string;
  onClose?: () => void;
}

export function TradingFlow({ symbol = 'SPY', onClose }: TradingFlowProps) {
  const [step, setStep] = useState<Step>(1);
  const [strategy, setStrategy] = useState<Strategy>('strangle');
  const [selectedPutStrike, setSelectedPutStrike] = useState<number | null>(null);
  const [selectedCallStrike, setSelectedCallStrike] = useState<number | null>(null);
  const [contracts, setContracts] = useState(1);

  // Execute trade mutation
  const executeMutation = useMutation({
    mutationFn: async (params: {
      symbol: string;
      strategy: Strategy;
      putStrike: number | null;
      callStrike: number | null;
      contracts: number;
    }) => {
      const res = await fetch('/api/engine/execute-paper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          tradeProposal: {
            symbol: params.symbol,
            strategy: params.strategy,
            legs: [
              ...(params.putStrike ? [{
                optionType: 'PUT',
                action: 'SELL',
                strike: params.putStrike,
              }] : []),
              ...(params.callStrike ? [{
                optionType: 'CALL',
                action: 'SELL',
                strike: params.callStrike,
              }] : []),
            ],
            contracts: params.contracts,
          },
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Execution failed');
      }
      return res.json();
    },
    onSuccess: () => {
      // Reset flow after successful execution
      setStep(1);
      setSelectedPutStrike(null);
      setSelectedCallStrike(null);
      setContracts(1);
    },
  });

  const handleStrategySelect = (s: Strategy) => {
    setStrategy(s);
    setSelectedPutStrike(null);
    setSelectedCallStrike(null);
    setStep(2);
  };

  const handleExecute = () => {
    executeMutation.mutate({
      symbol,
      strategy,
      putStrike: selectedPutStrike,
      callStrike: selectedCallStrike,
      contracts,
    });
  };

  const handleBack = () => {
    if (step === 2) {
      setStep(1);
      setSelectedPutStrike(null);
      setSelectedCallStrike(null);
    } else if (step === 3) {
      setStep(2);
    }
  };

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: '#0a0a0a',
      fontFamily: "'IBM Plex Mono', monospace",
    }}>
      {/* Step indicator */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        gap: 8,
        padding: '12px 16px',
        borderBottom: '1px solid #222',
        background: '#111',
      }}>
        {[1, 2, 3].map(s => (
          <div
            key={s}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <div style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 600,
              background: step >= s ? '#1a3a3a' : '#1a1a1a',
              border: `1px solid ${step >= s ? '#00ffff' : '#333'}`,
              color: step >= s ? '#00ffff' : '#666',
            }}>
              {s}
            </div>
            <span style={{
              fontSize: 11,
              color: step >= s ? '#00ffff' : '#666',
            }}>
              {s === 1 ? 'STRATEGY' : s === 2 ? 'STRIKES' : 'EXECUTE'}
            </span>
            {s < 3 && (
              <span style={{ color: '#333', margin: '0 8px' }}>→</span>
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {/* Step 1: Strategy Selection */}
        {step === 1 && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            gap: 24,
          }}>
            <div style={{ color: '#00ffff', fontSize: 14, fontWeight: 600 }}>
              STEP 1: SELECT STRATEGY
            </div>
            <div style={{ display: 'flex', gap: 16 }}>
              <button
                onClick={() => handleStrategySelect('put')}
                style={{
                  padding: '16px 32px',
                  background: '#1a1a1a',
                  border: '1px solid #ef4444',
                  color: '#ef4444',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = '#2a1a1a';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = '#1a1a1a';
                }}
              >
                PUT
              </button>
              <button
                onClick={() => handleStrategySelect('call')}
                style={{
                  padding: '16px 32px',
                  background: '#1a1a1a',
                  border: '1px solid #4ade80',
                  color: '#4ade80',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = '#1a2a1a';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = '#1a1a1a';
                }}
              >
                CALL
              </button>
              <button
                onClick={() => handleStrategySelect('strangle')}
                style={{
                  padding: '16px 32px',
                  background: '#1a1a1a',
                  border: '1px solid #00ffff',
                  color: '#00ffff',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = '#1a3a3a';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = '#1a1a1a';
                }}
              >
                STRANGLE
              </button>
            </div>
            <div style={{ color: '#666', fontSize: 11, marginTop: 8 }}>
              {symbol} 0DTE Options
            </div>
          </div>
        )}

        {/* Step 2: Option Chain */}
        {step === 2 && (
          <OptionChainStep
            symbol={symbol}
            strategy={strategy}
            onSelectPut={setSelectedPutStrike}
            onSelectCall={setSelectedCallStrike}
            selectedPutStrike={selectedPutStrike}
            selectedCallStrike={selectedCallStrike}
            onBack={handleBack}
            onNext={() => setStep(3)}
          />
        )}

        {/* Step 3: Configure and Execute */}
        {step === 3 && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            padding: 16,
          }}>
            <div style={{
              color: '#00ffff',
              fontSize: 14,
              fontWeight: 600,
              marginBottom: 24,
              paddingBottom: 12,
              borderBottom: '1px solid #333',
            }}>
              STEP 3: CONFIRM & EXECUTE
            </div>

            {/* Trade Summary */}
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}>
              <div style={{
                background: '#111',
                border: '1px solid #333',
                padding: 16,
              }}>
                <div style={{ color: '#888', fontSize: 11, marginBottom: 8 }}>TRADE SUMMARY</div>
                <div style={{ fontSize: 13, color: '#fff', marginBottom: 8 }}>
                  {symbol} {strategy.toUpperCase()}
                </div>
                {selectedPutStrike && (
                  <div style={{ color: '#ef4444', marginBottom: 4 }}>
                    SELL PUT @ {selectedPutStrike}
                  </div>
                )}
                {selectedCallStrike && (
                  <div style={{ color: '#4ade80', marginBottom: 4 }}>
                    SELL CALL @ {selectedCallStrike}
                  </div>
                )}
              </div>

              {/* Contracts */}
              <div style={{
                background: '#111',
                border: '1px solid #333',
                padding: 16,
              }}>
                <div style={{ color: '#888', fontSize: 11, marginBottom: 8 }}>CONTRACTS</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button
                    onClick={() => setContracts(c => Math.max(1, c - 1))}
                    style={{
                      width: 32,
                      height: 32,
                      background: '#1a1a1a',
                      border: '1px solid #444',
                      color: '#fff',
                      fontSize: 16,
                      cursor: 'pointer',
                    }}
                  >
                    -
                  </button>
                  <span style={{ fontSize: 18, fontWeight: 600, color: '#fff', minWidth: 40, textAlign: 'center' }}>
                    {contracts}
                  </span>
                  <button
                    onClick={() => setContracts(c => Math.min(10, c + 1))}
                    style={{
                      width: 32,
                      height: 32,
                      background: '#1a1a1a',
                      border: '1px solid #444',
                      color: '#fff',
                      fontSize: 16,
                      cursor: 'pointer',
                    }}
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Error display */}
              {executeMutation.error && (
                <div style={{
                  background: '#3a1a1a',
                  border: '1px solid #ef4444',
                  padding: 12,
                  color: '#ef4444',
                  fontSize: 12,
                }}>
                  {executeMutation.error.message}
                </div>
              )}

              {/* Success display */}
              {executeMutation.isSuccess && (
                <div style={{
                  background: '#1a3a1a',
                  border: '1px solid #4ade80',
                  padding: 12,
                  color: '#4ade80',
                  fontSize: 12,
                }}>
                  Trade executed successfully!
                </div>
              )}
            </div>

            {/* Footer navigation */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: 16,
              paddingTop: 12,
              borderTop: '1px solid #333',
            }}>
              <button
                onClick={handleBack}
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

              <button
                onClick={handleExecute}
                disabled={executeMutation.isPending}
                style={{
                  padding: '12px 24px',
                  background: executeMutation.isPending ? '#333' : '#1a3a3a',
                  border: '1px solid #00ffff',
                  color: '#00ffff',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: executeMutation.isPending ? 'wait' : 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {executeMutation.isPending ? 'EXECUTING...' : 'EXECUTE TRADE'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
