/**
 * Negotiation Service
 *
 * Calculates impact of trade modifications (strike changes, leg adjustments)
 * and generates intelligent agent responses for the negotiation flow.
 *
 * Key relationships:
 * - Widening strikes (further OTM) = lower premium, higher probability
 * - Narrowing strikes (closer to ATM) = higher premium, lower probability
 * - Delta roughly equals probability of expiring ITM
 */

import { getOptionChainStreamer } from '../broker/optionChainStreamer';

export interface ModificationImpact {
  premiumChange: number;       // Change in premium (negative = less premium)
  probabilityChange: number;   // Change in probability OTM (positive = safer)
  newPremium: number;          // New total premium
  newProbOTM: number;          // New probability of expiring OTM
  agentOpinion: 'approve' | 'caution' | 'reject';
  reasoning: string;
}

export interface StrikeModification {
  proposalId: string;
  legIndex: number;           // Which leg (0 for PUT in strangle, 1 for CALL)
  currentStrike: number;
  newStrike: number;
  optionType: 'PUT' | 'CALL';
  symbol: string;
}

/**
 * Estimate premium for a given strike based on delta
 * Uses approximate Black-Scholes relationship:
 * - Premium roughly proportional to delta for OTM options
 * - Each $1 strike change = ~$0.10-0.15 premium change for SPY
 */
function estimatePremiumForStrike(
  currentStrike: number,
  currentPremium: number,
  newStrike: number,
  optionType: 'PUT' | 'CALL',
  underlyingPrice: number
): { newPremium: number; newDelta: number } {
  const strikeChange = newStrike - currentStrike;

  // For PUTs: moving strike DOWN (more OTM) = less premium
  // For CALLs: moving strike UP (more OTM) = less premium
  const isWidening = optionType === 'PUT'
    ? strikeChange < 0   // PUT: lower strike = more OTM
    : strikeChange > 0;  // CALL: higher strike = more OTM

  // Approximate premium change per $1 strike (~10-15 cents for SPY)
  const premiumPerDollar = 0.12;
  const premiumChange = Math.abs(strikeChange) * premiumPerDollar * 100; // Convert to per-contract

  // Adjust premium based on direction
  const newPremium = isWidening
    ? Math.max(5, currentPremium - premiumChange)  // Widening = less premium, min $5
    : currentPremium + premiumChange;               // Narrowing = more premium

  // Estimate new delta based on distance from underlying
  const distanceFromUnderlying = optionType === 'PUT'
    ? underlyingPrice - newStrike
    : newStrike - underlyingPrice;

  // Rough delta estimation: starts at 0.50 ATM, decreases ~0.05 per $3 OTM for SPY
  const rawDelta = Math.max(0.02, 0.50 - (distanceFromUnderlying / 3) * 0.05);
  const newDelta = optionType === 'PUT' ? -rawDelta : rawDelta;

  return { newPremium, newDelta };
}

/**
 * Try to get real option data for the new strike from cached chain
 */
function getRealStrikeData(
  symbol: string,
  strike: number,
  optionType: 'PUT' | 'CALL'
): { bid: number; ask: number; delta: number } | null {
  try {
    const streamer = getOptionChainStreamer();
    const chain = streamer.getOptionChain(symbol);

    if (!chain) return null;

    const options = optionType === 'PUT' ? chain.puts : chain.calls;
    const option = options.find(o => o.strike === strike);

    if (option && option.bid > 0) {
      return {
        bid: option.bid,
        ask: option.ask,
        delta: option.delta ?? 0
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Calculate the impact of modifying a strike
 */
export async function calculateModificationImpact(
  modification: StrikeModification,
  currentLegPremium: number,
  currentDelta: number,
  underlyingPrice: number
): Promise<ModificationImpact> {
  const { currentStrike, newStrike, optionType, symbol } = modification;
  const strikeChange = newStrike - currentStrike;

  // Try to get real data first
  const realData = getRealStrikeData(symbol, newStrike, optionType);

  let newPremium: number;
  let newDelta: number;

  if (realData) {
    // Use real market data
    newPremium = ((realData.bid + realData.ask) / 2) * 100; // Per contract
    newDelta = realData.delta;
  } else {
    // Fall back to estimation
    const estimated = estimatePremiumForStrike(
      currentStrike,
      currentLegPremium,
      newStrike,
      optionType,
      underlyingPrice
    );
    newPremium = estimated.newPremium;
    newDelta = estimated.newDelta;
  }

  // Calculate probability OTM (1 - |delta|)
  const currentProbOTM = (1 - Math.abs(currentDelta)) * 100;
  const newProbOTM = (1 - Math.abs(newDelta)) * 100;
  const probabilityChange = newProbOTM - currentProbOTM;
  const premiumChange = newPremium - currentLegPremium;

  // Determine agent opinion based on trade-offs
  let agentOpinion: 'approve' | 'caution' | 'reject';
  let reasoning: string;

  // Widening = more OTM
  const isWidening = optionType === 'PUT'
    ? strikeChange < 0
    : strikeChange > 0;

  if (isWidening) {
    // Widening: less premium but safer
    if (probabilityChange > 0 && premiumChange >= -30) {
      // Good trade-off: significant probability gain with acceptable premium loss
      agentOpinion = 'approve';
      reasoning = `Moving ${optionType} to $${newStrike} increases win probability by ${probabilityChange.toFixed(1)}%. Premium drops $${Math.abs(premiumChange).toFixed(0)} but risk profile improves.`;
    } else if (premiumChange < -50) {
      // Too much premium loss
      agentOpinion = 'caution';
      reasoning = `$${newStrike} is quite far OTM. Premium drops $${Math.abs(premiumChange).toFixed(0)} which may not justify the ${probabilityChange.toFixed(1)}% probability gain. Consider a smaller adjustment.`;
    } else {
      agentOpinion = 'approve';
      reasoning = `Reasonable trade-off. Less premium ($${newPremium.toFixed(0)}) but ${probabilityChange.toFixed(1)}% better win rate.`;
    }
  } else {
    // Narrowing: more premium but riskier
    if (newProbOTM < 70) {
      // Too risky - probability of profit below 70%
      agentOpinion = 'reject';
      reasoning = `$${newStrike} is too close to the money. Probability of profit drops to ${newProbOTM.toFixed(0)}% which violates our risk mandate. I recommend staying at $${currentStrike} or moving further OTM.`;
    } else if (premiumChange > 30 && probabilityChange > -10) {
      // Good premium boost without too much risk
      agentOpinion = 'approve';
      reasoning = `Moving to $${newStrike} boosts premium by $${premiumChange.toFixed(0)}. Win probability drops ${Math.abs(probabilityChange).toFixed(1)}% to ${newProbOTM.toFixed(0)}% - still acceptable.`;
    } else {
      agentOpinion = 'caution';
      reasoning = `$${newStrike} increases premium $${premiumChange.toFixed(0)} but drops win probability ${Math.abs(probabilityChange).toFixed(1)}% to ${newProbOTM.toFixed(0)}%. Consider the risk/reward carefully.`;
    }
  }

  return {
    premiumChange: Math.round(premiumChange),
    probabilityChange: Math.round(probabilityChange * 10) / 10,
    newPremium: Math.round(newPremium),
    newProbOTM: Math.round(newProbOTM),
    agentOpinion,
    reasoning
  };
}

/**
 * Generate an LLM-powered pushback response for more nuanced negotiation
 * Falls back to template-based responses if LLM unavailable
 */
export async function generateNegotiationResponse(
  modification: StrikeModification,
  impact: ModificationImpact,
  context: {
    vix: number;
    underlyingPrice: number;
    totalContracts: number;
    riskProfile: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
  }
): Promise<string> {
  // For now, use the template-based reasoning from calculateModificationImpact
  // TODO: Add LLM-powered response generation for more nuanced pushback

  const { vix, underlyingPrice, totalContracts, riskProfile } = context;

  // Add VIX context to the response
  let vixContext = '';
  if (vix > 25) {
    vixContext = ` Note: VIX is elevated at ${vix.toFixed(1)}, suggesting staying further OTM is prudent.`;
  } else if (vix < 15) {
    vixContext = ` VIX is low (${vix.toFixed(1)}), so premiums are thin - this adjustment helps.`;
  }

  // Add risk profile context
  let riskContext = '';
  if (riskProfile === 'CONSERVATIVE' && impact.newProbOTM < 80) {
    riskContext = ` Given your conservative risk profile, I'd prefer ${impact.newProbOTM < 75 ? 'staying further OTM' : 'this is acceptable'}.`;
  } else if (riskProfile === 'AGGRESSIVE' && impact.newProbOTM > 85) {
    riskContext = ` For your aggressive profile, you could consider moving closer for more premium.`;
  }

  return `${impact.reasoning}${vixContext}${riskContext}`;
}

/**
 * Validate that a proposed modification is within guardrails
 */
export function validateModification(
  modification: StrikeModification,
  underlyingPrice: number
): { valid: boolean; error?: string } {
  const { newStrike, optionType } = modification;

  // Check strike is reasonable relative to underlying
  const maxDistance = underlyingPrice * 0.15; // Max 15% from underlying

  if (optionType === 'PUT') {
    if (newStrike > underlyingPrice) {
      return { valid: false, error: 'PUT strike must be below current price' };
    }
    if (underlyingPrice - newStrike > maxDistance) {
      return { valid: false, error: 'Strike is too far OTM (>15% from underlying)' };
    }
    if (underlyingPrice - newStrike < 2) {
      return { valid: false, error: 'Strike is too close to ATM (must be at least $2 OTM)' };
    }
  } else {
    if (newStrike < underlyingPrice) {
      return { valid: false, error: 'CALL strike must be above current price' };
    }
    if (newStrike - underlyingPrice > maxDistance) {
      return { valid: false, error: 'Strike is too far OTM (>15% from underlying)' };
    }
    if (newStrike - underlyingPrice < 2) {
      return { valid: false, error: 'Strike is too close to ATM (must be at least $2 OTM)' };
    }
  }

  return { valid: true };
}
