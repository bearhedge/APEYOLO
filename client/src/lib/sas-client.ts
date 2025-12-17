/**
 * Solana Attestation Service (SAS) Client
 *
 * Integrates with the official Solana Attestation Service for
 * on-chain mandate and attestation verification.
 *
 * @see https://attest.solana.com
 * @see https://github.com/solana-foundation/solana-attestation-service
 */

import {
  deriveCredentialPda,
  deriveSchemaPda,
  deriveAttestationPda,
  getCreateCredentialInstruction,
  getCreateSchemaInstruction,
  getCreateAttestationInstruction,
  serializeAttestationData,
  deserializeAttestationData,
  fetchMaybeCredential,
  fetchMaybeSchema,
  fetchMaybeAttestation,
  SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS,
  type Schema,
  type Attestation,
  type Credential,
} from 'sas-lib';

import type { Account, MaybeAccount } from '@solana/kit';

import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  address,
  type Address,
  type TransactionSigner,
  type KeyPairSigner,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  sendAndConfirmTransactionFactory,
  getSignatureFromTransaction,
} from '@solana/kit';

import type { Connection, PublicKey } from '@solana/web3.js';
import type { WalletContextState } from '@solana/wallet-adapter-react';

// ============================================
// Constants
// ============================================

// APEYOLO Credential Configuration
// NOTE: These will be set after initial deployment
export const APEYOLO_CREDENTIAL_NAME = 'APEYOLO-TRADING';
export const APEYOLO_SCHEMA_NAME = 'TRADING-MANDATE';
export const APEYOLO_SCHEMA_VERSION = 1;

// Schema field definitions for trading mandates
export const TRADING_MANDATE_SCHEMA_FIELDS = [
  'mandateId',      // UUID string
  'rulesHash',      // SHA256 hash (32 bytes as hex string)
  'strategyType',   // e.g., "put-credit-spread"
  'allowedSymbols', // Comma-separated: "SPY,SPX"
  'maxDailyLoss',   // Percentage as integer (300 = 3.00%)
  'createdAt',      // Unix timestamp
];

// Schema layout (byte sizes for each field)
// Using variable length encoding for strings
export const TRADING_MANDATE_SCHEMA_LAYOUT = Buffer.from([
  36,  // mandateId: UUID string (36 chars)
  64,  // rulesHash: SHA256 hex string (64 chars)
  32,  // strategyType: max 32 chars
  32,  // allowedSymbols: max 32 chars
  4,   // maxDailyLoss: u32
  8,   // createdAt: i64 timestamp
]);

// ============================================
// Types
// ============================================

export interface TradingMandateData {
  mandateId: string;
  rulesHash: string;
  strategyType: string;
  allowedSymbols: string;
  maxDailyLoss: number;
  createdAt: number;
}

export interface AttestationResult {
  signature: string;
  attestationAddress: string;
  explorerUrl: string;
}

export interface SASConfig {
  cluster: 'devnet' | 'mainnet-beta';
  credentialAuthority?: Address;  // Set after credential is created
  schemaAddress?: Address;        // Set after schema is created
}

// ============================================
// RPC Client Factory
// ============================================

function getRpcUrl(cluster: 'devnet' | 'mainnet-beta'): string {
  return cluster === 'devnet'
    ? 'https://api.devnet.solana.com'
    : 'https://api.mainnet-beta.solana.com';
}

function getWsUrl(cluster: 'devnet' | 'mainnet-beta'): string {
  return cluster === 'devnet'
    ? 'wss://api.devnet.solana.com'
    : 'wss://api.mainnet-beta.solana.com';
}

export function createSasRpc(cluster: 'devnet' | 'mainnet-beta' = 'devnet') {
  return createSolanaRpc(getRpcUrl(cluster));
}

export function createSasRpcSubscriptions(cluster: 'devnet' | 'mainnet-beta' = 'devnet') {
  return createSolanaRpcSubscriptions(getWsUrl(cluster));
}

// ============================================
// Address Conversion Helpers
// ============================================

/**
 * Convert a web3.js PublicKey to a kit Address
 */
export function publicKeyToAddress(publicKey: PublicKey): Address {
  return address(publicKey.toBase58());
}

/**
 * Convert a base58 string to a kit Address
 */
export function stringToAddress(str: string): Address {
  return address(str);
}

// ============================================
// Wallet Adapter → Kit Signer Bridge
// ============================================

/**
 * Create a kit-compatible TransactionSigner from a wallet adapter
 *
 * Note: This is a simplified adapter. The full kit signer interface
 * has more methods, but we only need the basics for SAS.
 */
export function createWalletAdapterSigner(
  wallet: WalletContextState
): TransactionSigner | null {
  if (!wallet.publicKey || !wallet.signTransaction) {
    return null;
  }

  const walletAddress = address(wallet.publicKey.toBase58());

  // Create a minimal TransactionSigner compatible object
  // Note: This is a simplified implementation
  return {
    address: walletAddress,
    // The kit signer interface expects specific methods
    // We'll handle signing at a higher level using wallet adapter
  } as unknown as TransactionSigner;
}

// ============================================
// PDA Derivation Functions
// ============================================

/**
 * Derive the APEYOLO credential PDA
 */
export async function deriveApeyoloCredentialPda(
  authorityAddress: Address
): Promise<[Address, number]> {
  const [pda, bump] = await deriveCredentialPda({
    authority: authorityAddress,
    name: APEYOLO_CREDENTIAL_NAME,
  });
  return [pda, bump];
}

/**
 * Derive the trading mandate schema PDA
 */
export async function deriveTradingMandateSchemaPda(
  credentialAddress: Address
): Promise<[Address, number]> {
  const [pda, bump] = await deriveSchemaPda({
    credential: credentialAddress,
    name: APEYOLO_SCHEMA_NAME,
    version: APEYOLO_SCHEMA_VERSION,
  });
  return [pda, bump];
}

/**
 * Derive an attestation PDA for a user wallet
 */
export async function deriveMandateAttestationPda(
  credentialAddress: Address,
  schemaAddress: Address,
  userWalletAddress: Address
): Promise<[Address, number]> {
  const [pda, bump] = await deriveAttestationPda({
    credential: credentialAddress,
    schema: schemaAddress,
    nonce: userWalletAddress, // User wallet as nonce ensures one attestation per user
  });
  return [pda, bump];
}

// ============================================
// Account Fetching Functions
// ============================================

/**
 * Fetch the APEYOLO credential account
 */
export async function fetchApeyoloCredential(
  rpc: ReturnType<typeof createSolanaRpc>,
  credentialAddress: Address
): Promise<Account<Credential> | null> {
  try {
    const maybeCredential = await fetchMaybeCredential(rpc, credentialAddress);
    if (!maybeCredential.exists) {
      return null;
    }
    return maybeCredential;
  } catch (error) {
    console.error('[SAS] Error fetching credential:', error);
    return null;
  }
}

/**
 * Fetch the trading mandate schema
 */
export async function fetchTradingMandateSchema(
  rpc: ReturnType<typeof createSolanaRpc>,
  schemaAddress: Address
): Promise<Account<Schema> | null> {
  try {
    const maybeSchema = await fetchMaybeSchema(rpc, schemaAddress);
    if (!maybeSchema.exists) {
      return null;
    }
    return maybeSchema;
  } catch (error) {
    console.error('[SAS] Error fetching schema:', error);
    return null;
  }
}

/**
 * Fetch an attestation for a user
 */
export async function fetchUserAttestation(
  rpc: ReturnType<typeof createSolanaRpc>,
  attestationAddress: Address
): Promise<Account<Attestation> | null> {
  try {
    const maybeAttestation = await fetchMaybeAttestation(rpc, attestationAddress);
    if (!maybeAttestation.exists) {
      return null;
    }
    return maybeAttestation;
  } catch (error) {
    // Account not found is expected for users without attestations
    return null;
  }
}

// ============================================
// Verification Functions
// ============================================

/**
 * Check if a user has a valid trading mandate attestation
 */
export async function verifyUserHasMandate(
  cluster: 'devnet' | 'mainnet-beta',
  credentialAddress: Address,
  schemaAddress: Address,
  userWalletAddress: Address
): Promise<{
  hasMandate: boolean;
  attestationAccount: Account<Attestation> | null;
  data: TradingMandateData | null;
}> {
  const rpc = createSasRpc(cluster);

  // Derive the attestation PDA for this user
  const [attestationPda] = await deriveMandateAttestationPda(
    credentialAddress,
    schemaAddress,
    userWalletAddress
  );

  // Try to fetch the attestation
  const attestationAccount = await fetchUserAttestation(rpc, attestationPda);

  if (!attestationAccount) {
    return { hasMandate: false, attestationAccount: null, data: null };
  }

  // Access the attestation data through the Account wrapper
  const attestation = attestationAccount.data;

  // Check if attestation is expired
  const now = BigInt(Date.now() / 1000);
  if (attestation.expiry !== BigInt(0) && attestation.expiry < now) {
    return { hasMandate: false, attestationAccount, data: null };
  }

  // Fetch schema to deserialize attestation data
  const schemaAccount = await fetchTradingMandateSchema(rpc, schemaAddress);
  if (!schemaAccount) {
    console.error('[SAS] Could not fetch schema for deserialization');
    return { hasMandate: true, attestationAccount, data: null };
  }

  // Deserialize the attestation data
  try {
    const data = deserializeAttestationData<TradingMandateData>(
      schemaAccount.data,
      new Uint8Array(attestation.data)
    );
    return { hasMandate: true, attestationAccount, data };
  } catch (error) {
    console.error('[SAS] Error deserializing attestation data:', error);
    return { hasMandate: true, attestationAccount, data: null };
  }
}

// ============================================
// Hash Computation
// ============================================

/**
 * Compute SHA256 hash of mandate data for on-chain storage
 */
export async function computeMandateHash(mandateJson: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(mandateJson);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ============================================
// Explorer URL Helper
// ============================================

/**
 * Get Solana Explorer URL for a transaction or address
 */
export function getSasExplorerUrl(
  value: string,
  type: 'tx' | 'address' = 'tx',
  cluster: 'devnet' | 'mainnet-beta' = 'devnet'
): string {
  const base = 'https://explorer.solana.com';
  const clusterParam = cluster === 'mainnet-beta' ? '' : `?cluster=${cluster}`;
  return `${base}/${type}/${value}${clusterParam}`;
}

// ============================================
// Status Check
// ============================================

/**
 * Check if SAS infrastructure is set up (credential and schema exist)
 */
export async function checkSasInfrastructure(
  cluster: 'devnet' | 'mainnet-beta',
  authorityAddress: Address
): Promise<{
  ready: boolean;
  credentialAddress: Address | null;
  schemaAddress: Address | null;
  error?: string;
}> {
  try {
    const rpc = createSasRpc(cluster);

    // Derive credential PDA
    const [credentialPda] = await deriveApeyoloCredentialPda(authorityAddress);

    // Check if credential exists
    const credential = await fetchApeyoloCredential(rpc, credentialPda);
    if (!credential) {
      return {
        ready: false,
        credentialAddress: null,
        schemaAddress: null,
        error: 'APEYOLO credential not yet created. Admin setup required.',
      };
    }

    // Derive schema PDA
    const [schemaPda] = await deriveTradingMandateSchemaPda(credentialPda);

    // Check if schema exists
    const schema = await fetchTradingMandateSchema(rpc, schemaPda);
    if (!schema) {
      return {
        ready: false,
        credentialAddress: credentialPda,
        schemaAddress: null,
        error: 'Trading mandate schema not yet created. Admin setup required.',
      };
    }

    return {
      ready: true,
      credentialAddress: credentialPda,
      schemaAddress: schemaPda,
    };
  } catch (error) {
    return {
      ready: false,
      credentialAddress: null,
      schemaAddress: null,
      error: `Error checking SAS infrastructure: ${error}`,
    };
  }
}

// ============================================
// Export Program Address
// ============================================

export { SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS };
