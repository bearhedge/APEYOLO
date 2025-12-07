/**
 * EngineStepContents - Clean content components for each engine step
 *
 * Professional, concise displays with:
 * - Clear calculation breakdowns
 * - Key metrics highlighted
 * - No verbose explanations
 */

import { StepMetric, StepInfoRow, StepDivider, StepAlert } from './EngineStepCard';

// ============================================================
// Step 1: Market Regime Content
// ============================================================

interface Step1ContentProps {
  vix?: number;
  vixRegime?: 'LOW' | 'NORMAL' | 'ELEVATED' | 'HIGH' | 'EXTREME';
  spyPrice?: number;
  spyChangePct?: number;
  tradingWindow?: {
    isOpen: boolean;
    reason?: string;
    timeRemaining?: string;
  };
}

export function Step1Content({
  vix,
  vixRegime,
  spyPrice,
  spyChangePct,
  tradingWindow,
}: Step1ContentProps) {
  // VIX regime colors
  const regimeColor = {
    LOW: 'green',
    NORMAL: 'green',
    ELEVATED: 'yellow',
    HIGH: 'yellow',
    EXTREME: 'red',
  }[vixRegime || 'NORMAL'] as 'green' | 'yellow' | 'red';

  return (
    <div className="space-y-3">
      {/* Key Metrics */}
      <div className="grid grid-cols-4 gap-4">
        <StepMetric
          label="VIX"
          value={vix?.toFixed(1) || '--'}
          color={regimeColor}
        />
        <StepMetric
          label="Regime"
          value={vixRegime || '--'}
          color={regimeColor}
        />
        <StepMetric
          label="SPY"
          value={spyPrice ? `$${spyPrice.toFixed(2)}` : '--'}
        />
        <StepMetric
          label="Change"
          value={spyChangePct != null ? `${spyChangePct >= 0 ? '+' : ''}${spyChangePct.toFixed(2)}%` : '--'}
          color={spyChangePct != null ? (spyChangePct >= 0 ? 'green' : 'red') : 'default'}
        />
      </div>

      <StepDivider label="VIX Thresholds" />

      {/* VIX Zones Explanation */}
      <div className="space-y-1 text-xs">
        <StepInfoRow label="LOW" value="< 17 (wider deltas OK)" />
        <StepInfoRow label="NORMAL" value="17-20 (standard trading)" highlight={vixRegime === 'NORMAL'} />
        <StepInfoRow label="ELEVATED" value="20-25 (tighten deltas)" highlight={vixRegime === 'ELEVATED'} />
        <StepInfoRow label="HIGH" value="25-35 (reduce size)" highlight={vixRegime === 'HIGH'} />
        <StepInfoRow label="EXTREME" value="> 35 (stay flat)" highlight={vixRegime === 'EXTREME'} />
      </div>

      {/* Trading Window Status */}
      {tradingWindow && (
        <>
          <StepDivider />
          <StepAlert type={tradingWindow.isOpen ? 'success' : 'warning'}>
            {tradingWindow.isOpen
              ? `Trading window open${tradingWindow.timeRemaining ? ` (${tradingWindow.timeRemaining} remaining)` : ''}`
              : tradingWindow.reason || 'Trading window closed'}
          </StepAlert>
        </>
      )}
    </div>
  );
}

// ============================================================
// Step 2: Trend Analysis Content
// ============================================================

interface Step2ContentProps {
  direction?: 'PUT' | 'CALL' | 'STRANGLE';
  trend?: 'UP' | 'DOWN' | 'SIDEWAYS';
  spyPrice?: number;
  maFast?: number;
  maSlow?: number;
  reasoning?: string;
  dataSource?: string;
}

export function Step2Content({
  direction,
  trend,
  spyPrice,
  maFast,
  maSlow,
  reasoning,
  dataSource = 'IBKR 5-min bars',
}: Step2ContentProps) {
  // Determine MA alignment
  const maAlignment = spyPrice && maFast && maSlow
    ? spyPrice > maFast && maFast > maSlow
      ? 'BULLISH'
      : spyPrice < maFast && maFast < maSlow
        ? 'BEARISH'
        : 'MIXED'
    : null;

  return (
    <div className="space-y-3">
      {/* Key Metrics */}
      <div className="grid grid-cols-4 gap-4">
        <StepMetric
          label="SPY"
          value={spyPrice ? `$${spyPrice.toFixed(2)}` : '--'}
        />
        <StepMetric
          label="MA5 (25 min)"
          value={maFast ? `$${maFast.toFixed(2)}` : '--'}
          subtext="Fast average"
        />
        <StepMetric
          label="MA15 (75 min)"
          value={maSlow ? `$${maSlow.toFixed(2)}` : '--'}
          subtext="Slow average"
        />
        <StepMetric
          label="Signal"
          value={maAlignment || '--'}
          color={maAlignment === 'BULLISH' ? 'green' : maAlignment === 'BEARISH' ? 'red' : 'yellow'}
        />
      </div>

      <StepDivider label="Trend Logic" />

      {/* MA Alignment Visualization */}
      <div className="bg-zinc-800/50 rounded-lg p-3 space-y-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-zinc-500">Alignment:</span>
          {spyPrice && maFast && maSlow && (
            <span className={
              maAlignment === 'BULLISH' ? 'text-green-400' :
              maAlignment === 'BEARISH' ? 'text-red-400' :
              'text-yellow-400'
            }>
              SPY {spyPrice > maFast ? '>' : '<'} MA5 {maFast > maSlow ? '>' : '<'} MA15
            </span>
          )}
        </div>
        <div className="text-[10px] text-zinc-600">
          {maAlignment === 'BULLISH' && 'Price above both MAs, short-term above long-term → SELL PUT'}
          {maAlignment === 'BEARISH' && 'Price below both MAs, short-term below long-term → SELL CALL'}
          {maAlignment === 'MIXED' && 'MAs not aligned → SELL STRANGLE (both directions)'}
        </div>
      </div>

      {/* Strategy Result */}
      {direction && (
        <StepAlert type="info">
          Strategy: <span className="font-semibold">SELL {direction}</span>
          {trend && <span className="ml-2 text-zinc-500">({trend} trend)</span>}
        </StepAlert>
      )}

      {/* Data Source */}
      <div className="text-[10px] text-zinc-600 text-right">
        Data: {dataSource}
      </div>
    </div>
  );
}

// ============================================================
// Step 3: Strike Selection Content
// ============================================================

interface Step3ContentProps {
  underlyingPrice?: number;
  targetDelta?: number;
  deltaRange?: { min: number; max: number };
  selectedPut?: { strike: number; delta: number; bid: number };
  selectedCall?: { strike: number; delta: number; bid: number };
  vixRegime?: string;
  expectedPremium?: number;
}

export function Step3Content({
  underlyingPrice,
  targetDelta,
  deltaRange = { min: 0.20, max: 0.30 },
  selectedPut,
  selectedCall,
  vixRegime,
  expectedPremium,
}: Step3ContentProps) {
  return (
    <div className="space-y-3">
      {/* Target Delta Explanation */}
      <div className="bg-zinc-800/50 rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-zinc-500">Target Delta</span>
          <span className="text-sm font-mono text-purple-400">
            {targetDelta?.toFixed(2) || `${deltaRange.min}-${deltaRange.max}`}
          </span>
        </div>
        <div className="text-[10px] text-zinc-600">
          Delta = probability of expiring ITM. Lower delta = safer but less premium.
          {vixRegime && (
            <span className="block mt-1">
              VIX {vixRegime} → {vixRegime === 'LOW' ? 'wider deltas OK' : vixRegime === 'ELEVATED' || vixRegime === 'HIGH' ? 'tighter deltas' : 'standard range'}
            </span>
          )}
        </div>
      </div>

      <StepDivider label="Selected Strikes" />

      {/* Selected Strikes Display */}
      <div className="grid grid-cols-2 gap-3">
        {/* PUT */}
        <div className={`p-3 rounded-lg border ${selectedPut ? 'bg-red-500/10 border-red-500/30' : 'bg-zinc-800/50 border-zinc-700'}`}>
          <div className="text-xs text-zinc-500 mb-1">PUT</div>
          {selectedPut ? (
            <>
              <div className="font-mono text-lg text-red-400">${selectedPut.strike}</div>
              <div className="text-xs text-zinc-500 mt-1">
                <span className="mr-2">δ {selectedPut.delta.toFixed(2)}</span>
                <span>${selectedPut.bid.toFixed(2)}</span>
              </div>
            </>
          ) : (
            <div className="text-zinc-600">--</div>
          )}
        </div>

        {/* CALL */}
        <div className={`p-3 rounded-lg border ${selectedCall ? 'bg-green-500/10 border-green-500/30' : 'bg-zinc-800/50 border-zinc-700'}`}>
          <div className="text-xs text-zinc-500 mb-1">CALL</div>
          {selectedCall ? (
            <>
              <div className="font-mono text-lg text-green-400">${selectedCall.strike}</div>
              <div className="text-xs text-zinc-500 mt-1">
                <span className="mr-2">δ {selectedCall.delta.toFixed(2)}</span>
                <span>${selectedCall.bid.toFixed(2)}</span>
              </div>
            </>
          ) : (
            <div className="text-zinc-600">--</div>
          )}
        </div>
      </div>

      {/* Expected Premium */}
      {expectedPremium != null && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-500">Expected Premium</span>
          <span className="font-mono text-green-400">${expectedPremium.toFixed(2)}/contract</span>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Step 4: Position Size Content (2% Rule)
// ============================================================

interface Step4ContentProps {
  accountValue?: number;
  maxLossPercent?: number;
  maxLossAmount?: number;
  premiumPerContract?: number;
  stopMultiplier?: number;
  maxLossPerContract?: number;
  marginPerContract?: number;
  marginSource?: string;
  buyingPower?: number;
  recommendedContracts?: number;
}

export function Step4Content({
  accountValue,
  maxLossPercent = 2,
  maxLossAmount,
  premiumPerContract,
  stopMultiplier = 3,
  maxLossPerContract,
  marginPerContract,
  marginSource = 'IBKR',
  buyingPower,
  recommendedContracts,
}: Step4ContentProps) {
  // Calculate values if not provided
  const calcMaxLossAmount = maxLossAmount || (accountValue ? accountValue * (maxLossPercent / 100) : undefined);
  const calcMaxLossPerContract = maxLossPerContract || (premiumPerContract ? premiumPerContract * (stopMultiplier - 1) * 100 : undefined);

  return (
    <div className="space-y-3">
      {/* 2% Rule Breakdown */}
      <div className="bg-zinc-800/50 rounded-lg p-3">
        <div className="text-xs text-zinc-500 mb-2">Position Sizing (2% Risk Rule)</div>
        <div className="space-y-1">
          <StepInfoRow
            label="Account Value"
            value={accountValue ? `$${accountValue.toLocaleString()}` : '--'}
          />
          <StepInfoRow
            label={`Max Risk (${maxLossPercent}%)`}
            value={calcMaxLossAmount ? `$${calcMaxLossAmount.toLocaleString()}` : '--'}
            highlight
          />
        </div>
      </div>

      <StepDivider label="Per Contract" />

      {/* Per Contract Calculation */}
      <div className="space-y-1">
        <StepInfoRow
          label="Premium/contract"
          value={premiumPerContract ? `$${premiumPerContract.toFixed(2)} x 100 = $${(premiumPerContract * 100).toFixed(0)}` : '--'}
        />
        <StepInfoRow
          label={`Max Loss/contract (at ${stopMultiplier}x stop)`}
          value={calcMaxLossPerContract ? `$${calcMaxLossPerContract.toFixed(0)}` : '--'}
        />
        <StepInfoRow
          label={`Margin/contract (${marginSource})`}
          value={marginPerContract ? `$${marginPerContract.toLocaleString()}` : '--'}
        />
      </div>

      <StepDivider />

      {/* Result */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30">
          <div className="text-xs text-zinc-500 mb-1">Contracts</div>
          <div className="font-mono text-xl text-blue-400">{recommendedContracts || '--'}</div>
          <div className="text-[10px] text-zinc-600 mt-1">
            {calcMaxLossAmount && calcMaxLossPerContract
              ? `floor($${calcMaxLossAmount.toLocaleString()} / $${calcMaxLossPerContract.toFixed(0)})`
              : 'Based on max loss'
            }
          </div>
        </div>
        <div className="p-3 rounded-lg bg-zinc-800/50 border border-zinc-700">
          <div className="text-xs text-zinc-500 mb-1">Buying Power Used</div>
          <div className="font-mono text-xl text-white">
            {buyingPower && marginPerContract && recommendedContracts
              ? `${((marginPerContract * recommendedContracts / buyingPower) * 100).toFixed(1)}%`
              : '--'
            }
          </div>
          <div className="text-[10px] text-zinc-600 mt-1">
            {marginPerContract && recommendedContracts
              ? `$${(marginPerContract * recommendedContracts).toLocaleString()} margin`
              : ''
            }
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Step 5: Exit Rules Content
// ============================================================

interface Step5ContentProps {
  entryPremium?: number;
  stopMultiplier?: number;
  stopLossPrice?: number;
  maxLossPerContract?: number;
  contracts?: number;
  totalMaxLoss?: number;
}

export function Step5Content({
  entryPremium,
  stopMultiplier = 3,
  stopLossPrice,
  maxLossPerContract,
  contracts,
  totalMaxLoss,
}: Step5ContentProps) {
  // Calculate values if not provided
  const calcStopLossPrice = stopLossPrice || (entryPremium ? entryPremium * stopMultiplier : undefined);
  const calcMaxLossPerContract = maxLossPerContract || (entryPremium ? entryPremium * (stopMultiplier - 1) * 100 : undefined);
  const calcTotalMaxLoss = totalMaxLoss || (calcMaxLossPerContract && contracts ? calcMaxLossPerContract * contracts : undefined);

  return (
    <div className="space-y-3">
      {/* Stop Loss Calculation */}
      <div className="bg-zinc-800/50 rounded-lg p-3">
        <div className="text-xs text-zinc-500 mb-2">Stop Loss Calculation</div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-xs text-zinc-600">Entry</div>
            <div className="font-mono text-sm text-white">${entryPremium?.toFixed(2) || '--'}</div>
          </div>
          <div>
            <div className="text-xs text-zinc-600">x {stopMultiplier}</div>
            <div className="font-mono text-lg text-zinc-500">=</div>
          </div>
          <div>
            <div className="text-xs text-zinc-600">Stop</div>
            <div className="font-mono text-sm text-red-400">${calcStopLossPrice?.toFixed(2) || '--'}</div>
          </div>
        </div>
      </div>

      <StepDivider label="Max Loss" />

      {/* Max Loss Breakdown */}
      <div className="space-y-1">
        <StepInfoRow
          label="Loss per contract"
          value={calcMaxLossPerContract ? `$${calcMaxLossPerContract.toFixed(0)}` : '--'}
        />
        <StepInfoRow
          label="Contracts"
          value={contracts?.toString() || '--'}
        />
        <StepInfoRow
          label="Total Max Loss"
          value={calcTotalMaxLoss ? `$${calcTotalMaxLoss.toLocaleString()}` : '--'}
          highlight
        />
      </div>

      {/* Explanation */}
      <div className="text-[10px] text-zinc-600 bg-zinc-800/30 rounded p-2">
        If option price rises to ${calcStopLossPrice?.toFixed(2) || '--'} ({stopMultiplier}x entry),
        position is closed. Loss = (Stop - Entry) x 100 x contracts
        = (${ entryPremium && calcStopLossPrice ? ((calcStopLossPrice - entryPremium) * 100).toFixed(0) : '--'}) x {contracts || '--'}
        = ${calcTotalMaxLoss?.toLocaleString() || '--'}
      </div>
    </div>
  );
}
