/**
 * TradeStructure - Step 3 Trade Review UI
 *
 * Shows:
 * - Summary of selected strikes + premium calculation
 * - Full trade proposal with risk metrics
 * - Engine recommendation vs user selection comparison
 * - Interactive adjustment controls (contracts, stop loss)
 * - DeFi Rails validation status
 */

import type { EnforcementResult, Rail } from '@shared/types/rails';
import { PositionSizingPanel } from './PositionSizingPanel';

interface StrikeInfo {
  strike: number;
  bid: number;
  ask: number;
  delta: number;
  premium: number;
}

interface TradeStructureProps {
  // Selected strikes
  putStrike: StrikeInfo | null;
  callStrike: StrikeInfo | null;
  // Engine recommendation
  enginePutStrike: number | null;
  engineCallStrike: number | null;
  // Trade params
  contracts: number;
  strategy: 'strangle' | 'put-spread' | 'call-spread';
  // Risk metrics
  expectedCredit: number;
  marginRequired: number;
  maxLoss: number;
  stopLossPrice: number;
  // Rails validation
  railsResult: EnforcementResult | null;
  activeRail: Rail | null;
  isValidating: boolean;
  // Callbacks
  onContractsChange: (n: number) => void;
  onStopLossChange: (price: number) => void;
  onBack: () => void;

  // Position sizing data (new)
  positionSizing?: {
    capacity: {
      navHKD: number;
      bufferHKD: number;
      marginalRateHKD: number;
      maxContracts: number;
    };
    kelly: {
      winRate: number;
      lossRate: number;
      payoffRatio: number;
      kellyPercent: number;
      creditPerContract: number;
      maxLossAtStop: number;
    };
    optimalContracts: number;
    maxContracts: number;
  } | null;

  // Market data for panel
  spyPrice?: number;
  vix?: number;
  fxRate?: number;
}

export function TradeStructure({
  putStrike,
  callStrike,
  enginePutStrike,
  engineCallStrike,
  contracts,
  strategy,
  expectedCredit,
  marginRequired,
  maxLoss,
  stopLossPrice,
  railsResult,
  activeRail,
  isValidating,
  onContractsChange,
  onStopLossChange,
  onBack,
  positionSizing,
  spyPrice,
  vix,
  fxRate,
}: TradeStructureProps) {
  // Format strategy for display
  const strategyLabel = strategy === 'strangle' ? 'STRANGLE' :
    strategy === 'put-spread' ? 'PUT SPREAD' : 'CALL SPREAD';

  // Check if user selection differs from engine recommendation
  const putDiffers = putStrike && enginePutStrike && putStrike.strike !== enginePutStrike;
  const callDiffers = callStrike && engineCallStrike && callStrike.strike !== engineCallStrike;
  const hasOverride = putDiffers || callDiffers;

  // Rails status
  const railsAllowed = !railsResult || railsResult.allowed;
  const railsViolation = railsResult?.violation;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        padding: '16px',
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 13,
        color: '#888',
        overflow: 'auto',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
          paddingBottom: 12,
          borderBottom: '1px solid #333',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: '#00ffff', fontSize: 14, fontWeight: 600 }}>
            TRADE STRUCTURE
          </span>
          <span
            style={{
              padding: '2px 8px',
              background: '#1a1a1a',
              border: '1px solid #444',
              borderRadius: 2,
              fontSize: 11,
              color: '#f59e0b',
            }}
          >
            {strategyLabel}
          </span>
        </div>
        <button
          onClick={onBack}
          style={{
            padding: '4px 12px',
            background: 'transparent',
            border: '1px solid #444',
            borderRadius: 2,
            color: '#888',
            fontSize: 11,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {'\u2190'} BACK
        </button>
      </div>

      {/* Selected Strikes Table */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ color: '#4ade80', marginBottom: 8, fontSize: 12 }}>
          SELECTED STRIKES
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #333' }}>
              <th style={{ textAlign: 'left', padding: '6px 0', color: '#666' }}>TYPE</th>
              <th style={{ textAlign: 'right', padding: '6px 0', color: '#666' }}>STRIKE</th>
              <th style={{ textAlign: 'right', padding: '6px 0', color: '#666' }}>BID/ASK</th>
              <th style={{ textAlign: 'right', padding: '6px 0', color: '#666' }}>DELTA</th>
              <th style={{ textAlign: 'right', padding: '6px 0', color: '#666' }}>PREMIUM</th>
            </tr>
          </thead>
          <tbody>
            {putStrike && (
              <tr style={{ borderBottom: '1px solid #222' }}>
                <td style={{ padding: '8px 0', color: '#ef4444' }}>PUT</td>
                <td style={{ textAlign: 'right', padding: '8px 0' }}>{putStrike.strike}</td>
                <td style={{ textAlign: 'right', padding: '8px 0' }}>
                  {putStrike.bid.toFixed(2)}/{putStrike.ask.toFixed(2)}
                </td>
                <td style={{ textAlign: 'right', padding: '8px 0' }}>
                  .{Math.abs(putStrike.delta * 100).toFixed(0).padStart(2, '0')}
                </td>
                <td style={{ textAlign: 'right', padding: '8px 0', color: '#4ade80' }}>
                  ${(putStrike.premium * 100).toFixed(0)}
                </td>
              </tr>
            )}
            {callStrike && (
              <tr style={{ borderBottom: '1px solid #222' }}>
                <td style={{ padding: '8px 0', color: '#22c55e' }}>CALL</td>
                <td style={{ textAlign: 'right', padding: '8px 0' }}>{callStrike.strike}</td>
                <td style={{ textAlign: 'right', padding: '8px 0' }}>
                  {callStrike.bid.toFixed(2)}/{callStrike.ask.toFixed(2)}
                </td>
                <td style={{ textAlign: 'right', padding: '8px 0' }}>
                  .{Math.abs(callStrike.delta * 100).toFixed(0).padStart(2, '0')}
                </td>
                <td style={{ textAlign: 'right', padding: '8px 0', color: '#4ade80' }}>
                  ${(callStrike.premium * 100).toFixed(0)}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Position Sizing Panel - New Two-Layer Display */}
      {positionSizing && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ color: '#4ade80', marginBottom: 8, fontSize: 12 }}>
            POSITION SIZING
          </div>
          <PositionSizingPanel
            spyPrice={spyPrice ?? 0}
            vix={vix ?? 0}
            avgDelta={
              putStrike && callStrike
                ? (Math.abs(putStrike.delta) + Math.abs(callStrike.delta)) / 2
                : Math.abs(putStrike?.delta ?? callStrike?.delta ?? 0)
            }
            navHKD={positionSizing.capacity.navHKD}
            fxRate={fxRate ?? 7.8}
            putStrike={putStrike?.strike ?? null}
            callStrike={callStrike?.strike ?? null}
            premiumPerContract={
              ((putStrike?.premium ?? 0) + (callStrike?.premium ?? 0)) * 100
            }
            stopMultiplier={stopLossPrice > 0 && expectedCredit > 0
              ? Math.round(stopLossPrice / expectedCredit)
              : 3
            }
            capacity={positionSizing.capacity}
            kelly={positionSizing.kelly}
            selectedContracts={contracts}
            optimalContracts={positionSizing.optimalContracts}
            maxContracts={positionSizing.maxContracts}
            onContractsChange={onContractsChange}
          />
        </div>
      )}

      {/* Risk Metrics Grid */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ color: '#4ade80', marginBottom: 8, fontSize: 12 }}>
          RISK METRICS
        </div>
        {(() => {
          // Calculate derived metrics
          const totalCredit = expectedCredit * 100 * contracts;
          const riskReward = maxLoss > 0 ? totalCredit / maxLoss : 0;

          // Win probability based on average delta (delta ≈ P(ITM))
          // P(profit) ≈ 1 - |avgDelta|
          const putDelta = Math.abs(putStrike?.delta ?? 0);
          const callDelta = Math.abs(callStrike?.delta ?? 0);
          const avgDelta = putStrike && callStrike
            ? (putDelta + callDelta) / 2
            : putDelta || callDelta;
          const winProb = 1 - avgDelta;

          // Expected Value = P(win) × Credit - P(loss) × MaxLoss
          const expectedValue = winProb * totalCredit - avgDelta * maxLoss;

          return (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 12,
              }}
            >
              <MetricCard label="CONTRACTS" value={contracts.toString()} />
              <MetricCard label="CREDIT" value={`$${totalCredit.toFixed(0)}`} highlight />
              <MetricCard label="MARGIN REQ" value={`$${marginRequired.toFixed(0)}`} />
              <MetricCard label="MAX LOSS" value={`$${maxLoss.toFixed(0)}`} warning />
              <MetricCard label="STOP LOSS" value={`$${stopLossPrice.toFixed(2)}`} />
              <MetricCard label="RISK/REWARD" value={riskReward > 0 ? `1:${(1/riskReward).toFixed(1)}` : 'N/A'} />
              <MetricCard label="WIN PROB" value={`${(winProb * 100).toFixed(0)}%`} highlight={winProb >= 0.65} />
              <MetricCard
                label="EXP VALUE"
                value={`${expectedValue >= 0 ? '+' : ''}$${expectedValue.toFixed(0)}`}
                highlight={expectedValue > 0}
                warning={expectedValue < 0}
              />
            </div>
          );
        })()}
      </div>

      {/* Comparison Panel - Engine vs User */}
      {hasOverride && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ color: '#f59e0b', marginBottom: 8, fontSize: 12 }}>
            OVERRIDE DETECTED
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 16,
              padding: 12,
              background: 'rgba(245, 158, 11, 0.1)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              borderRadius: 4,
            }}
          >
            <div>
              <div style={{ color: '#666', fontSize: 11, marginBottom: 4 }}>ENGINE REC</div>
              {enginePutStrike && <div>PUT: {enginePutStrike}</div>}
              {engineCallStrike && <div>CALL: {engineCallStrike}</div>}
            </div>
            <div>
              <div style={{ color: '#666', fontSize: 11, marginBottom: 4 }}>YOUR SELECTION</div>
              {putStrike && (
                <div style={{ color: putDiffers ? '#f59e0b' : 'inherit' }}>
                  PUT: {putStrike.strike} {putDiffers && '\u2190'}
                </div>
              )}
              {callStrike && (
                <div style={{ color: callDiffers ? '#f59e0b' : 'inherit' }}>
                  CALL: {callStrike.strike} {callDiffers && '\u2190'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Adjustment Controls */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ color: '#4ade80', marginBottom: 8, fontSize: 12 }}>
          ADJUSTMENTS
        </div>
        <div
          style={{
            display: 'flex',
            gap: 24,
            padding: 12,
            background: '#111',
            border: '1px solid #333',
            borderRadius: 4,
          }}
        >
          {/* Contracts slider */}
          <div style={{ flex: 1 }}>
            <div style={{ color: '#666', fontSize: 11, marginBottom: 8 }}>CONTRACTS</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                onClick={() => onContractsChange(Math.max(1, contracts - 1))}
                style={{
                  width: 28,
                  height: 28,
                  background: '#1a1a1a',
                  border: '1px solid #444',
                  borderRadius: 2,
                  color: '#888',
                  cursor: 'pointer',
                  fontSize: 16,
                }}
              >
                -
              </button>
              <span style={{ minWidth: 30, textAlign: 'center', fontSize: 16, color: '#00ffff' }}>
                {contracts}
              </span>
              <button
                onClick={() => onContractsChange(Math.min(10, contracts + 1))}
                style={{
                  width: 28,
                  height: 28,
                  background: '#1a1a1a',
                  border: '1px solid #444',
                  borderRadius: 2,
                  color: '#888',
                  cursor: 'pointer',
                  fontSize: 16,
                }}
              >
                +
              </button>
            </div>
          </div>

          {/* Stop loss input */}
          <div style={{ flex: 1 }}>
            <div style={{ color: '#666', fontSize: 11, marginBottom: 8 }}>STOP LOSS ($)</div>
            <input
              type="number"
              value={stopLossPrice}
              onChange={(e) => onStopLossChange(parseFloat(e.target.value) || 0)}
              step="0.01"
              style={{
                width: '100%',
                padding: '6px 10px',
                background: '#1a1a1a',
                border: '1px solid #444',
                borderRadius: 2,
                color: '#00ffff',
                fontFamily: 'inherit',
                fontSize: 14,
              }}
            />
          </div>
        </div>
      </div>

      {/* Rails Status */}
      <div style={{ marginTop: 'auto' }}>
        <div
          style={{
            padding: 12,
            background: railsAllowed ? 'rgba(74, 222, 128, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            border: `1px solid ${railsAllowed ? 'rgba(74, 222, 128, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
            borderRadius: 4,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: activeRail ? 8 : 0,
            }}
          >
            {isValidating ? (
              <>
                <span style={{ color: '#888' }}>...</span>
                <span style={{ color: '#888' }}>VALIDATING RAILS</span>
              </>
            ) : railsAllowed ? (
              <>
                <span style={{ color: '#4ade80' }}>{'\u2713'}</span>
                <span style={{ color: '#4ade80' }}>
                  {activeRail ? 'RAILS CHECK PASSED' : 'NO ACTIVE RAILS'}
                </span>
              </>
            ) : (
              <>
                <span style={{ color: '#ef4444' }}>{'\u2717'}</span>
                <span style={{ color: '#ef4444' }}>RAILS VIOLATION</span>
              </>
            )}
          </div>

          {/* Show violation details */}
          {railsViolation && (
            <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>
              {railsResult?.reason}
              <div style={{ color: '#888', marginTop: 4, fontSize: 11 }}>
                Attempted: {railsViolation.attempted} | Limit: {railsViolation.limit}
              </div>
            </div>
          )}

          {/* Show active rail summary */}
          {activeRail && railsAllowed && (
            <div style={{ color: '#666', fontSize: 11 }}>
              Symbols: {activeRail.allowedSymbols.join(', ')} |
              Delta: {activeRail.minDelta}-{activeRail.maxDelta} |
              {activeRail.strategyType} only
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Helper component for metric cards
function MetricCard({
  label,
  value,
  highlight,
  warning,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  warning?: boolean;
}) {
  return (
    <div
      style={{
        padding: '10px 12px',
        background: '#111',
        border: '1px solid #333',
        borderRadius: 4,
      }}
    >
      <div style={{ color: '#666', fontSize: 10, marginBottom: 4 }}>{label}</div>
      <div
        style={{
          fontSize: 16,
          color: warning ? '#ef4444' : highlight ? '#4ade80' : '#00ffff',
        }}
      >
        {value}
      </div>
    </div>
  );
}
