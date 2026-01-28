/**
 * useRailsEnforcement - Hook for validating trades against DeFi Rails
 *
 * Fetches the active rail and validates trade parameters against it.
 * Returns enforcement result indicating if trade is allowed.
 */

import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Rail, EnforcementResult, ViolationType } from '@shared/types/rails';

interface TradeParams {
  symbol: string;
  side: 'BUY' | 'SELL';
  delta?: number;
  contracts?: number;
}

interface UseRailsEnforcementResult {
  validate: (trade: TradeParams) => EnforcementResult;
  isValidating: boolean;
  result: EnforcementResult | null;
  activeRail: Rail | null;
  isLoading: boolean;
  clearResult: () => void;
}

export function useRailsEnforcement(): UseRailsEnforcementResult {
  const [result, setResult] = useState<EnforcementResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  // Fetch active rail
  const { data: railData, isLoading } = useQuery<{
    success: boolean;
    rail: Rail | null;
    violations: any[];
    violationCount: number;
    monthlyViolations: number;
  }>({
    queryKey: ['/api/defi/rails'],
    queryFn: async () => {
      const res = await fetch('/api/defi/rails', { credentials: 'include' });
      if (!res.ok) {
        return { success: false, rail: null, violations: [], violationCount: 0, monthlyViolations: 0 };
      }
      return res.json();
    },
    staleTime: 30000, // 30 seconds
  });

  const activeRail = railData?.rail || null;

  // Client-side validation against active rail
  const validate = useCallback((trade: TradeParams): EnforcementResult => {
    setIsValidating(true);

    try {
      // No rail = no restrictions
      if (!activeRail) {
        const allowedResult: EnforcementResult = { allowed: true };
        setResult(allowedResult);
        return allowedResult;
      }

      // Check 1: Symbol
      if (!activeRail.allowedSymbols.includes(trade.symbol)) {
        const violation: EnforcementResult = {
          allowed: false,
          reason: `Symbol "${trade.symbol}" is not permitted. Allowed: ${activeRail.allowedSymbols.join(', ')}`,
          violation: {
            type: 'symbol' as ViolationType,
            attempted: trade.symbol,
            limit: activeRail.allowedSymbols.join(','),
          },
        };
        setResult(violation);
        return violation;
      }

      // Check 2: Strategy (must be SELL for credit strategies)
      if (trade.side !== activeRail.strategyType) {
        const violation: EnforcementResult = {
          allowed: false,
          reason: `Only ${activeRail.strategyType} strategies are permitted`,
          violation: {
            type: 'strategy' as ViolationType,
            attempted: trade.side,
            limit: activeRail.strategyType,
          },
        };
        setResult(violation);
        return violation;
      }

      // Check 3: Delta range
      if (trade.delta !== undefined) {
        if (trade.delta < activeRail.minDelta || trade.delta > activeRail.maxDelta) {
          const violation: EnforcementResult = {
            allowed: false,
            reason: `Delta ${trade.delta.toFixed(2)} is outside allowed range (${activeRail.minDelta}-${activeRail.maxDelta})`,
            violation: {
              type: 'delta' as ViolationType,
              attempted: trade.delta.toString(),
              limit: `${activeRail.minDelta}-${activeRail.maxDelta}`,
            },
          };
          setResult(violation);
          return violation;
        }
      }

      // All checks passed
      const allowedResult: EnforcementResult = { allowed: true };
      setResult(allowedResult);
      return allowedResult;
    } finally {
      setIsValidating(false);
    }
  }, [activeRail]);

  const clearResult = useCallback(() => {
    setResult(null);
  }, []);

  return {
    validate,
    isValidating,
    result,
    activeRail,
    isLoading,
    clearResult,
  };
}
