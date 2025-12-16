/**
 * Solana Wallet Provider
 *
 * Wraps the app with Solana wallet connection context.
 * Supports Phantom, Solflare, and other popular wallets.
 */

import { useMemo, ReactNode, createContext, useContext, useState, useEffect, useCallback } from 'react';
import { ConnectionProvider, WalletProvider as SolanaWalletProvider, useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { clusterApiUrl, Transaction, TransactionInstruction, PublicKey } from '@solana/web3.js';
import type { SolanaCluster, OnChainAttestation, ProfileSummary, AttestationData } from '@shared/types/defi';
import { DEFAULT_CLUSTER, computeProfileSummary, truncateAddress } from '@/lib/solana';

// Solana Memo Program ID
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

// Import wallet adapter styles
import '@solana/wallet-adapter-react-ui/styles.css';

// ============================================
// Extended Wallet Context
// ============================================

interface WalletContextValue {
  // Connection state
  connected: boolean;
  publicKey: string | null;
  cluster: SolanaCluster;
  setCluster: (cluster: SolanaCluster) => void;

  // Attestations
  attestations: OnChainAttestation[];
  profile: ProfileSummary;
  loading: boolean;
  refetchAttestations: () => Promise<void>;

  // Actions
  createAttestation: (data: AttestationData) => Promise<string>;

  // Helpers
  truncatedAddress: string | null;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function useWalletContext() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWalletContext must be used within WalletProvider');
  }
  return context;
}

// ============================================
// Inner Provider (has access to wallet hooks)
// ============================================

function WalletContextProvider({ children }: { children: ReactNode }) {
  const { publicKey, connected, signTransaction } = useWallet();
  const { connection } = useConnection();
  const [cluster, setCluster] = useState<SolanaCluster>(DEFAULT_CLUSTER);
  const [attestations, setAttestations] = useState<OnChainAttestation[]>([]);
  const [loading, setLoading] = useState(false);

  // Compute profile from attestations
  const profile = useMemo(() => computeProfileSummary(attestations), [attestations]);

  // Truncated address for display
  const truncatedAddress = publicKey ? truncateAddress(publicKey) : null;

  // Fetch attestations for connected wallet
  const refetchAttestations = useCallback(async () => {
    if (!publicKey || !connection) {
      setAttestations([]);
      return;
    }

    setLoading(true);
    try {
      // TODO: Implement getProgramAccounts query for attestations
      // For now, return empty array until program is deployed
      console.log('[WalletProvider] Fetching attestations for:', publicKey.toBase58());
      setAttestations([]);
    } catch (error) {
      console.error('[WalletProvider] Error fetching attestations:', error);
      setAttestations([]);
    } finally {
      setLoading(false);
    }
  }, [publicKey, connection]);

  // Refetch attestations when wallet connects
  useEffect(() => {
    if (connected && publicKey) {
      refetchAttestations();
    } else {
      setAttestations([]);
    }
  }, [connected, publicKey, refetchAttestations]);

  // Create attestation on-chain using Memo program
  const createAttestation = useCallback(async (data: AttestationData): Promise<string> => {
    if (!publicKey || !signTransaction || !connection) {
      throw new Error('Wallet not connected');
    }

    // Format memo data - compact but readable
    // Format: APEYOLO|period|hash|return|trades|violations
    const memoContent = [
      'APEYOLO',
      data.periodLabel.replace(/\s+/g, ''),
      data.detailsHash,
      `${data.returnPercent >= 0 ? '+' : ''}${data.returnPercent.toFixed(2)}%`,
      `${data.tradeCount}trades`,
      `${data.winCount}W/${data.lossCount}L`,
    ].join('|');

    console.log('[WalletProvider] Creating attestation memo:', memoContent);

    // Create memo instruction
    const memoInstruction = new TransactionInstruction({
      keys: [{ pubkey: publicKey, isSigner: true, isWritable: false }],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(memoContent, 'utf-8'),
    });

    // Build transaction
    const transaction = new Transaction().add(memoInstruction);

    // Get recent blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = publicKey;

    // Sign transaction with wallet
    const signedTransaction = await signTransaction(transaction);

    // Send and confirm
    const signature = await connection.sendRawTransaction(signedTransaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });

    // Wait for confirmation
    await connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    }, 'confirmed');

    console.log('[WalletProvider] Attestation created:', signature);

    // Refetch attestations after successful creation
    await refetchAttestations();

    return signature;
  }, [publicKey, signTransaction, connection, refetchAttestations]);

  const value: WalletContextValue = {
    connected,
    publicKey: publicKey?.toBase58() || null,
    cluster,
    setCluster,
    attestations,
    profile,
    loading,
    refetchAttestations,
    createAttestation,
    truncatedAddress,
  };

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
}

// ============================================
// Main Provider Component
// ============================================

interface WalletProviderProps {
  children: ReactNode;
}

export function WalletProvider({ children }: WalletProviderProps) {
  const [cluster, setCluster] = useState<SolanaCluster>(DEFAULT_CLUSTER);

  // Get endpoint for current cluster
  const endpoint = useMemo(() => clusterApiUrl(cluster), [cluster]);

  // Configure wallets
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
    ],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <SolanaWalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <WalletContextProvider>
            {children}
          </WalletContextProvider>
        </WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}

export default WalletProvider;
