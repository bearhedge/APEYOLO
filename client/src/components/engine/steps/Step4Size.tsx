/**
 * Step4Size - Position Size with Risk Tiers
 *
 * Shows three risk tier buttons (Conservative/Balanced/Aggressive)
 * with position summary and account context.
 */

import { Button } from '@/components/ui/button';
import { Shield, Target, Zap } from 'lucide-react';

interface Step4SizeProps {
  riskTier: 'conservative' | 'balanced' | 'aggressive';
  onRiskTierChange: (tier: 'conservative' | 'balanced' | 'aggressive') => void;
  accountValue: number;
  recommendedContracts: number;
  premiumPerContract: number;
  marginRequired: number;
  maxRiskPercent: number;
  onContinue: () => void;
}

export function Step4Size({
  riskTier,
  onRiskTierChange,
  accountValue,
  recommendedContracts,
  premiumPerContract,
  marginRequired,
  maxRiskPercent,
  onContinue,
}: Step4SizeProps) {
  // Risk tier configurations
  const tiers = [
    {
      id: 'conservative' as const,
      label: 'Conservative',
      icon: Shield,
      description: '1 contract, minimal risk',
      bgClass: 'bg-blue-500/10',
      borderClass: 'border-blue-500/30',
      textClass: 'text-blue-400',
      hoverClass: 'hover:bg-blue-500/20',
    },
    {
      id: 'balanced' as const,
      label: 'Balanced',
      icon: Target,
      description: '2 contracts, moderate risk',
      bgClass: 'bg-green-500/10',
      borderClass: 'border-green-500/30',
      textClass: 'text-green-400',
      hoverClass: 'hover:bg-green-500/20',
    },
    {
      id: 'aggressive' as const,
      label: 'Aggressive',
      icon: Zap,
      description: '3 contracts, higher risk',
      bgClass: 'bg-amber-500/10',
      borderClass: 'border-amber-500/30',
      textClass: 'text-amber-400',
      hoverClass: 'hover:bg-amber-500/20',
    },
  ];

  const totalPremium = premiumPerContract * recommendedContracts;
  const totalMargin = marginRequired * recommendedContracts;

  return (
    <div className="space-y-6">
      {/* Risk Tier Selection - 3 Big Buttons */}
      <div className="grid grid-cols-3 gap-4">
        {tiers.map((tier) => {
          const Icon = tier.icon;
          const isSelected = tier.id === riskTier;
          return (
            <button
              key={tier.id}
              onClick={() => onRiskTierChange(tier.id)}
              className={`p-6 rounded-xl border transition-all ${
                isSelected
                  ? `${tier.bgClass} ${tier.borderClass} ring-2 ring-offset-2 ring-offset-zinc-950 ${tier.borderClass.replace('border-', 'ring-')}`
                  : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700'
              }`}
            >
              <div className="flex flex-col items-center gap-3">
                <Icon className={`w-10 h-10 ${isSelected ? tier.textClass : 'text-zinc-500'}`} />
                <div className="text-center">
                  <p className={`font-semibold mb-1 ${isSelected ? tier.textClass : 'text-white'}`}>
                    {tier.label}
                  </p>
                  <p className="text-xs text-zinc-500">{tier.description}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Position Summary */}
      <div className="p-6 bg-zinc-900/50 rounded-xl border border-zinc-800 space-y-4">
        <h4 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">
          Position Summary
        </h4>

        <div className="grid grid-cols-2 gap-4">
          {/* Contracts */}
          <div className="p-3 bg-black/20 rounded-lg">
            <p className="text-xs text-zinc-500 mb-1 uppercase tracking-wider">Contracts</p>
            <p className="text-2xl font-bold font-mono text-white">{recommendedContracts}</p>
          </div>

          {/* Premium */}
          <div className="p-3 bg-black/20 rounded-lg">
            <p className="text-xs text-zinc-500 mb-1 uppercase tracking-wider">Max Profit</p>
            <p className="text-2xl font-bold font-mono text-green-400">${totalPremium.toFixed(0)}</p>
          </div>

          {/* Margin Required */}
          <div className="p-3 bg-black/20 rounded-lg">
            <p className="text-xs text-zinc-500 mb-1 uppercase tracking-wider">Margin Required</p>
            <p className="text-2xl font-bold font-mono text-amber-400">${totalMargin.toFixed(0)}</p>
          </div>

          {/* Max Risk */}
          <div className="p-3 bg-black/20 rounded-lg">
            <p className="text-xs text-zinc-500 mb-1 uppercase tracking-wider">Max Risk</p>
            <p className="text-2xl font-bold font-mono text-red-400">{maxRiskPercent.toFixed(1)}%</p>
          </div>
        </div>
      </div>

      {/* Account Context */}
      <div className="p-4 bg-blue-500/5 rounded-lg border border-blue-500/20">
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-400">Account Value</span>
          <span className="font-mono font-semibold text-white">${accountValue.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between text-sm mt-2">
          <span className="text-zinc-400">Position Size</span>
          <span className="font-mono font-semibold text-blue-400">
            {((totalMargin / accountValue) * 100).toFixed(2)}% of account
          </span>
        </div>
      </div>

      {/* CTA */}
      <Button
        onClick={onContinue}
        className="w-full py-6 text-base"
        size="lg"
      >
        Set Exit Strategy
      </Button>
    </div>
  );
}
