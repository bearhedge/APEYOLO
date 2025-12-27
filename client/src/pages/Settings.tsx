// @ts-nocheck - Solana SAS integration incomplete
import { useState, useEffect } from 'react';
import { RefreshCw, CheckCircle, XCircle, AlertCircle, Trash2, Key, Eye, EyeOff, Save, Building2, Wallet, Copy, Loader2, ExternalLink } from 'lucide-react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { Transaction, PublicKey } from '@solana/web3.js';
import { useWalletContext } from '@/components/WalletProvider';
import {
  getCreateCredentialInstruction,
  getCreateSchemaInstruction,
  deriveCredentialPda,
  deriveSchemaPda,
  SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS,
} from 'sas-lib';
import { address, type Address } from '@solana/kit';
import {
  APEYOLO_CREDENTIAL_NAME,
  APEYOLO_SCHEMA_NAME,
  APEYOLO_SCHEMA_VERSION,
  TRADING_MANDATE_SCHEMA_FIELDS,
  TRADING_MANDATE_SCHEMA_LAYOUT,
} from '@/lib/sas-client';
import { SectionHeader } from '@/components/SectionHeader';
import { LeftNav } from '@/components/LeftNav';
import { Button } from '@/components/ui/button';
import { StatusStep } from '@/components/ui/StatusStep';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface IbkrCredentialsStatus {
  configured: boolean;
  clientId?: string;
  clientKeyId?: string;
  credential?: string;
  accountId?: string | null;
  allowedIp?: string | null;
  environment?: string;
  status?: 'active' | 'inactive' | 'error';
  lastConnectedAt?: string | null;
  errorMessage?: string | null;
  message?: string;
}

export function Settings() {
  const [testResult, setTestResult] = useState<any>(null);
  const [orderResult, setOrderResult] = useState<any>(null);
  const [clearResult, setClearResult] = useState<any>(null);

  // IBKR Credentials Form State
  const [showCredentialsForm, setShowCredentialsForm] = useState(false);
  const [credClientId, setCredClientId] = useState('');
  const [credClientKeyId, setCredClientKeyId] = useState('');
  const [credPrivateKey, setCredPrivateKey] = useState('');
  const [credUsername, setCredUsername] = useState('');
  const [credAccountId, setCredAccountId] = useState('');
  const [credAllowedIp, setCredAllowedIp] = useState('');
  const [credEnvironment, setCredEnvironment] = useState<'paper' | 'live'>('paper');
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [credSaveResult, setCredSaveResult] = useState<any>(null);
  const [credTestResult, setCredTestResult] = useState<any>(null);

  // Solana wallet and SAS setup state
  const { connected: solanaConnected, publicKey: solanaPublicKey, signTransaction, disconnect: disconnectSolana } = useWallet();
  const { connection: solanaConnection } = useConnection();
  const { cluster, sasReady } = useWalletContext();
  const [sasLoading, setSasLoading] = useState(false);
  const [sasError, setSasError] = useState<string | null>(null);
  const [sasCredentialAddress, setSasCredentialAddress] = useState<string | null>(null);
  const [sasSchemaAddress, setSasSchemaAddress] = useState<string | null>(null);
  const [sasCredentialTx, setSasCredentialTx] = useState<string | null>(null);
  const [sasSchemaTx, setSasSchemaTx] = useState<string | null>(null);
  const [sasCopied, setSasCopied] = useState<string | null>(null);
  const [solBalance, setSolBalance] = useState<number | null>(null);

  const isDevnet = cluster === 'devnet';

  // Fetch SOL balance when wallet connected
  useEffect(() => {
    if (solanaConnected && solanaPublicKey && solanaConnection) {
      solanaConnection.getBalance(solanaPublicKey).then(balance => {
        setSolBalance(balance / 1e9);
      }).catch(() => setSolBalance(null));
    } else {
      setSolBalance(null);
    }
  }, [solanaConnected, solanaPublicKey, solanaConnection]);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setSasCopied(label);
    setTimeout(() => setSasCopied(null), 2000);
  };

  const handleCreateCredential = async () => {
    if (!solanaPublicKey || !signTransaction) {
      setSasError('Wallet not connected');
      return;
    }

    setSasLoading(true);
    setSasError(null);

    try {
      const authorityAddress = address(solanaPublicKey.toBase58());

      // Derive credential PDA
      const [credentialPda] = await deriveCredentialPda({
        authority: authorityAddress,
        name: APEYOLO_CREDENTIAL_NAME,
      });

      // Get the instruction (cast to any to bypass sas-lib type mismatch)
      const instruction = getCreateCredentialInstruction({
        authority: authorityAddress as any,
        name: APEYOLO_CREDENTIAL_NAME,
      });

      // Convert kit instruction to web3.js format
      const tx = new Transaction();
      tx.add({
        keys: instruction.accounts.map((acc: any) => ({
          pubkey: new PublicKey(acc.address),
          isSigner: acc.role === 2 || acc.role === 3,
          isWritable: acc.role === 1 || acc.role === 3,
        })),
        programId: new PublicKey(SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS),
        data: Buffer.from(instruction.data),
      });

      const { blockhash, lastValidBlockHeight } = await solanaConnection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = solanaPublicKey;

      const signedTx = await signTransaction(tx);
      const signature = await solanaConnection.sendRawTransaction(signedTx.serialize());

      await solanaConnection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      });

      setSasCredentialAddress(credentialPda);
      setSasCredentialTx(signature);
    } catch (err: any) {
      if (err.message?.includes('already in use')) {
        setSasError('Credential already exists! Proceed to create schema.');
        const authorityAddress = address(solanaPublicKey.toBase58());
        const [credentialPda] = await deriveCredentialPda({
          authority: authorityAddress,
          name: APEYOLO_CREDENTIAL_NAME,
        });
        setSasCredentialAddress(credentialPda);
        setSasCredentialTx('already-exists');
      } else {
        setSasError(err.message || 'Failed to create credential');
      }
    } finally {
      setSasLoading(false);
    }
  };

  const handleCreateSchema = async () => {
    if (!solanaPublicKey || !signTransaction || !sasCredentialAddress) {
      setSasError('Credential not created yet');
      return;
    }

    setSasLoading(true);
    setSasError(null);

    try {
      const authorityAddress = address(solanaPublicKey.toBase58());
      const credentialAddress = sasCredentialAddress as Address;

      const [schemaPda] = await deriveSchemaPda({
        credential: credentialAddress,
        name: APEYOLO_SCHEMA_NAME,
        version: APEYOLO_SCHEMA_VERSION,
      });

      const instruction = getCreateSchemaInstruction({
        authority: authorityAddress as any,
        credential: credentialAddress,
        name: APEYOLO_SCHEMA_NAME,
        version: APEYOLO_SCHEMA_VERSION,
        fieldNames: TRADING_MANDATE_SCHEMA_FIELDS,
        fieldLayout: TRADING_MANDATE_SCHEMA_LAYOUT,
      });

      const tx = new Transaction();
      tx.add({
        keys: instruction.accounts.map((acc: any) => ({
          pubkey: new PublicKey(acc.address),
          isSigner: acc.role === 2 || acc.role === 3,
          isWritable: acc.role === 1 || acc.role === 3,
        })),
        programId: new PublicKey(SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS),
        data: Buffer.from(instruction.data),
      });

      const { blockhash, lastValidBlockHeight } = await solanaConnection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = solanaPublicKey;

      const signedTx = await signTransaction(tx);
      const signature = await solanaConnection.sendRawTransaction(signedTx.serialize());

      await solanaConnection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      });

      setSasSchemaAddress(schemaPda);
      setSasSchemaTx(signature);
    } catch (err: any) {
      if (err.message?.includes('already in use')) {
        setSasError('Schema already exists! Setup complete.');
        const credentialAddress = sasCredentialAddress as Address;
        const [schemaPda] = await deriveSchemaPda({
          credential: credentialAddress,
          name: APEYOLO_SCHEMA_NAME,
          version: APEYOLO_SCHEMA_VERSION,
        });
        setSasSchemaAddress(schemaPda);
        setSasSchemaTx('already-exists');
      } else {
        setSasError(err.message || 'Failed to create schema');
      }
    } finally {
      setSasLoading(false);
    }
  };

  const getExplorerUrl = (signature: string) => {
    if (signature === 'already-exists') return null;
    return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
  };

  // Get queryClient to invalidate NAV header caches when connection status changes
  const queryClient = useQueryClient();

  // Fetch IBKR status with adaptive polling
  const { data: ibkrStatus, refetch: refetchStatus } = useQuery({
    queryKey: ['/api/ibkr/status'],
    queryFn: async () => {
      const response = await fetch('/api/ibkr/status');
      return response.json();
    },
    refetchInterval: (query) => {
      // Adaptive polling based on connection state
      const data = query.state.data as { configured?: boolean; connected?: boolean } | undefined;
      if (!data?.configured) return false; // Don't poll if not configured
      if (data?.configured && !data?.connected) return 3000; // 3s when connecting
      return 30000; // 30s when stable
    },
    refetchOnWindowFocus: true,
    refetchOnMount: true,
  });

  // Helper to refresh all IBKR-related caches for instant UI sync across all components
  const refreshAllIbkrStatus = () => {
    refetchStatus();
    // Force immediate refetch (not just invalidate) for instant NAV header update
    queryClient.refetchQueries({ queryKey: ['/api/broker/diag'] });
    queryClient.refetchQueries({ queryKey: ['/api/account'] });
  };

  // Test connection mutation
  const testConnectionMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/ibkr/test', { method: 'POST' });
      const data = await response.json();
      setTestResult(data);
      return data;
    },
    onSuccess: () => {
      // Trigger immediate refetch after test - updates all components
      refreshAllIbkrStatus();
    },
  });

  const reconnectMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/broker/oauth', { method: 'POST' });
      return response.json();
    },
    onSuccess: () => {
      // Trigger immediate refetch after reconnect - updates all components
      refreshAllIbkrStatus();
    },
  });

  // Warm endpoint (runs full readiness flow server-side)
  const warmMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/broker/warm');
      return response.json();
    },
    onSuccess: () => refreshAllIbkrStatus(),
  });

  // Aggressive auto-reconnect: continuously retry with backoff until connected
  const [backoffMs, setBackoffMs] = useState<number>(3000);
  const [isAutoConnecting, setIsAutoConnecting] = useState<boolean>(false);
  const [retryCount, setRetryCount] = useState<number>(0);

  // Auto-reconnect effect with interval-based retry
  useEffect(() => {
    // Skip if not configured or already connected
    if (!ibkrStatus?.configured || ibkrStatus?.connected) {
      if (ibkrStatus?.connected && retryCount > 0) {
        // Reset on successful connection
        setBackoffMs(3000);
        setRetryCount(0);
        setIsAutoConnecting(false);
      }
      return;
    }

    // Skip if already attempting
    if (isAutoConnecting || warmMutation.isPending || reconnectMutation.isPending) {
      return;
    }

    // Set up interval for auto-reconnect attempts
    const attemptReconnect = () => {
      setIsAutoConnecting(true);
      setRetryCount((c) => c + 1);

      // Try warm first; if not ok, fall back to reconnect
      warmMutation.mutate(undefined, {
        onSuccess: (d: any) => {
          if (!d?.ok) {
            reconnectMutation.mutate(undefined, {
              onSettled: () => {
                // Increase backoff on failure, max 30s
                setBackoffMs((ms) => Math.min(30000, ms * 1.5));
                setIsAutoConnecting(false);
                refreshAllIbkrStatus();
              },
            });
          } else {
            // Success - reset backoff
            setBackoffMs(3000);
            setRetryCount(0);
            setIsAutoConnecting(false);
            refreshAllIbkrStatus();
          }
        },
        onError: () => {
          reconnectMutation.mutate(undefined, {
            onSettled: () => {
              setBackoffMs((ms) => Math.min(30000, ms * 1.5));
              setIsAutoConnecting(false);
              refreshAllIbkrStatus();
            },
          });
        },
      });
    };

    // Immediate attempt on first detection of disconnected state
    if (retryCount === 0) {
      attemptReconnect();
      return;
    }

    // Set up interval for subsequent attempts
    const intervalId = setInterval(attemptReconnect, backoffMs);
    return () => clearInterval(intervalId);
  }, [ibkrStatus?.configured, ibkrStatus?.connected, isAutoConnecting, backoffMs, retryCount, warmMutation.isPending, reconnectMutation.isPending]);

  // Test order mutation
  const testOrderMutation = useMutation({
    mutationFn: async () => {
      // Use random quantity (1-5) to avoid duplicate order rejection
      const randomQty = Math.floor(Math.random() * 5) + 1;
      const response = await fetch('/api/broker/paper/order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          symbol: 'SPY',
          side: 'BUY',
          quantity: randomQty,
          orderType: 'MKT',
          tif: 'DAY',
        }),
      });
      const data = await response.json();
      setOrderResult(data);
      return data;
    },
  });

  // Clear all open orders mutation
  const clearOrdersMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/ibkr/clear-orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      const data = await response.json();
      setClearResult(data);
      return data;
    },
  });

  // ==================== USER IBKR CREDENTIALS ====================

  // Fetch user's IBKR credentials status
  const { data: userCredentials, refetch: refetchCredentials } = useQuery<IbkrCredentialsStatus>({
    queryKey: ['/api/settings/ibkr'],
    queryFn: async () => {
      const response = await fetch('/api/settings/ibkr');
      return response.json();
    },
  });

  // Save credentials mutation
  const saveCredentialsMutation = useMutation({
    mutationFn: async (credentials: {
      clientId: string;
      clientKeyId: string;
      privateKey: string;
      credential: string;
      accountId?: string;
      allowedIp?: string;
      environment: 'paper' | 'live';
    }) => {
      const response = await fetch('/api/settings/ibkr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      });
      const data = await response.json();
      setCredSaveResult(data);
      return data;
    },
    onSuccess: (data) => {
      if (data.success) {
        refetchCredentials();
        setShowCredentialsForm(false);
        // Clear form
        setCredPrivateKey('');
      }
    },
  });

  // Test credentials mutation
  const testCredentialsMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/settings/ibkr/test', {
        method: 'POST',
      });
      const data = await response.json();
      setCredTestResult(data);
      return data;
    },
    onSuccess: () => {
      refetchCredentials();
      refreshAllIbkrStatus();
    },
  });

  // Delete credentials mutation
  const deleteCredentialsMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/settings/ibkr', {
        method: 'DELETE',
      });
      return response.json();
    },
    onSuccess: () => {
      refetchCredentials();
      refreshAllIbkrStatus();
      // Clear form state
      setCredClientId('');
      setCredClientKeyId('');
      setCredPrivateKey('');
      setCredUsername('');
      setCredAccountId('');
      setCredAllowedIp('');
      setCredEnvironment('paper');
      setCredSaveResult(null);
      setCredTestResult(null);
    },
  });

  const handleSaveCredentials = () => {
    if (!credClientId || !credClientKeyId || !credPrivateKey || !credUsername) {
      setCredSaveResult({
        success: false,
        error: 'Please fill in all required fields (Client ID, Client Key ID, Private Key, Username)',
      });
      return;
    }

    saveCredentialsMutation.mutate({
      clientId: credClientId,
      clientKeyId: credClientKeyId,
      privateKey: credPrivateKey,
      credential: credUsername,
      accountId: credAccountId || undefined,
      allowedIp: credAllowedIp || undefined,
      environment: credEnvironment,
    });
  };

  const getCredentialStatusColor = () => {
    if (!userCredentials?.configured) return 'text-yellow-500';
    if (userCredentials?.status === 'active') return 'text-green-500';
    if (userCredentials?.status === 'error') return 'text-red-500';
    return 'text-yellow-500';
  };

  const getCredentialStatusText = () => {
    if (!userCredentials?.configured) return 'Not Configured';
    if (userCredentials?.status === 'active') return 'Active';
    if (userCredentials?.status === 'error') return 'Error';
    return 'Inactive';
  };

  const getConnectionIcon = () => {
    if (!ibkrStatus?.configured) return <AlertCircle className="w-5 h-5 text-yellow-500" />;
    if (ibkrStatus?.connected) return <CheckCircle className="w-5 h-5 text-green-500" />;
    if (isAutoConnecting || warmMutation.isPending || reconnectMutation.isPending) {
      return <RefreshCw className="w-5 h-5 text-blue-500 animate-spin" />;
    }
    return <XCircle className="w-5 h-5 text-red-500" />;
  };

  const getConnectionStatus = () => {
    if (!ibkrStatus?.configured) return 'Not Configured';
    if (ibkrStatus?.connected) return 'Connected';
    if (isAutoConnecting || warmMutation.isPending || reconnectMutation.isPending) {
      return 'Connecting...';
    }
    return 'Disconnected';
  };

  const getConnectionStatusColor = () => {
    if (ibkrStatus?.connected) return 'text-green-500';
    if (isAutoConnecting || warmMutation.isPending || reconnectMutation.isPending) return 'text-blue-500';
    if (ibkrStatus?.configured) return 'text-red-500';
    return 'text-yellow-500';
  };

  return (
    <div className="flex h-[calc(100vh-64px)]">
      <LeftNav />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <SectionHeader
          title="Settings"
          subtitle="Configure your brokerage connection"
          testId="header-settings"
        />

        {/* Centered content container */}
        <div className="max-w-3xl mx-auto">
          {/* Unified IBKR Brokerage Card */}
          <div className="bg-charcoal rounded-2xl border border-white/10 shadow-lg overflow-hidden">
            {/* Card Header */}
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <div className="flex items-center gap-3">
                <Building2 className="w-6 h-6" />
                <h3 className="text-xl font-semibold">IBKR Brokerage</h3>
              </div>
              <div className="flex items-center gap-2">
                {getConnectionIcon()}
                <span className={`text-sm font-medium ${getConnectionStatusColor()}`}>
                  {getConnectionStatus()}
                </span>
              </div>
            </div>

            {/* CONNECTION Section */}
            <div className="p-6 border-b border-white/10">
              <h4 className="text-sm font-medium text-silver uppercase tracking-wider mb-4">Connection</h4>

              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="p-3 bg-dark-gray rounded-lg">
                  <p className="text-xs text-silver mb-1">Environment</p>
                  <p className={`text-sm font-medium ${ibkrStatus?.environment === 'live' ? 'text-red-400' : 'text-blue-400'}`}>
                    {ibkrStatus?.environment?.toUpperCase() || 'PAPER'}
                  </p>
                </div>
                <div className="p-3 bg-dark-gray rounded-lg">
                  <p className="text-xs text-silver mb-1">Account ID</p>
                  <p className="text-sm font-mono">{ibkrStatus?.accountId || '—'}</p>
                </div>
                <div className="p-3 bg-dark-gray rounded-lg">
                  <p className="text-xs text-silver mb-1">Multi-User</p>
                  <p className="text-sm">{ibkrStatus?.multiUserMode ? 'Enabled' : 'Disabled'}</p>
                </div>
              </div>

              {/* Auth Pipeline - Compact Inline */}
              {ibkrStatus?.configured && ibkrStatus.diagnostics && (
                <div className="p-3 bg-dark-gray rounded-lg">
                  <p className="text-xs text-silver mb-2">Auth Pipeline</p>
                  <div className="flex items-center gap-4 flex-wrap">
                    <StatusStep
                      name="OAuth"
                      status={ibkrStatus.diagnostics.oauth?.status || 0}
                      message={ibkrStatus.diagnostics.oauth?.message || 'Not attempted'}
                      success={ibkrStatus.diagnostics.oauth?.success}
                      compact
                    />
                    <StatusStep
                      name="SSO"
                      status={ibkrStatus.diagnostics.sso?.status || 0}
                      message={ibkrStatus.diagnostics.sso?.message || 'Not attempted'}
                      success={ibkrStatus.diagnostics.sso?.success}
                      compact
                    />
                    <StatusStep
                      name="Validate"
                      status={ibkrStatus.diagnostics.validate?.status || ibkrStatus.diagnostics.validated?.status || 0}
                      message={ibkrStatus.diagnostics.validate?.message || ibkrStatus.diagnostics.validated?.message || 'Not attempted'}
                      success={ibkrStatus.diagnostics.validate?.success || ibkrStatus.diagnostics.validated?.success}
                      compact
                    />
                    <StatusStep
                      name="Init"
                      status={ibkrStatus.diagnostics.init?.status || ibkrStatus.diagnostics.initialized?.status || 0}
                      message={ibkrStatus.diagnostics.init?.message || ibkrStatus.diagnostics.initialized?.message || 'Not attempted'}
                      success={ibkrStatus.diagnostics.init?.success || ibkrStatus.diagnostics.initialized?.success}
                      compact
                    />
                  </div>
                </div>
              )}

              {/* Test/Order Results */}
              {testResult && (
                <div className={`mt-4 p-3 rounded-lg border ${
                  testResult.success ? 'bg-green-900/20 border-green-500/30' : 'bg-red-900/20 border-red-500/30'
                }`}>
                  <p className={`text-sm font-medium ${testResult.success ? 'text-green-400' : 'text-red-400'}`}>
                    Connection Test: {testResult.message}
                  </p>
                </div>
              )}

              {orderResult && (
                <div className={`mt-4 p-3 rounded-lg border ${
                  orderResult.success ? 'bg-green-900/20 border-green-500/30' : 'bg-red-900/20 border-red-500/30'
                }`}>
                  <p className={`text-sm font-medium ${orderResult.success ? 'text-green-400' : 'text-red-400'}`}>
                    Test Order: {orderResult.message || (orderResult.success ? 'Order Submitted' : 'Order Failed')}
                  </p>
                  {orderResult.orderId && (
                    <p className="text-xs text-silver mt-1">Order ID: {orderResult.orderId}</p>
                  )}
                </div>
              )}

              {clearResult && (
                <div className={`mt-4 p-3 rounded-lg border ${
                  clearResult.success ? 'bg-green-900/20 border-green-500/30' : 'bg-red-900/20 border-red-500/30'
                }`}>
                  <p className={`text-sm font-medium ${clearResult.success ? 'text-green-400' : 'text-red-400'}`}>
                    {clearResult.message || 'Clear Orders Result'}
                  </p>
                  {clearResult.cleared > 0 && (
                    <p className="text-xs text-silver mt-1">Cleared {clearResult.cleared} order(s)</p>
                  )}
                </div>
              )}
            </div>

            {/* CREDENTIALS Section */}
            <div className="p-6 border-b border-white/10">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-sm font-medium text-silver uppercase tracking-wider">Credentials</h4>
                <span className={`text-sm font-medium ${getCredentialStatusColor()}`}>
                  {getCredentialStatusText()}
                </span>
              </div>

              {/* Current Credentials Display */}
              {userCredentials?.configured && !showCredentialsForm && (
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="p-3 bg-dark-gray rounded-lg">
                    <p className="text-xs text-silver mb-1">Client ID</p>
                    <p className="text-sm font-mono truncate">{userCredentials.clientId}</p>
                  </div>
                  <div className="p-3 bg-dark-gray rounded-lg">
                    <p className="text-xs text-silver mb-1">Username</p>
                    <p className="text-sm font-mono">{userCredentials.credential}</p>
                  </div>
                  <div className="p-3 bg-dark-gray rounded-lg">
                    <p className="text-xs text-silver mb-1">Last Connected</p>
                    <p className="text-sm">
                      {userCredentials.lastConnectedAt
                        ? new Date(userCredentials.lastConnectedAt).toLocaleDateString()
                        : '—'}
                    </p>
                  </div>
                </div>
              )}

              {/* Error Message */}
              {userCredentials?.errorMessage && !showCredentialsForm && (
                <div className="p-3 bg-red-900/20 border border-red-500/30 rounded-lg mb-4">
                  <p className="text-sm text-red-400">{userCredentials.errorMessage}</p>
                </div>
              )}

              {/* Credentials Test Result */}
              {credTestResult && !showCredentialsForm && (
                <div className={`p-3 rounded-lg border mb-4 ${
                  credTestResult.success ? 'bg-green-900/20 border-green-500/30' : 'bg-red-900/20 border-red-500/30'
                }`}>
                  <p className={`text-sm font-medium ${credTestResult.success ? 'text-green-400' : 'text-red-400'}`}>
                    {credTestResult.message}
                  </p>
                  {credTestResult.account && (
                    <p className="text-xs text-silver mt-1">
                      Account: {credTestResult.account.accountId} | NAV: ${credTestResult.account.netValue?.toLocaleString()}
                    </p>
                  )}
                </div>
              )}

              {/* Credentials Form */}
              {showCredentialsForm && (
                <div className="space-y-4">
                  <p className="text-sm text-silver">
                    Enter your IBKR OAuth credentials from the API Gateway. These will be encrypted and stored securely.
                  </p>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="cred-client-id">Client ID *</Label>
                      <Input
                        id="cred-client-id"
                        value={credClientId}
                        onChange={(e) => setCredClientId(e.target.value)}
                        placeholder="Your IBKR Client ID"
                        className="input-monochrome mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="cred-client-key-id">Client Key ID *</Label>
                      <Input
                        id="cred-client-key-id"
                        value={credClientKeyId}
                        onChange={(e) => setCredClientKeyId(e.target.value)}
                        placeholder="e.g., main"
                        className="input-monochrome mt-1"
                      />
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="cred-username">IBKR Username *</Label>
                    <Input
                      id="cred-username"
                      value={credUsername}
                      onChange={(e) => setCredUsername(e.target.value)}
                      placeholder="Your IBKR login username"
                      className="input-monochrome mt-1"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="cred-private-key">Private Key (PEM) *</Label>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowPrivateKey(!showPrivateKey)}
                        className="text-xs text-silver hover:text-white"
                      >
                        {showPrivateKey ? <EyeOff className="w-3 h-3 mr-1" /> : <Eye className="w-3 h-3 mr-1" />}
                        {showPrivateKey ? 'Hide' : 'Show'}
                      </Button>
                    </div>
                    <Textarea
                      id="cred-private-key"
                      value={credPrivateKey}
                      onChange={(e) => setCredPrivateKey(e.target.value)}
                      placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
                      className={`input-monochrome mt-1 min-h-32 font-mono text-xs ${!showPrivateKey ? 'blur-sm hover:blur-none focus:blur-none' : ''}`}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="cred-account-id">Account ID (optional)</Label>
                      <Input
                        id="cred-account-id"
                        value={credAccountId}
                        onChange={(e) => setCredAccountId(e.target.value)}
                        placeholder="U1234567"
                        className="input-monochrome mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="cred-environment">Environment</Label>
                      <Select value={credEnvironment} onValueChange={(v) => setCredEnvironment(v as 'paper' | 'live')}>
                        <SelectTrigger className="input-monochrome mt-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-charcoal border-white/10">
                          <SelectItem value="paper">Paper Trading</SelectItem>
                          <SelectItem value="live">Live Trading</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="cred-allowed-ip">Allowed IP (optional)</Label>
                    <Input
                      id="cred-allowed-ip"
                      value={credAllowedIp}
                      onChange={(e) => setCredAllowedIp(e.target.value)}
                      placeholder="Your server's static IP"
                      className="input-monochrome mt-1"
                    />
                  </div>

                  {/* Save Result */}
                  {credSaveResult && (
                    <div className={`p-3 rounded-lg border ${
                      credSaveResult.success ? 'bg-green-900/20 border-green-500/30' : 'bg-red-900/20 border-red-500/30'
                    }`}>
                      <p className={`text-sm ${credSaveResult.success ? 'text-green-400' : 'text-red-400'}`}>
                        {credSaveResult.message || credSaveResult.error}
                      </p>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button
                      onClick={handleSaveCredentials}
                      className="btn-primary flex-1"
                      disabled={saveCredentialsMutation.isPending}
                    >
                      <Save className="w-4 h-4 mr-2" />
                      {saveCredentialsMutation.isPending ? 'Saving...' : 'Save Credentials'}
                    </Button>
                    <Button
                      onClick={() => {
                        setShowCredentialsForm(false);
                        setCredSaveResult(null);
                      }}
                      className="btn-secondary"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {/* Credentials Actions */}
              {!showCredentialsForm && (
                <div className="flex gap-2">
                  {!userCredentials?.configured ? (
                    <Button
                      onClick={() => setShowCredentialsForm(true)}
                      className="btn-primary flex-1"
                    >
                      <Key className="w-4 h-4 mr-2" />
                      Add IBKR Credentials
                    </Button>
                  ) : (
                    <>
                      <Button
                        onClick={() => setShowCredentialsForm(true)}
                        className="btn-secondary flex-1"
                      >
                        Update Credentials
                      </Button>
                      <Button
                        onClick={() => {
                          if (window.confirm('Are you sure you want to delete your IBKR credentials?')) {
                            deleteCredentialsMutation.mutate();
                          }
                        }}
                        className="btn-secondary text-red-400 hover:text-red-300"
                        disabled={deleteCredentialsMutation.isPending}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* ACTIONS Section */}
            <div className="p-6 bg-dark-gray/50">
              {!ibkrStatus?.configured && (
                <div className="p-3 bg-yellow-900/20 border border-yellow-500/30 rounded-lg mb-4">
                  <p className="text-sm text-yellow-400">
                    IBKR credentials not configured. Add your credentials above to connect.
                  </p>
                </div>
              )}

              <div className="flex gap-3 flex-wrap">
                <Button
                  onClick={() => testCredentialsMutation.mutate()}
                  className="btn-primary"
                  disabled={testCredentialsMutation.isPending || !userCredentials?.configured}
                  data-testid="button-test-connection"
                >
                  {testCredentialsMutation.isPending ? 'Testing...' : 'Test Connection'}
                </Button>

                {ibkrStatus?.configured && !ibkrStatus?.connected && (
                  <Button
                    onClick={() => {
                      setRetryCount(0);
                      setBackoffMs(3000);
                      reconnectMutation.mutate();
                    }}
                    className="btn-secondary"
                    disabled={reconnectMutation.isPending || warmMutation.isPending}
                    data-testid="button-reconnect"
                  >
                    <RefreshCw className={`w-4 h-4 mr-2 ${(reconnectMutation.isPending || warmMutation.isPending) ? 'animate-spin' : ''}`} />
                    {reconnectMutation.isPending || warmMutation.isPending ? 'Reconnecting...' : 'Force Reconnect'}
                  </Button>
                )}

                {ibkrStatus?.connected && (
                  <>
                    <Button
                      onClick={() => testOrderMutation.mutate()}
                      className="btn-secondary"
                      disabled={testOrderMutation.isPending}
                      data-testid="button-test-order"
                    >
                      {testOrderMutation.isPending ? 'Placing...' : 'Test Order (Buy SPY)'}
                    </Button>

                    <Button
                      onClick={() => clearOrdersMutation.mutate()}
                      className="btn-secondary"
                      disabled={clearOrdersMutation.isPending}
                      data-testid="button-clear-orders"
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      {clearOrdersMutation.isPending ? 'Clearing...' : 'Clear Orders'}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Solana On-Chain Card */}
          <div className="bg-charcoal rounded-2xl border border-white/10 shadow-lg overflow-hidden mt-6">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <div className="flex items-center gap-3">
                <Wallet className="w-6 h-6" />
                <h3 className="text-xl font-semibold">Solana</h3>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-1 text-xs rounded-full ${
                  isDevnet ? 'bg-yellow-500/20 text-yellow-400' : 'bg-green-500/20 text-green-400'
                }`}>
                  {isDevnet ? 'Devnet' : 'Mainnet'}
                </span>
                {solanaConnected ? (
                  <CheckCircle className="w-5 h-5 text-green-500" />
                ) : (
                  <XCircle className="w-5 h-5 text-zinc-500" />
                )}
              </div>
            </div>

            {/* Wallet Section */}
            <div className="p-6 border-b border-white/10">
              <h4 className="text-sm font-medium text-silver uppercase tracking-wider mb-4">Wallet</h4>

              {solanaConnected && solanaPublicKey ? (
                <>
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div className="p-3 bg-dark-gray rounded-lg">
                      <p className="text-xs text-silver mb-1">Address</p>
                      <p className="text-sm font-mono truncate">{solanaPublicKey.toBase58().slice(0, 8)}...{solanaPublicKey.toBase58().slice(-6)}</p>
                    </div>
                    <div className="p-3 bg-dark-gray rounded-lg">
                      <p className="text-xs text-silver mb-1">Network</p>
                      <p className={`text-sm ${isDevnet ? 'text-yellow-400' : 'text-green-400'}`}>{isDevnet ? 'Devnet' : 'Mainnet'}</p>
                    </div>
                    <div className="p-3 bg-dark-gray rounded-lg">
                      <p className="text-xs text-silver mb-1">Balance</p>
                      <p className="text-sm tabular-nums">{solBalance !== null ? `${solBalance.toFixed(4)} SOL` : '—'}</p>
                    </div>
                  </div>
                  <Button onClick={disconnectSolana} className="btn-secondary">
                    Disconnect Wallet
                  </Button>
                </>
              ) : (
                <WalletMultiButton className="!bg-electric !text-black hover:!bg-electric/90 !rounded-lg !h-10 !px-6 !font-medium" />
              )}
            </div>

            {/* SAS Setup Section - Only show when connected */}
            {solanaConnected && (
              <div className="p-6 border-b border-white/10">
                <h4 className="text-sm font-medium text-silver uppercase tracking-wider mb-4">Attestation Service Setup</h4>

                {/* Step indicators */}
                <div className="space-y-3 mb-4">
                  <div className="flex items-center justify-between p-3 bg-dark-gray rounded-lg">
                    <div className="flex items-center gap-3">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                        sasCredentialAddress ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-silver'
                      }`}>
                        {sasCredentialAddress ? <CheckCircle className="w-4 h-4" /> : '1'}
                      </span>
                      <span>Credential</span>
                    </div>
                    {sasCredentialAddress ? (
                      <div className="flex items-center gap-2">
                        <code className="text-xs text-silver bg-black/50 px-2 py-1 rounded truncate max-w-[200px]">
                          {sasCredentialAddress.slice(0, 8)}...
                        </code>
                        <button
                          onClick={() => copyToClipboard(sasCredentialAddress, 'credential')}
                          className="p-1 hover:bg-white/10 rounded"
                        >
                          <Copy className="w-3 h-3 text-silver" />
                        </button>
                        {sasCredentialTx && getExplorerUrl(sasCredentialTx) && (
                          <a href={getExplorerUrl(sasCredentialTx)!} target="_blank" rel="noopener noreferrer" className="p-1 hover:bg-white/10 rounded">
                            <ExternalLink className="w-3 h-3 text-electric" />
                          </a>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-silver">Not created</span>
                    )}
                  </div>

                  <div className="flex items-center justify-between p-3 bg-dark-gray rounded-lg">
                    <div className="flex items-center gap-3">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                        sasSchemaAddress ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-silver'
                      }`}>
                        {sasSchemaAddress ? <CheckCircle className="w-4 h-4" /> : '2'}
                      </span>
                      <span>Schema</span>
                    </div>
                    {sasSchemaAddress ? (
                      <div className="flex items-center gap-2">
                        <code className="text-xs text-silver bg-black/50 px-2 py-1 rounded truncate max-w-[200px]">
                          {sasSchemaAddress.slice(0, 8)}...
                        </code>
                        <button
                          onClick={() => copyToClipboard(sasSchemaAddress, 'schema')}
                          className="p-1 hover:bg-white/10 rounded"
                        >
                          <Copy className="w-3 h-3 text-silver" />
                        </button>
                        {sasSchemaTx && getExplorerUrl(sasSchemaTx) && (
                          <a href={getExplorerUrl(sasSchemaTx)!} target="_blank" rel="noopener noreferrer" className="p-1 hover:bg-white/10 rounded">
                            <ExternalLink className="w-3 h-3 text-electric" />
                          </a>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-silver">Not created</span>
                    )}
                  </div>
                </div>

                {/* Error display */}
                {sasError && (
                  <div className="p-3 bg-red-900/20 border border-red-500/30 rounded-lg mb-4">
                    <p className="text-sm text-red-400">{sasError}</p>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex gap-3">
                  <Button
                    onClick={handleCreateCredential}
                    disabled={!!sasCredentialAddress || sasLoading}
                    className="btn-primary"
                  >
                    {sasLoading && !sasCredentialAddress ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Creating...
                      </>
                    ) : sasCredentialAddress ? (
                      'Credential Created'
                    ) : (
                      'Create Credential'
                    )}
                  </Button>
                  <Button
                    onClick={handleCreateSchema}
                    disabled={!sasCredentialAddress || !!sasSchemaAddress || sasLoading}
                    className="btn-secondary"
                  >
                    {sasLoading && sasCredentialAddress && !sasSchemaAddress ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Creating...
                      </>
                    ) : sasSchemaAddress ? (
                      'Schema Created'
                    ) : (
                      'Create Schema'
                    )}
                  </Button>
                </div>
              </div>
            )}

            {/* Status Section */}
            <div className="p-6 bg-dark-gray/50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-silver">SAS Status:</span>
                  {sasReady || (sasCredentialAddress && sasSchemaAddress) ? (
                    <span className="text-sm text-green-400">Ready</span>
                  ) : (
                    <span className="text-sm text-amber-400">Setup Required</span>
                  )}
                </div>
                {solanaConnected && solanaPublicKey && (sasCredentialAddress && sasSchemaAddress) && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-silver">Authority:</span>
                    <code className="text-xs text-silver bg-black/50 px-2 py-1 rounded">
                      {solanaPublicKey.toBase58().slice(0, 8)}...
                    </code>
                    <button
                      onClick={() => copyToClipboard(solanaPublicKey.toBase58(), 'authority')}
                      className={`p-1 rounded ${sasCopied === 'authority' ? 'bg-green-500/20 text-green-400' : 'hover:bg-white/10'}`}
                    >
                      {sasCopied === 'authority' ? <CheckCircle className="w-3 h-3" /> : <Copy className="w-3 h-3 text-silver" />}
                    </button>
                  </div>
                )}
              </div>

              {/* Success message when setup complete */}
              {sasCredentialAddress && sasSchemaAddress && (
                <div className="mt-4 p-3 bg-green-900/20 border border-green-500/30 rounded-lg">
                  <p className="text-sm text-green-400">
                    SAS setup complete! Copy the authority address above to update the code.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Copied toast */}
          {sasCopied && (
            <div className="fixed bottom-6 right-6 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg z-50">
              Copied to clipboard!
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
