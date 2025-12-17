/**
 * Solana Wallet Provider
 *
 * Wraps the app with Solana wallet connection context.
 * Supports Phantom, Solflare, and other popular wallets.
 *
 * Integrates with Solana Attestation Service (SAS) for on-chain
 * mandate verification.
 */

import { useMemo, ReactNode, createContext, useContext, useState, useEffect, useCallback } from 'react';
import { ConnectionProvider, WalletProvider as SolanaWalletProvider, useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { clusterApiUrl } from '@solana/web3.js';
import type { SolanaCluster, OnChainAttestation, ProfileSummary, AttestationData } from '@shared/types/defi';
import { DEFAULT_CLUSTER, computeProfileSummary, truncateAddress } from '@/lib/solana';
import {
  checkSasInfrastructure,
  verifyUserHasMandate,
  computeMandateHash,
  getSasExplorerUrl,
  publicKeyToAddress,
  stringToAddress,
  type TradingMandateData,
} from '@/lib/sas-client';
import type { Address } from '@solana/kit';

// Import wallet adapter styles
import '@solana/wallet-adapter-react-ui/styles.css';

// ============================================
// SAS Configuration
// ============================================

// APEYOLO Admin Authority Address (for credential/schema derivation)
// TODO: Replace with actual admin wallet address after deployment
const APEYOLO_AUTHORITY_ADDRESS = '11111111111111111111111111111111'; // Placeholder

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

  // SAS Integration
  sasReady: boolean;
  sasError: string | null;
  userHasMandate: boolean;
  mandateData: TradingMandateData | null;
  checkingSas: boolean;
  refreshMandateStatus: () => Promise<void>;
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

  // SAS State
  const [sasReady, setSasReady] = useState(false);
  const [sasError, setSasError] = useState<string | null>(null);
  const [checkingSas, setCheckingSas] = useState(false);
  const [userHasMandate, setUserHasMandate] = useState(false);
  const [mandateData, setMandateData] = useState<TradingMandateData | null>(null);
  const [credentialAddress, setCredentialAddress] = useState<Address | null>(null);
  const [schemaAddress, setSchemaAddress] = useState<Address | null>(null);

  // Compute profile from attestations
  const profile = useMemo(() => computeProfileSummary(attestations), [attestations]);

  // Truncated address for display
  const truncatedAddress = publicKey ? truncateAddress(publicKey) : null;

  // Check SAS infrastructure on mount and cluster change
  useEffect(() => {
    const checkInfrastructure = async () => {
      setCheckingSas(true);
      try {
        const sasCluster = cluster as 'devnet' | 'mainnet-beta';
        const authorityAddr = stringToAddress(APEYOLO_AUTHORITY_ADDRESS);
        const status = await checkSasInfrastructure(sasCluster, authorityAddr);

        setSasReady(status.ready);
        setSasError(status.error || null);
        setCredentialAddress(status.credentialAddress);
        setSchemaAddress(status.schemaAddress);

        if (!status.ready) {
          console.log('[WalletProvider] SAS infrastructure not ready:', status.error);
        }
      } catch (error) {
        console.error('[WalletProvider] Error checking SAS infrastructure:', error);
        setSasReady(false);
        setSasError('Failed to check SAS infrastructure');
      } finally {
        setCheckingSas(false);
      }
    };

    checkInfrastructure();
  }, [cluster]);

  // Check user's mandate status when wallet connects or SAS becomes ready
  const refreshMandateStatus = useCallback(async () => {
    if (!publicKey || !sasReady || !credentialAddress || !schemaAddress) {
      setUserHasMandate(false);
      setMandateData(null);
      return;
    }

    setCheckingSas(true);
    try {
      const sasCluster = cluster as 'devnet' | 'mainnet-beta';
      const userAddr = publicKeyToAddress(publicKey);
      const result = await verifyUserHasMandate(
        sasCluster,
        credentialAddress,
        schemaAddress,
        userAddr
      );

      setUserHasMandate(result.hasMandate);
      setMandateData(result.data);

      if (result.hasMandate) {
        console.log('[WalletProvider] User has valid mandate:', result.data);
      }
    } catch (error) {
      console.error('[WalletProvider] Error checking mandate status:', error);
      setUserHasMandate(false);
      setMandateData(null);
    } finally {
      setCheckingSas(false);
    }
  }, [publicKey, sasReady, credentialAddress, schemaAddress, cluster]);

  // Check mandate status when dependencies change
  useEffect(() => {
    if (connected && publicKey && sasReady) {
      refreshMandateStatus();
    } else {
      setUserHasMandate(false);
      setMandateData(null);
    }
  }, [connected, publicKey, sasReady, refreshMandateStatus]);

  // Fetch attestations for connected wallet (legacy)
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

  // Create attestation on-chain
  const createAttestation = useCallback(async (data: AttestationData): Promise<string> => {
    if (!publicKey || !signTransaction) {
      throw new Error('Wallet not connected');
    }

    if (!sasReady) {
      throw new Error('SAS infrastructure not ready. Admin setup required.');
    }

    // TODO: Implement SAS attestation creation
    // For now, throw an informative error
    throw new Error(
      'SAS attestation creation not yet implemented. ' +
      'The infrastructure check passed, but transaction building needs to be added.'
    );
  }, [publicKey, signTransaction, sasReady]);

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
    // SAS Integration
    sasReady,
    sasError,
    userHasMandate,
    mandateData,
    checkingSas,
    refreshMandateStatus,
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
