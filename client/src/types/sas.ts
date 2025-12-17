/**
 * Solana Attestation Service Types
 *
 * Re-exports and additional types for SAS integration.
 */

import type { Address, Account } from '@solana/kit';
import type { Attestation, Schema, Credential } from 'sas-lib';

// Re-export sas-lib types
export type { Attestation, Schema, Credential };
export type { Address, Account };

// ============================================
// APEYOLO-Specific Types
// ============================================

/**
 * Trading mandate data stored in attestation
 */
export interface TradingMandateData {
  mandateId: string;
  rulesHash: string;
  strategyType: string;
  allowedSymbols: string;
  maxDailyLoss: number;
  createdAt: number;
}

/**
 * Result of verifying a user's mandate
 */
export interface MandateVerificationResult {
  hasMandate: boolean;
  attestationAccount: Account<Attestation> | null;
  data: TradingMandateData | null;
}

/**
 * SAS infrastructure status
 */
export interface SASInfrastructureStatus {
  ready: boolean;
  credentialAddress: Address | null;
  schemaAddress: Address | null;
  error?: string;
}

/**
 * Result of creating an attestation
 */
export interface AttestationResult {
  success: boolean;
  signature?: string;
  attestationAddress?: string;
  explorerUrl?: string;
  error?: string;
}

/**
 * SAS context value for React context
 */
export interface SASContextValue {
  // Infrastructure status
  infrastructureReady: boolean;
  infrastructureError: string | null;
  credentialAddress: Address | null;
  schemaAddress: Address | null;

  // User attestation status
  userHasMandate: boolean;
  mandateData: TradingMandateData | null;
  attestationAddress: Address | null;

  // Loading states
  checkingInfrastructure: boolean;
  checkingMandate: boolean;
  creatingAttestation: boolean;

  // Actions
  refreshMandateStatus: () => Promise<void>;
  createMandateAttestation: (mandateData: TradingMandateData) => Promise<AttestationResult>;
}

/**
 * Cluster type for SAS operations
 */
export type SASCluster = 'devnet' | 'mainnet-beta';
