/**
 * PositionSizingPanel - Two-Column Position Sizing Display
 *
 * Left column: INPUTS (market data, account, trade structure)
 * Right column: OUTPUTS (capacity, kelly, recommendation)
 */

interface PositionSizingPanelProps {
  // Market Data
  spyPrice: number;
  vix: number;
  avgDelta: number;

  // Account
  navHKD: number;
  fxRate: number;

  // Trade Structure
  putStrike: number | null;
  callStrike: number | null;
  premiumPerContract: number;
  stopMultiplier: number;

  // Calculated Values (from server)
  capacity: {
    bufferHKD: number;
    marginalRateHKD: number;
    maxContracts: number;
  } | null;

  kelly: {
    winRate: number;
    lossRate: number;
    payoffRatio: number;
    kellyPercent: number;
    creditPerContract: number;
    maxLossAtStop: number;
  } | null;

  // Contract selection
  selectedContracts: number;
  optimalContracts: number;
  maxContracts: number;
  onContractsChange: (n: number) => void;
}

export function PositionSizingPanel({
  spyPrice,
  vix,
  avgDelta,
  navHKD,
  fxRate,
  putStrike,
  callStrike,
  premiumPerContract,
  stopMultiplier,
  capacity,
  kelly,
  selectedContracts,
  optimalContracts,
  maxContracts,
  onContractsChange,
}: PositionSizingPanelProps) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 16,
      fontSize: 12,
      fontFamily: "'IBM Plex Mono', monospace",
    }}>
      {/* LEFT COLUMN: INPUTS */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Market Data Section */}
        <div style={{
          border: '1px solid #333',
          borderRadius: 4,
          padding: 12,
          background: '#111',
        }}>
          <div style={{ color: '#4ade80', marginBottom: 8, fontSize: 11, fontWeight: 600 }}>
            MARKET DATA
          </div>
          <InputRow label="SPY Price" value={`$${spyPrice.toFixed(2)}`} />
          <InputRow label="VIX" value={vix.toFixed(2)} />
          <InputRow label="Delta (avg)" value={avgDelta.toFixed(2)} />
        </div>

        {/* Account Section */}
        <div style={{
          border: '1px solid #333',
          borderRadius: 4,
          padding: 12,
          background: '#111',
        }}>
          <div style={{ color: '#4ade80', marginBottom: 8, fontSize: 11, fontWeight: 600 }}>
            ACCOUNT
          </div>
          <InputRow label="NAV" value={`${navHKD.toLocaleString()} HKD`} />
          <InputRow label="FX Rate" value={fxRate.toFixed(2)} />
        </div>

        {/* Trade Structure Section */}
        <div style={{
          border: '1px solid #333',
          borderRadius: 4,
          padding: 12,
          background: '#111',
        }}>
          <div style={{ color: '#4ade80', marginBottom: 8, fontSize: 11, fontWeight: 600 }}>
            TRADE STRUCTURE
          </div>
          {putStrike && <InputRow label="PUT Strike" value={`$${putStrike}`} />}
          {callStrike && <InputRow label="CALL Strike" value={`$${callStrike}`} />}
          <InputRow label="Premium (ea)" value={`$${premiumPerContract.toFixed(2)}`} />
          <InputRow label="Stop Multiple" value={`${stopMultiplier}x`} />
        </div>
      </div>

      {/* RIGHT COLUMN: OUTPUTS */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Capacity Section */}
        <div style={{
          border: '1px solid #333',
          borderRadius: 4,
          padding: 12,
          background: '#111',
        }}>
          <div style={{ color: '#00ffff', marginBottom: 8, fontSize: 11, fontWeight: 600 }}>
            CAPACITY
          </div>
          {capacity ? (
            <>
              <OutputRow label="Buffer" value={`${capacity.bufferHKD.toLocaleString()} HKD`} />
              <OutputRow label="Marginal Rate" value={`${capacity.marginalRateHKD.toLocaleString()} HKD`} />
              <OutputRow
                label="Max Contracts"
                value={`(${navHKD.toLocaleString()}-${capacity.bufferHKD.toLocaleString()})/${capacity.marginalRateHKD.toLocaleString()}`}
                highlight
              />
              <OutputRow label="" value={`= ${capacity.maxContracts} per side`} highlight />
            </>
          ) : (
            <div style={{ color: '#666' }}>Loading...</div>
          )}
        </div>

        {/* Kelly Section */}
        <div style={{
          border: '1px solid #333',
          borderRadius: 4,
          padding: 12,
          background: '#111',
        }}>
          <div style={{ color: '#00ffff', marginBottom: 8, fontSize: 11, fontWeight: 600 }}>
            KELLY
          </div>
          {kelly ? (
            <>
              <OutputRow label="Win Rate" value={`${(kelly.winRate * 100).toFixed(0)}% (1-Δ)`} />
              <OutputRow label="Loss Rate" value={`${(kelly.lossRate * 100).toFixed(0)}% (Δ)`} />
              <OutputRow label="Credit" value={`$${kelly.creditPerContract.toFixed(2)}`} />
              <OutputRow label={`Max Loss (${stopMultiplier}x)`} value={`$${kelly.maxLossAtStop.toFixed(2)}`} />
              <OutputRow label="Payoff Ratio" value={kelly.payoffRatio.toFixed(2)} />
              <OutputRow label="Kelly %" value={`${(kelly.kellyPercent * 100).toFixed(0)}%`} highlight />
            </>
          ) : (
            <div style={{ color: '#666' }}>Loading...</div>
          )}
        </div>

        {/* Recommendation Section */}
        <div style={{
          border: '1px solid #4ade80',
          borderRadius: 4,
          padding: 12,
          background: 'rgba(74, 222, 128, 0.1)',
        }}>
          <div style={{ color: '#4ade80', marginBottom: 8, fontSize: 11, fontWeight: 600 }}>
            RECOMMENDATION
          </div>
          <div style={{ color: '#888', marginBottom: 8 }}>
            {kelly && capacity ? (
              `${(kelly.kellyPercent * 100).toFixed(0)}% × ${capacity.maxContracts} = ${optimalContracts.toFixed(1)}`
            ) : '...'}
          </div>
          <div style={{
            background: '#1a1a1a',
            border: '1px solid #4ade80',
            borderRadius: 4,
            padding: '8px 12px',
            textAlign: 'center',
            color: '#4ade80',
            fontSize: 14,
            fontWeight: 600,
          }}>
            TRADE {Math.floor(optimalContracts)}-{Math.ceil(optimalContracts)} CONTRACTS
          </div>
        </div>
      </div>
    </div>
  );
}

function InputRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
      <span style={{ color: '#666' }}>{label}</span>
      <span style={{ color: '#888' }}>{value}</span>
    </div>
  );
}

function OutputRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
      <span style={{ color: '#666' }}>{label}</span>
      <span style={{ color: highlight ? '#00ffff' : '#888' }}>{value}</span>
    </div>
  );
}
