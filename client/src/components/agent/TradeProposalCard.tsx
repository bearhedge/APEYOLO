/**
 * TradeProposalCard - Interactive Trade Negotiation
 *
 * Shows a trade proposal with:
 * - Editable strikes (click to adjust)
 * - Impact preview when modifying
 * - Agent negotiation messages
 * - Execute button with approval
 */

import { useState, useCallback } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Loader2, Shield, Minus, Plus, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface TradeLeg {
  optionType: 'PUT' | 'CALL';
  strike: number;
  delta: number;
  premium: number;
}

export interface TradeProposal {
  id: string;
  symbol: string;
  expiration: string;
  strategy: 'PUT' | 'CALL' | 'STRANGLE';
  bias: 'BULL' | 'BEAR' | 'NEUTRAL';
  legs: TradeLeg[];
  contracts: number;
  entryPremiumTotal: number;
  maxLoss: number;
  stopLossPrice: number;
  reasoning?: string;
}

export interface CritiqueResult {
  approved: boolean;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  mandateCompliant: boolean;
  concerns: string[];
  suggestions?: string[];
}

export interface ExecutionResult {
  success: boolean;
  message: string;
  ibkrOrderIds?: number[];
  tradeId?: string;
  timestamp: Date;
}

export interface ModificationImpact {
  premiumChange: number;
  probabilityChange: number;
  newPremium: number;
  newProbOTM: number;
  agentOpinion: 'approve' | 'caution' | 'reject';
  reasoning: string;
}

export interface NegotiationMessage {
  role: 'agent' | 'user';
  content: string;
  timestamp: Date;
}

interface TradeProposalCardProps {
  proposal: TradeProposal;
  critique?: CritiqueResult;
  executionResult?: ExecutionResult;
  isExecuting: boolean;
  onExecute: () => void;
  onReject?: () => void;
  // Negotiation props
  isNegotiating?: boolean;
  onModifyStrike?: (legIndex: number, newStrike: number) => Promise<ModificationImpact | null>;
  negotiationMessages?: NegotiationMessage[];
}

/**
 * Strike adjustment component with +/- buttons
 */
function StrikeAdjuster({
  strike,
  optionType,
  onAdjust,
  isLoading,
  disabled,
}: {
  strike: number;
  optionType: 'PUT' | 'CALL';
  onAdjust: (newStrike: number) => void;
  isLoading?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onAdjust(strike - 1)}
        disabled={disabled || isLoading}
        className="p-1.5 rounded bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        title="Decrease strike"
      >
        <Minus className="w-3 h-3" />
      </button>
      <span className={`font-mono font-medium px-3 py-1.5 rounded min-w-[80px] text-center ${
        optionType === 'PUT'
          ? 'bg-red-500/20 text-red-400 border border-red-500/30'
          : 'bg-green-500/20 text-green-400 border border-green-500/30'
      }`}>
        ${strike}
      </span>
      <button
        onClick={() => onAdjust(strike + 1)}
        disabled={disabled || isLoading}
        className="p-1.5 rounded bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        title="Increase strike"
      >
        <Plus className="w-3 h-3" />
      </button>
      {isLoading && <Loader2 className="w-4 h-4 animate-spin text-silver ml-1" />}
    </div>
  );
}

/**
 * Impact preview when user modifies a strike
 */
function ImpactPreview({ impact }: { impact: ModificationImpact }) {
  return (
    <div className={`p-3 rounded-lg border ${
      impact.agentOpinion === 'approve'
        ? 'bg-green-500/10 border-green-500/20'
        : impact.agentOpinion === 'caution'
        ? 'bg-amber-500/10 border-amber-500/20'
        : 'bg-red-500/10 border-red-500/20'
    }`}>
      <div className="flex items-start gap-2 mb-2">
        {impact.agentOpinion === 'approve' && <CheckCircle className="w-4 h-4 text-green-400 mt-0.5" />}
        {impact.agentOpinion === 'caution' && <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5" />}
        {impact.agentOpinion === 'reject' && <XCircle className="w-4 h-4 text-red-400 mt-0.5" />}
        <div className="flex-1">
          <p className="text-sm">{impact.reasoning}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-silver">Premium:</span>{' '}
          <span className={impact.premiumChange >= 0 ? 'text-green-400' : 'text-red-400'}>
            {impact.premiumChange >= 0 ? '+' : ''}{impact.premiumChange.toFixed(0)}
          </span>
          <span className="text-silver"> (${impact.newPremium.toFixed(0)})</span>
        </div>
        <div>
          <span className="text-silver">Prob OTM:</span>{' '}
          <span className={impact.probabilityChange >= 0 ? 'text-green-400' : 'text-red-400'}>
            {impact.probabilityChange >= 0 ? '+' : ''}{impact.probabilityChange.toFixed(1)}%
          </span>
          <span className="text-silver"> ({impact.newProbOTM.toFixed(0)}%)</span>
        </div>
      </div>
    </div>
  );
}

export function TradeProposalCard({
  proposal,
  critique,
  executionResult,
  isExecuting,
  onExecute,
  onReject,
  isNegotiating = false,
  onModifyStrike,
  negotiationMessages = [],
}: TradeProposalCardProps) {
  // Local state for UI feedback only (impact preview, loading states)
  const [pendingImpact, setPendingImpact] = useState<ModificationImpact | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [activeModifyIndex, setActiveModifyIndex] = useState<number | null>(null);

  const {
    symbol,
    expiration,
    strategy,
    bias,
    contracts,
    entryPremiumTotal,
    maxLoss,
    stopLossPrice,
    legs, // Use legs directly from proposal (parent updates it via updateProposal)
  } = proposal;

  // Calculate probability OTM from average delta
  const avgDelta = legs.reduce((sum, leg) => sum + Math.abs(leg.delta), 0) / legs.length;
  const probOTM = ((1 - avgDelta) * 100).toFixed(0);
  const riskReward = (maxLoss / entryPremiumTotal).toFixed(1);

  // Calculate per-contract premium (sum of all legs' premiums)
  const premiumPerContract = legs.reduce((sum, leg) => sum + leg.premium, 0);

  // Determine if execution is allowed
  const canExecute = critique?.approved && critique?.mandateCompliant && !executionResult?.success;

  // Strategy display
  const strategyLabel = strategy === 'STRANGLE' ? 'SELL STRANGLE' :
    strategy === 'PUT' ? 'SELL PUT' : 'SELL CALL';

  // Handle strike modification
  // Parent (Agent.tsx) updates the proposal via updateProposal() when server returns new values
  const handleStrikeChange = useCallback(async (legIndex: number, newStrike: number) => {
    if (!onModifyStrike) return;

    setActiveModifyIndex(legIndex);
    setIsCalculating(true);
    setPendingImpact(null);

    try {
      const impact = await onModifyStrike(legIndex, newStrike);
      if (impact) {
        setPendingImpact(impact);
        // Note: Parent updates proposal.legs via updateProposal(), so we don't need local state
      }
    } catch (error) {
      console.error('Failed to calculate impact:', error);
    } finally {
      setIsCalculating(false);
      setActiveModifyIndex(null);
    }
  }, [onModifyStrike]);

  return (
    <div className={`bg-charcoal rounded-2xl p-6 border shadow-lg ${
      isNegotiating
        ? 'border-amber-500/30'
        : critique?.approved
        ? 'border-green-500/30'
        : 'border-white/10'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">{strategyLabel}</h3>
          <p className="text-sm text-silver">{symbol} {expiration}</p>
        </div>
        <div className="flex items-center gap-2">
          {isNegotiating && (
            <span className="text-xs font-medium px-2 py-1 rounded bg-amber-500/20 text-amber-400 flex items-center gap-1">
              <MessageSquare className="w-3 h-3" />
              Negotiating
            </span>
          )}
          {critique && (
            <span className={`text-xs font-medium px-2 py-1 rounded flex items-center gap-1 ${
              critique.approved
                ? 'bg-green-500/20 text-green-400'
                : 'bg-red-500/20 text-red-400'
            }`}>
              <Shield className="w-3 h-3" />
              {critique.approved ? 'Approved' : 'Rejected'}
            </span>
          )}
          <span className={`text-xs font-medium px-2 py-1 rounded ${
            bias === 'NEUTRAL' ? 'bg-blue-500/20 text-blue-400' :
            bias === 'BULL' ? 'bg-green-500/20 text-green-400' :
            'bg-red-500/20 text-red-400'
          }`}>
            {bias}
          </span>
        </div>
      </div>

      {/* Critique concerns */}
      {critique && critique.concerns.length > 0 && (
        <div className={`mb-4 rounded-lg p-3 ${
          critique.approved ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-red-500/10 border border-red-500/20'
        }`}>
          <p className={`text-sm font-medium mb-2 ${critique.approved ? 'text-amber-400' : 'text-red-500'}`}>
            {critique.approved ? 'Notes:' : 'Concerns:'}
          </p>
          <ul className={`text-sm space-y-1 ${critique.approved ? 'text-amber-400/80' : 'text-red-400'}`}>
            {critique.concerns.map((concern, i) => (
              <li key={i}>- {concern}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Strike Selection - Editable in negotiating mode */}
      <div className="mb-4 p-3 bg-black/20 rounded-lg">
        <div className="flex flex-wrap items-center gap-4">
          {legs.map((leg, i) => (
            isNegotiating && onModifyStrike ? (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-silver">{leg.optionType}:</span>
                <StrikeAdjuster
                  strike={leg.strike}
                  optionType={leg.optionType}
                  onAdjust={(newStrike) => handleStrikeChange(i, newStrike)}
                  isLoading={isCalculating && activeModifyIndex === i}
                  disabled={isExecuting}
                />
              </div>
            ) : (
              <span key={i} className={`font-mono font-medium ${
                leg.optionType === 'PUT' ? 'text-red-400' : 'text-green-400'
              }`}>
                ${leg.strike} {leg.optionType}
              </span>
            )
          ))}
          <span className="text-silver">-</span>
          <span className="font-mono">{contracts} contracts</span>
        </div>
      </div>

      {/* Impact Preview (when modifying) */}
      {pendingImpact && (
        <div className="mb-4">
          <ImpactPreview impact={pendingImpact} />
        </div>
      )}

      {/* Negotiation Messages */}
      {negotiationMessages.length > 0 && (
        <div className="mb-4 max-h-32 overflow-y-auto space-y-2 p-3 bg-black/10 rounded-lg">
          {negotiationMessages.slice(-3).map((msg, i) => (
            <div key={i} className={`text-sm ${msg.role === 'agent' ? 'text-blue-400' : 'text-white'}`}>
              <span className="text-xs text-silver mr-2">
                {msg.role === 'agent' ? 'Agent:' : 'You:'}
              </span>
              {msg.content}
            </div>
          ))}
        </div>
      )}

      {/* Key Metrics - 2x2 Grid */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="p-3 bg-black/20 rounded-lg">
          <p className="text-xs text-silver mb-1">Max Profit (Premium)</p>
          <p className="text-lg font-semibold text-green-400">
            ${entryPremiumTotal.toFixed(0)}
            {contracts > 1 && premiumPerContract > 0 && (
              <span className="text-xs text-silver ml-1">
                (${premiumPerContract.toFixed(0)}/contract)
              </span>
            )}
          </p>
        </div>
        <div className="p-3 bg-black/20 rounded-lg">
          <p className="text-xs text-silver mb-1">Max Loss (at Stop)</p>
          <p className="text-lg font-semibold text-red-400">
            ${maxLoss.toFixed(0)}
          </p>
        </div>
        <div className="p-3 bg-black/20 rounded-lg">
          <p className="text-xs text-silver mb-1">Probability OTM</p>
          <p className="text-lg font-semibold">{probOTM}%</p>
        </div>
        <div className="p-3 bg-black/20 rounded-lg">
          <p className="text-xs text-silver mb-1">Stop Loss</p>
          <p className="text-lg font-semibold">
            ${stopLossPrice.toFixed(2)} <span className="text-xs text-silver">(3x)</span>
          </p>
        </div>
      </div>

      {/* Risk/Reward Summary */}
      <div className="mb-4 text-sm text-silver">
        Risk/Reward: <span className="font-mono text-white">{riskReward}:1</span>
        {critique?.riskLevel && (
          <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${
            critique.riskLevel === 'LOW' ? 'bg-green-500/20 text-green-400' :
            critique.riskLevel === 'MEDIUM' ? 'bg-amber-500/20 text-amber-400' :
            'bg-red-500/20 text-red-400'
          }`}>
            {critique.riskLevel} RISK
          </span>
        )}
      </div>

      {/* Execution Result Display */}
      {executionResult && (
        <div className={`mb-4 p-4 rounded-lg border ${
          executionResult.success
            ? 'bg-green-500/10 border-green-500/30'
            : 'bg-red-500/10 border-red-500/30'
        }`}>
          <div className="flex items-start gap-3">
            {executionResult.success ? (
              <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <p className={`font-semibold ${executionResult.success ? 'text-green-400' : 'text-red-400'}`}>
                {executionResult.success ? 'Order Submitted' : 'Order Failed'}
              </p>
              <p className="text-sm text-silver mt-1">{executionResult.message}</p>
              {executionResult.ibkrOrderIds && executionResult.ibkrOrderIds.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs text-silver">IBKR Order IDs:</p>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {executionResult.ibkrOrderIds.map((id, i) => (
                      <span key={i} className="font-mono text-xs bg-black/30 px-2 py-1 rounded">
                        {id}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {executionResult.tradeId && (
                <p className="text-xs text-silver mt-2">
                  Trade ID: <span className="font-mono">{executionResult.tradeId}</span>
                </p>
              )}
              <p className="text-xs text-silver/60 mt-2">
                {executionResult.timestamp.toLocaleTimeString('en-US', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                  timeZone: 'America/New_York'
                })} ET
              </p>
              {executionResult.success && (
                <p className="text-xs text-yellow-400/80 mt-2 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  Check IBKR mobile/web for order status
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3">
        <Button
          onClick={onExecute}
          disabled={!canExecute || isExecuting}
          className={`flex-1 py-3 text-lg font-semibold ${
            executionResult?.success
              ? 'bg-gray-600 hover:bg-gray-700'
              : 'bg-green-600 hover:bg-green-700'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {isExecuting ? (
            <>
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              Executing...
            </>
          ) : executionResult?.success ? (
            'Execute Again'
          ) : (
            'EXECUTE'
          )}
        </Button>
        {onReject && !executionResult?.success && (
          <Button
            onClick={onReject}
            variant="ghost"
            className="text-silver hover:text-white"
          >
            Dismiss
          </Button>
        )}
      </div>
    </div>
  );
}
