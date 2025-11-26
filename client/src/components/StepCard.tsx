import { useState } from 'react';
import { ChevronDown, ChevronRight, CheckCircle, XCircle, Clock, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { VIXChart } from './charts';

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
  const vixStatus = vix ? (vix < vixThreshold ? 'SAFE TO TRADE' : vix < 25 ? 'CAUTION' : 'HIGH RISK') : 'N/A';
  const vixColor = vix ? (vix < vixThreshold ? 'text-green-500' : vix < 25 ? 'text-yellow-500' : 'text-red-500') : 'text-silver';
  const statusBgColor = vix ? (vix < vixThreshold ? 'bg-green-500/10' : vix < 25 ? 'bg-yellow-500/10' : 'bg-red-500/10') : 'bg-white/5';

  return (
    <div className="space-y-4">
      {/* VIX Chart with integrated header, OHLC, and timeframe selector */}
      {showChart && (
        <VIXChart
          height={180}
          defaultTimeframe="5D"
          chartType="line"
          showTimeframeSelector={true}
          showOHLC={true}
        />
      )}

      {/* Status and SPY Context */}
      <div className="flex items-center justify-between p-3 rounded-lg bg-white/5">
        <div className={`flex items-center gap-2 ${vixColor}`}>
          <div className={`w-2 h-2 rounded-full ${vix && vix < vixThreshold ? 'bg-green-500' : vix && vix < 25 ? 'bg-yellow-500' : 'bg-red-500'}`} />
          <span className="font-medium">{vixStatus}</span>
          <span className="text-neutral-400 text-sm">(threshold: {vixThreshold})</span>
        </div>
        <div className="text-sm text-neutral-400">
          SPY: ${spyPrice?.toFixed(2) || '--'}
          <span className={`ml-2 ${(spyChange || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {spyChange ? `${spyChange >= 0 ? '+' : ''}${spyChange.toFixed(2)}%` : ''}
          </span>
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
  maPrice?: number;
  maPeriod?: number;
  reasoning?: string;
}

export function DirectionContent({ direction, confidence, spyPrice, maPrice, maPeriod = 20, reasoning }: DirectionContentProps) {
  const percentFromMA = spyPrice && maPrice ? ((spyPrice - maPrice) / maPrice) * 100 : null;

  const DirectionIcon = direction === 'PUT' ? TrendingDown : direction === 'CALL' ? TrendingUp : Minus;
  const directionColor = direction === 'PUT' ? 'text-red-500' : direction === 'CALL' ? 'text-green-500' : 'text-yellow-500';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-silver mb-1">SPY Price</p>
          <p className="font-mono text-lg">${spyPrice?.toFixed(2) || '--'}</p>
        </div>
        <div>
          <p className="text-silver mb-1">{maPeriod}-day MA</p>
          <p className="font-mono text-lg">${maPrice?.toFixed(2) || '--'}</p>
        </div>
        <div>
          <p className="text-silver mb-1">Position vs MA</p>
          <p className={`font-mono text-lg ${(percentFromMA || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
            {percentFromMA !== null ? `${percentFromMA >= 0 ? '+' : ''}${percentFromMA.toFixed(2)}%` : '--'}
          </p>
        </div>
        <div>
          <p className="text-silver mb-1">Confidence</p>
          <p className="font-mono text-lg">{confidence ? `${(confidence * 100).toFixed(0)}%` : '--'}</p>
        </div>
      </div>

      {direction && (
        <div className={`flex items-center gap-3 p-3 rounded-lg bg-white/5 ${directionColor}`}>
          <DirectionIcon className="w-5 h-5" />
          <div>
            <p className="font-medium">Recommendation: SELL {direction}</p>
            <p className="text-sm opacity-80">{reasoning || 'Based on price vs MA'}</p>
          </div>
        </div>
      )}

      {/* MA Period Display (Read-only) */}
      <div className="space-y-2">
        <p className="text-xs text-silver">MA Period (Fixed)</p>
        <div className="flex items-center gap-2 text-sm">
          <span className="px-3 py-1 rounded bg-white/10 text-silver">{maPeriod}-day</span>
        </div>
      </div>
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
