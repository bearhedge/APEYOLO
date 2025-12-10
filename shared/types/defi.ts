/**
 * DeFi Types - Financial Identity Attestation System
 *
 * Types for on-chain attestation of trading track records on Solana.
 */

// Period options for attestation
export type AttestationPeriod = 'last_week' | 'last_month' | 'mtd' | 'custom';

// Attestation data structure (matches on-chain account)
export interface AttestationData {
  // Period identifiers
  periodStart: string;  // ISO date string
  periodEnd: string;    // ISO date string
  periodLabel: string;  // Human readable, e.g., "Dec 1-7, 2025"

  // NAV metrics
  navStart: number;     // USD
  navEnd: number;       // USD
  returnBps: number;    // Basis points (e.g., 350 = 3.50%)
  returnPercent: number; // Percentage (e.g., 3.50)

  // Performance metrics
  pnlUsd: number;       // Realized + Unrealized P&L in USD
  tradeCount: number;   // Number of trades in period
  winCount: number;     // Winning trades
  lossCount: number;    // Losing trades
  winRate: number;      // Win rate percentage

  // Exposure metrics
  impliedNotional: number;  // Total notional exposure (USD)
  realTurnover: number;     // Premium collected (USD)

  // Verification
  detailsHash: string;  // SHA256 hash of detailed trade data
}

// On-chain attestation (stored on Solana)
export interface OnChainAttestation {
  // Account identifiers
  publicKey: string;    // PDA address
  owner: string;        // Wallet that created this attestation

  // Attestation data
  data: AttestationData;

  // On-chain metadata
  createdAt: string;    // On-chain timestamp
  txSignature: string;  // Transaction signature
  slot: number;         // Solana slot number
}

// Profile summary (computed from attestations)
export interface ProfileSummary {
  // Aggregate metrics
  totalReturn: number;      // Cumulative return %
  winRate: number;          // Overall win rate %
  sharpeRatio: number;      // Annualized Sharpe ratio
  maxDrawdown: number;      // Maximum drawdown %

  // Counts
  verifiedPeriods: number;  // Number of attestations
  totalTrades: number;      // Total trades across all periods

  // Exposure
  cumulativeNotional: number;   // Sum of implied notional
  cumulativeTurnover: number;   // Sum of premium collected

  // Time range
  firstAttestation: string | null;  // Earliest period start
  lastAttestation: string | null;   // Latest period end
}

// API response for generating attestation data
export interface GenerateAttestationResponse {
  success: boolean;
  data?: AttestationData;
  error?: string;
}

// API request for generating attestation data
export interface GenerateAttestationRequest {
  periodType: AttestationPeriod;
  customStart?: string;  // ISO date for custom period
  customEnd?: string;    // ISO date for custom period
}

// Solana cluster configuration
export type SolanaCluster = 'devnet' | 'mainnet-beta';

// Wallet connection status
export interface WalletStatus {
  connected: boolean;
  publicKey: string | null;
  cluster: SolanaCluster;
}
