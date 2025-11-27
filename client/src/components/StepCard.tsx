import { useState } from 'react';
import { ChevronDown, ChevronRight, CheckCircle, XCircle, Clock, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { VIXChart, SymbolChart } from './charts';

export type StepStatus = 'pending' | 'passed' | 'failed';
export type RiskTier = 'conservative' | 'balanced' | 'aggressive';
export type StopMultiplier = 2 | 3 | 4;

export interface StepCardProps {
  stepNumber: number;
  title: string;
  status: StepStatus;
  summary: string;
  children?: React.ReactNode;
  defaultExpanded?: boolean;
}

export function StepCard({ stepNumber, title, status, summary, children, defaultExpanded = false }: StepCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const statusIcon = {
    passed: <CheckCircle className="w-5 h-5 text-green-500" />,
    failed: <XCircle className="w-5 h-5 text-red-500" />,
    pending: <Clock className="w-5 h-5 text-silver" />,
  };

  const statusBadge = {
    passed: 'bg-green-500/10 text-green-500 border-green-500/20',
    failed: 'bg-red-500/10 text-red-500 border-red-500/20',
    pending: 'bg-white/5 text-silver border-white/10',
  };

  return (
    <div className="border border-white/10 rounded-lg overflow-hidden">
      {/* Collapsed Header - Always Visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-4">
          <span className="text-silver text-sm font-mono w-6">
            {String(stepNumber).padStart(2, '0')}
          </span>
          <span className="font-medium">{title}</span>
          <span className={`text-xs px-2 py-1 rounded-md border ${statusBadge[status]}`}>
            {summary}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {statusIcon[status]}
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-silver" />
          ) : (
            <ChevronRight className="w-4 h-4 text-silver" />
          )}
        </div>
      </button>

      {/* Expanded Content */}
      {isExpanded && children && (
        <div className="px-4 pb-4 pt-0 border-t border-white/5">
          <div className="pt-4">
            {children}
          </div>
        </div>
      )}
    </div>
  );
}

// Step 1: Market Regime Content - Enhanced with VIX Chart
interface MarketRegimeContentProps {
  vix?: number;
  vixThreshold?: number;
  spyPrice?: number;
  spyChange?: number;
  trend?: string;
  showChart?: boolean;
}

export function MarketRegimeContent({
  vix,
  vixThreshold = 20,
  spyPrice,
  spyChange,
  showChart = true
}: MarketRegimeContentProps) {
  // VIX zones: Safe (<20), Caution (20-25), High Risk (>25)
  const vixZone = vix ? (vix < vixThreshold ? 'safe' : vix < 25 ? 'caution' : 'high') : null;
  const vixStatus = vixZone === 'safe' ? 'SAFE TO TRADE' : vixZone === 'caution' ? 'ELEVATED RISK' : vixZone === 'high' ? 'HIGH VOLATILITY' : '—';

  const zoneColors = {
    safe: { text: 'text-green-400', bg: 'bg-green-500/20', border: 'border-green-500/30', dot: 'bg-green-500' },
    caution: { text: 'text-yellow-400', bg: 'bg-yellow-500/20', border: 'border-yellow-500/30', dot: 'bg-yellow-500' },
    high: { text: 'text-red-400', bg: 'bg-red-500/20', border: 'border-red-500/30', dot: 'bg-red-500' },
  };

  const colors = vixZone ? zoneColors[vixZone] : { text: 'text-neutral-400', bg: 'bg-neutral-800', border: 'border-neutral-700', dot: 'bg-neutral-500' };

  // Calculate VIX position on scale (0-40 range for visualization)
  const vixPosition = vix ? Math.min(100, (vix / 40) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* VIX Chart with integrated header, OHLC, and timeframe selector */}
      {showChart && (
        <VIXChart
          height={180}
          defaultTimeframe="5D"
          chartType="candlestick"
          showTimeframeSelector={true}
          showOHLC={true}
        />
      )}

      {/* VIX Level Indicator Bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-neutral-400">
          <span>VIX Level</span>
          <span>Threshold: {vixThreshold}</span>
        </div>
        <div className="relative h-2 rounded-full bg-gradient-to-r from-green-500/30 via-yellow-500/30 to-red-500/30 overflow-hidden">
          {/* Zone markers */}
          <div className="absolute left-[50%] top-0 bottom-0 w-px bg-neutral-600" style={{ left: `${(vixThreshold / 40) * 100}%` }} />
          <div className="absolute left-[62.5%] top-0 bottom-0 w-px bg-neutral-600" style={{ left: `${(25 / 40) * 100}%` }} />
          {/* VIX Position marker */}
          {vix && (
            <div
              className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full ${colors.dot} shadow-lg transition-all duration-500`}
              style={{ left: `calc(${vixPosition}% - 6px)` }}
            />
          )}
        </div>
        <div className="flex justify-between text-[10px] text-neutral-500">
          <span>0</span>
          <span>10</span>
          <span className="text-yellow-500/70">20</span>
          <span className="text-red-500/70">30</span>
          <span>40+</span>
        </div>
      </div>

      {/* Trading Status Card */}
      <div className={`p-4 rounded-lg ${colors.bg} border ${colors.border}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${colors.dot} animate-pulse`} />
            <div>
              <p className={`font-semibold ${colors.text}`}>{vixStatus}</p>
              <p className="text-xs text-neutral-400">
                {vixZone === 'safe' && 'Market conditions favorable for premium selling'}
                {vixZone === 'caution' && 'Reduce position size, tighten stops'}
                {vixZone === 'high' && 'Consider staying flat or reducing exposure'}
                {!vixZone && 'Awaiting market data'}
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm text-neutral-400">SPY</p>
            <p className="font-mono font-medium">
              ${spyPrice?.toFixed(2) || '--'}
              <span className={`ml-2 text-sm ${(spyChange || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {spyChange ? `${spyChange >= 0 ? '+' : ''}${spyChange.toFixed(2)}%` : ''}
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Step 2: Direction Content
interface DirectionContentProps {
  direction?: 'PUT' | 'CALL' | 'STRANGLE';
  confidence?: number;
  spyPrice?: number;
  maFast?: number;      // 5-period MA
  maSlow?: number;      // 15-period MA
  trend?: 'UP' | 'DOWN' | 'SIDEWAYS';
  reasoning?: string;
  symbol?: string;
  showChart?: boolean;
}

export function DirectionContent({ direction, confidence, spyPrice, maFast, maSlow, trend, reasoning, symbol = 'SPY', showChart = true }: DirectionContentProps) {
  // Calculate position vs slow MA (main reference)
  const percentFromMA = spyPrice && maSlow ? ((spyPrice - maSlow) / maSlow) * 100 : null;

  const DirectionIcon = direction === 'PUT' ? TrendingDown : direction === 'CALL' ? TrendingUp : Minus;
  const directionColor = direction === 'PUT' ? 'text-red-500' : direction === 'CALL' ? 'text-green-500' : 'text-yellow-500';

  // Trend badge styling
  const trendBadge = trend === 'UP' ? 'bg-green-500/20 text-green-400' :
                     trend === 'DOWN' ? 'bg-red-500/20 text-red-400' :
                     'bg-yellow-500/20 text-yellow-400';

  return (
    <div className="space-y-4">
      {/* SPY Chart with candlesticks */}
      {showChart && (
        <SymbolChart
          symbol={symbol}
          height={300}
          defaultTimeframe="5D"
          chartType="candlestick"
          showTimeframeSelector={true}
          showOHLC={true}
          showHeader={true}
        />
      )}

      {/* Direction recommendation */}
      {direction && (
        <div className={`flex items-center gap-3 p-3 rounded-lg bg-white/5 ${directionColor}`}>
          <DirectionIcon className="w-5 h-5" />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <p className="font-medium">Recommendation: SELL {direction}</p>
              {trend && (
                <span className={`text-xs px-2 py-0.5 rounded ${trendBadge}`}>
                  {trend === 'UP' ? 'BULLISH' : trend === 'DOWN' ? 'BEARISH' : 'NEUTRAL'}
                </span>
              )}
            </div>
            <p className="text-sm opacity-80">{reasoning || 'Based on MA crossover'}</p>
          </div>
        </div>
      )}

      {/* Price & MA info - show both MAs */}
      <div className="grid grid-cols-4 gap-4 text-sm">
        <div>
          <p className="text-silver mb-1">SPY Price</p>
          <p className="font-mono">${spyPrice?.toFixed(2) || '--'}</p>
        </div>
        <div>
          <p className="text-silver mb-1">MA5 (Fast)</p>
          <p className="font-mono">${maFast?.toFixed(2) || '--'}</p>
        </div>
        <div>
          <p className="text-silver mb-1">MA15 (Slow)</p>
          <p className="font-mono">${maSlow?.toFixed(2) || '--'}</p>
        </div>
        <div>
          <p className="text-silver mb-1">Confidence</p>
          <p className="font-mono">{confidence ? `${(confidence * 100).toFixed(0)}%` : '--'}</p>
        </div>
      </div>

      {/* MA Crossover Visualization */}
      {spyPrice && maFast && maSlow && (
        <div className="p-3 rounded-lg bg-white/5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-silver">MA Alignment:</span>
            <span className={spyPrice > maFast && maFast > maSlow ? 'text-green-400' :
                           spyPrice < maFast && maFast < maSlow ? 'text-red-400' :
                           'text-yellow-400'}>
              SPY {spyPrice > maFast ? '>' : '<'} MA5 {maFast > maSlow ? '>' : '<'} MA15
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// Step 3: Strike Selection Content
interface StrikeOption {
  strike: number;
  bid: number;
  ask: number;
  delta: number;
  oi?: number;
}

interface StrikeSelectionContentProps {
  underlyingPrice?: number;
  selectedPutStrike?: number;
  selectedCallStrike?: number;
  putStrikes?: StrikeOption[];
  callStrikes?: StrikeOption[];
  expectedPremium?: number;
  deltaRange?: { min: number; max: number };
}

export function StrikeSelectionContent({
  underlyingPrice,
  selectedPutStrike,
  selectedCallStrike,
  putStrikes = [],
  callStrikes = [],
  expectedPremium,
  deltaRange = { min: 0.20, max: 0.30 }
}: StrikeSelectionContentProps) {
  return (
    <div className="space-y-4">
      <div className="text-sm text-silver mb-2">
        SPY @ ${underlyingPrice?.toFixed(2) || '--'} | Delta Target: {deltaRange.min}-{deltaRange.max}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* PUT Strikes */}
        <div>
          <p className="text-xs text-silver mb-2 uppercase">Put Strikes</p>
          <div className="space-y-1">
            {putStrikes.length > 0 ? putStrikes.slice(0, 5).map((strike) => (
              <div
                key={strike.strike}
                className={`flex items-center justify-between text-sm p-2 rounded ${
                  strike.strike === selectedPutStrike ? 'bg-red-500/20 border border-red-500/50' : 'bg-white/5'
                }`}
              >
                <span className="font-mono">{strike.strike}</span>
                <span className="text-silver">${strike.bid.toFixed(2)}</span>
                <span className="text-silver">δ{Math.abs(strike.delta).toFixed(2)}</span>
              </div>
            )) : (
              <p className="text-silver text-sm">No strikes available</p>
            )}
          </div>
        </div>

        {/* CALL Strikes */}
        <div>
          <p className="text-xs text-silver mb-2 uppercase">Call Strikes</p>
          <div className="space-y-1">
            {callStrikes.length > 0 ? callStrikes.slice(0, 5).map((strike) => (
              <div
                key={strike.strike}
                className={`flex items-center justify-between text-sm p-2 rounded ${
                  strike.strike === selectedCallStrike ? 'bg-green-500/20 border border-green-500/50' : 'bg-white/5'
                }`}
              >
                <span className="font-mono">{strike.strike}</span>
                <span className="text-silver">${strike.bid.toFixed(2)}</span>
                <span className="text-silver">δ{Math.abs(strike.delta).toFixed(2)}</span>
              </div>
            )) : (
              <p className="text-silver text-sm">No strikes available</p>
            )}
          </div>
        </div>
      </div>

      {expectedPremium !== undefined && (
        <div className="p-3 rounded-lg bg-white/5">
          <p className="text-sm text-silver">Expected Premium</p>
          <p className="font-mono text-xl">${expectedPremium.toFixed(2)}</p>
        </div>
      )}

      {/* Delta Range Display (Read-only) */}
      <div className="space-y-2">
        <p className="text-xs text-silver">Target Delta Range (Fixed)</p>
        <div className="flex items-center gap-2 text-sm">
          <span className="px-3 py-1 rounded bg-white/10 text-silver">{deltaRange.min} - {deltaRange.max}</span>
        </div>
      </div>
    </div>
  );
}

// Step 4: Position Size Content (CONFIGURABLE)
interface PositionSizeContentProps {
  buyingPower?: number;
  marginPerContract?: number;
  maxContracts?: number;
  currentContracts?: number;
  premium?: number;
  riskTier: RiskTier;
  onRiskTierChange: (tier: RiskTier) => void;
}

export function PositionSizeContent({
  buyingPower,
  marginPerContract,
  maxContracts,
  currentContracts,
  premium,
  riskTier,
  onRiskTierChange
}: PositionSizeContentProps) {
  const tierConfig = {
    conservative: { label: 'Conservative', contracts: '10-12', color: 'bg-blue-500' },
    balanced: { label: 'Balanced', contracts: '20-23', color: 'bg-green-500' },
    aggressive: { label: 'Aggressive', contracts: '30-35', color: 'bg-orange-500' },
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-silver mb-1">Buying Power</p>
          <p className="font-mono text-lg">${buyingPower?.toLocaleString() || '--'}</p>
        </div>
        <div>
          <p className="text-silver mb-1">Margin/Contract</p>
          <p className="font-mono text-lg">~${marginPerContract?.toLocaleString() || '--'}</p>
        </div>
        <div>
          <p className="text-silver mb-1">Max Contracts</p>
          <p className="font-mono text-lg">{maxContracts || '--'}</p>
        </div>
        <div>
          <p className="text-silver mb-1">Current Size</p>
          <p className="font-mono text-lg">{currentContracts || '--'}</p>
        </div>
      </div>

      {/* Risk Tier Selector (CONFIGURABLE) */}
      <div className="space-y-2">
        <p className="text-xs text-silver">Risk Tier</p>
        <div className="flex gap-2">
          {(['conservative', 'balanced', 'aggressive'] as RiskTier[]).map((tier) => (
            <button
              key={tier}
              onClick={() => onRiskTierChange(tier)}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition ${
                riskTier === tier
                  ? `${tierConfig[tier].color} text-white`
                  : 'bg-white/10 text-silver hover:bg-white/20'
              }`}
            >
              <div>{tierConfig[tier].label}</div>
              <div className="text-xs opacity-80">{tierConfig[tier].contracts}</div>
            </button>
          ))}
        </div>
      </div>

      {premium !== undefined && currentContracts !== undefined && (
        <div className="p-3 rounded-lg bg-white/5">
          <p className="text-sm text-silver">Premium Collection</p>
          <p className="font-mono text-xl">${(premium * currentContracts * 100).toLocaleString()}</p>
          <p className="text-xs text-silver">${premium.toFixed(2)} × {currentContracts} × 100</p>
        </div>
      )}
    </div>
  );
}

// Step 5: Exit Rules Content (CONFIGURABLE)
interface ExitRulesContentProps {
  entryPremium?: number;
  stopLoss?: number;
  maxLossPerTrade?: number;
  stopMultiplier: StopMultiplier;
  onStopMultiplierChange: (multiplier: StopMultiplier) => void;
  takeProfitPercent?: number;
  timeStop?: string;
}

export function ExitRulesContent({
  entryPremium,
  stopLoss,
  maxLossPerTrade,
  stopMultiplier,
  onStopMultiplierChange,
  takeProfitPercent = 50,
  timeStop = '3:30 PM'
}: ExitRulesContentProps) {
  const calculatedStopLoss = entryPremium ? entryPremium * stopMultiplier : stopLoss;
  const takeProfitPrice = entryPremium ? entryPremium * (1 - takeProfitPercent / 100) : undefined;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-silver mb-1">Entry Premium</p>
          <p className="font-mono text-lg">${entryPremium?.toFixed(2) || '--'}</p>
        </div>
        <div>
          <p className="text-silver mb-1">Stop Loss ({stopMultiplier}x)</p>
          <p className="font-mono text-lg text-red-500">${calculatedStopLoss?.toFixed(2) || '--'}</p>
        </div>
        <div>
          <p className="text-silver mb-1">Max Loss/Trade</p>
          <p className="font-mono text-lg text-red-500">${maxLossPerTrade?.toLocaleString() || '--'}</p>
        </div>
        <div>
          <p className="text-silver mb-1">Time Stop</p>
          <p className="font-mono text-lg">{timeStop} ET</p>
        </div>
      </div>

      {/* Stop Multiplier Selector (CONFIGURABLE) */}
      <div className="space-y-2">
        <p className="text-xs text-silver">Stop Loss Multiplier</p>
        <div className="flex gap-2">
          {([2, 3, 4] as StopMultiplier[]).map((mult) => (
            <button
              key={mult}
              onClick={() => onStopMultiplierChange(mult)}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition ${
                stopMultiplier === mult
                  ? 'bg-red-500 text-white'
                  : 'bg-white/10 text-silver hover:bg-white/20'
              }`}
            >
              {mult}x Premium
            </button>
          ))}
        </div>
      </div>

      {/* Take Profit & Time Stop (Read-only checkboxes) */}
      <div className="space-y-2 p-3 rounded-lg bg-white/5">
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle className="w-4 h-4 text-green-500" />
          <span>Close at {takeProfitPercent}% profit (${takeProfitPrice?.toFixed(2) || '--'})</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle className="w-4 h-4 text-green-500" />
          <span>Close by {timeStop} ET if still open</span>
        </div>
      </div>
    </div>
  );
}
