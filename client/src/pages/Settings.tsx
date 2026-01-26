// @ts-nocheck - Solana SAS integration incomplete
import { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw, CheckCircle, XCircle, AlertCircle, Trash2, Key, Eye, EyeOff, Save, Building2, Wallet, Copy, Loader2, ExternalLink, Zap, Database, ChevronDown, Clock } from 'lucide-react';
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
import { ChainStatusPanel } from '@/components/admin/ChainStatusPanel';
import { AttestationControls } from '@/components/defi/AttestationControls';
import { RailsSummary } from '@/components/defi/RailsSummary';
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

// Helper to translate cryptic IBKR errors to user-friendly messages
function translateIbkrError(rawError: string | null | undefined): { title: string; message: string; action?: string } | null {
  if (!rawError) return null;

  const errorLower = rawError.toLowerCase();

  if (errorLower.includes('timeout') || errorLower.includes('30000ms')) {
    return {
      title: 'Connection Timed Out',
      message: 'Could not reach IBKR servers. Please check your internet connection.',
      action: 'Try Again',
    };
  }

  if (errorLower.includes('iserver') || errorLower.includes('bridge')) {
    return {
      title: 'Market Data Unavailable',
      message: 'Cannot connect to market data service. Make sure IBKR is open and running.',
      action: 'Check IBKR',
    };
  }

  if (errorLower.includes('authentication') || errorLower.includes('auth failed')) {
    return {
      title: 'Authentication Failed',
      message: 'Login credentials are invalid or expired. Please verify your credentials.',
      action: 'Update Credentials',
    };
  }

  if (errorLower.includes('401') || errorLower.includes('unauthorized')) {
    return {
      title: 'Session Expired',
      message: 'Your session has expired. Click Test Connection to reconnect.',
      action: 'Reconnect',
    };
  }

  if (errorLower.includes('network') || errorLower.includes('econnrefused')) {
    return {
      title: 'Network Error',
      message: 'Could not establish connection. Check your internet and firewall settings.',
      action: 'Try Again',
    };
  }

  if (errorLower.includes('rate limit') || errorLower.includes('too many')) {
    return {
      title: 'Rate Limited',
      message: 'Too many connection attempts. Please wait a moment before trying again.',
      action: 'Wait',
    };
  }

  // Default fallback - show a cleaned up version of the error
  return {
    title: 'Connection Issue',
    message: rawError.length > 100 ? rawError.substring(0, 100) + '...' : rawError,
    action: 'Try Again',
  };
}

interface SettingsProps {
  /** Hide LeftNav when embedded in another page (e.g., Review page) */
  hideLeftNav?: boolean;
  // Attestation props
  selectedPeriod?: any;
  onPeriodChange?: (period: any) => void;
  previewData?: any | null;
  onPreview?: () => void;
  onAttest?: () => void;
  isPreviewLoading?: boolean;
  // Rail props
  rail?: any | null;
  violationCount?: number;
  railLoading?: boolean;
  // Attestation context
  attestations?: any[];
  cluster?: 'devnet' | 'mainnet-beta';
  sasReady?: boolean;
  checkingSas?: boolean;
  sasError?: string | null;
}

export function Settings({
  hideLeftNav = false,
  selectedPeriod = 'last_week',
  onPeriodChange,
  previewData,
  onPreview,
  onAttest,
  isPreviewLoading = false,
  rail,
  violationCount = 0,
  railLoading = false,
  attestations = [],
  cluster = 'devnet',
  sasReady = false,
  checkingSas = false,
  sasError = null,
}: SettingsProps = {}) {
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

  // Advanced settings section visibility
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Connection Method Toggle - OAuth vs TWS/Gateway
  const [connectionMethod, setConnectionMethod] = useState<'oauth' | 'relay'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('apeyolo-connection-method') as 'oauth' | 'relay') || 'oauth';
    }
    return 'oauth';
  });
  const [connectionModeLoading, setConnectionModeLoading] = useState(false);

  // API Key state for TWS Relay
  const [apiKey, setApiKey] = useState<{id: string; key: string; createdAt: string; lastUsedAt?: string} | null>(null);
  const [newlyGeneratedKey, setNewlyGeneratedKey] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);

  // Fetch current connection mode from server on mount
  useEffect(() => {
    const fetchConnectionMode = async () => {
      try {
        const response = await fetch('/api/settings/connection-mode', { credentials: 'include' });
        if (response.ok) {
          const data = await response.json();
          if (data.mode === 'oauth' || data.mode === 'relay') {
            setConnectionMethod(data.mode);
            localStorage.setItem('apeyolo-connection-method', data.mode);
          }
        }
      } catch (err) {
        console.error('Failed to fetch connection mode:', err);
      }
    };
    fetchConnectionMode();
  }, []);

  const handleConnectionMethodChange = async (method: 'oauth' | 'relay') => {
    setConnectionModeLoading(true);
    try {
      const response = await fetch('/api/settings/connection-mode', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ mode: method }),
      });

      if (response.ok) {
        const data = await response.json();
        setConnectionMethod(data.mode);
        localStorage.setItem('apeyolo-connection-method', data.mode);
        console.log('Connection mode changed:', data.message);

        // Refetch IBKR status to update WebSocket status display
        // Small delay to allow WebSocket to fully disconnect
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ['/api/ibkr/status'] });
        }, 500);
      } else {
        const error = await response.json();
        console.error('Failed to change connection mode:', error);
      }
    } catch (err) {
      console.error('Failed to change connection mode:', err);
    } finally {
      setConnectionModeLoading(false);
    }
  };

  // Solana wallet and SAS setup state
  const { connected: solanaConnected, publicKey: solanaPublicKey, signTransaction, disconnect: disconnectSolana } = useWallet();
  const { connection: solanaConnection } = useConnection();
  const [sasLoading, setSasLoading] = useState(false);
  const [internalSasError, setInternalSasError] = useState<string | null>(null);
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
      setInternalSasError('Wallet not connected');
      return;
    }

    setSasLoading(true);
    setInternalSasError(null);

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
        setInternalSasError('Credential already exists! Proceed to create schema.');
        const authorityAddress = address(solanaPublicKey.toBase58());
        const [credentialPda] = await deriveCredentialPda({
          authority: authorityAddress,
          name: APEYOLO_CREDENTIAL_NAME,
        });
        setSasCredentialAddress(credentialPda);
        setSasCredentialTx('already-exists');
      } else {
        setInternalSasError(err.message || 'Failed to create credential');
      }
    } finally {
      setSasLoading(false);
    }
  };

  const handleCreateSchema = async () => {
    if (!solanaPublicKey || !signTransaction || !sasCredentialAddress) {
      setInternalSasError('Credential not created yet');
      return;
    }

    setSasLoading(true);
    setInternalSasError(null);

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
        setInternalSasError('Schema already exists! Setup complete.');
        const credentialAddress = sasCredentialAddress as Address;
        const [schemaPda] = await deriveSchemaPda({
          credential: credentialAddress,
          name: APEYOLO_SCHEMA_NAME,
          version: APEYOLO_SCHEMA_VERSION,
        });
        setSasSchemaAddress(schemaPda);
        setSasSchemaTx('already-exists');
      } else {
        setInternalSasError(err.message || 'Failed to create schema');
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
      const response = await fetch('/api/ibkr/status', { credentials: 'include' });
      return response.json();
    },
    refetchInterval: (query) => {
      // Adaptive polling based on connection state
      // Reduced intervals to detect disconnects faster (UI shows stale status otherwise)
      const data = query.state.data as { configured?: boolean; connected?: boolean } | undefined;
      if (!data?.configured) return false; // Don't poll if not configured
      // Fast polling when disconnected to quickly show reconnect status
      if (data?.configured && !data?.connected) return 3000; // 3s when disconnected/connecting
      return 5000; // 5s when connected (was 30s - caused 30s stale UI on disconnect)
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
      const response = await fetch('/api/ibkr/test', { method: 'POST', credentials: 'include' });
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
      const response = await fetch('/api/broker/oauth', { method: 'POST', credentials: 'include' });
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
      const response = await fetch('/api/broker/warm', { credentials: 'include' });
      return response.json();
    },
    onSuccess: () => refreshAllIbkrStatus(),
  });

  // Auto-reconnect state with timeout-based backoff (not interval)
  const [backoffMs, setBackoffMs] = useState<number>(3000);
  const [isAutoConnecting, setIsAutoConnecting] = useState<boolean>(false);
  const [retryCount, setRetryCount] = useState<number>(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Rate limiting for manual reconnect button (60 second cooldown)
  const [reconnectCooldown, setReconnectCooldown] = useState<number>(0);
  const reconnectCooldownRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (reconnectCooldownRef.current) {
        clearInterval(reconnectCooldownRef.current);
      }
    };
  }, []);

  // Start cooldown timer for manual reconnect button
  const startReconnectCooldown = useCallback(() => {
    setReconnectCooldown(60);
    if (reconnectCooldownRef.current) {
      clearInterval(reconnectCooldownRef.current);
    }
    reconnectCooldownRef.current = setInterval(() => {
      setReconnectCooldown((prev) => {
        if (prev <= 1) {
          if (reconnectCooldownRef.current) {
            clearInterval(reconnectCooldownRef.current);
            reconnectCooldownRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  // Single async reconnect attempt - no nested mutations
  const attemptReconnect = useCallback(async () => {
    if (isAutoConnecting) return;

    setIsAutoConnecting(true);
    setRetryCount((c) => c + 1);

    try {
      // Try warm endpoint first (runs full readiness flow server-side)
      const warmResponse = await fetch('/api/broker/warm', { credentials: 'include' });
      const warmResult = await warmResponse.json();

      if (warmResult?.ok) {
        // Success - reset backoff
        setBackoffMs(3000);
        setRetryCount(0);
        setIsAutoConnecting(false);
        refreshAllIbkrStatus();
        return;
      }

      // Warm failed, try OAuth reconnect
      const reconnectResponse = await fetch('/api/broker/oauth', { method: 'POST', credentials: 'include' });
      const reconnectResult = await reconnectResponse.json();

      if (reconnectResult?.ok || reconnectResult?.success) {
        // Success - reset backoff
        setBackoffMs(3000);
        setRetryCount(0);
      } else {
        // Failed - increase backoff for next attempt
        setBackoffMs((ms) => Math.min(30000, ms * 1.5));
      }
    } catch (err) {
      // Network error - increase backoff
      setBackoffMs((ms) => Math.min(30000, ms * 1.5));
    } finally {
      setIsAutoConnecting(false);
      refreshAllIbkrStatus();
    }
  }, [isAutoConnecting, refreshAllIbkrStatus]);

  // Auto-reconnect effect with timeout-based retry (simpler dependencies)
  useEffect(() => {
    // Clear any existing timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Skip if in relay mode (intentionally disconnected for TWS/Gateway)
    if (ibkrStatus?.connectionMode === 'relay') {
      if (retryCount > 0) {
        setBackoffMs(3000);
        setRetryCount(0);
        setIsAutoConnecting(false);
      }
      return;
    }

    // Skip if not configured or already connected
    if (!ibkrStatus?.configured || ibkrStatus?.connected) {
      if (ibkrStatus?.connected && retryCount > 0) {
        setBackoffMs(3000);
        setRetryCount(0);
        setIsAutoConnecting(false);
      }
      return;
    }

    // Skip if already attempting
    if (isAutoConnecting) {
      return;
    }

    // Schedule reconnect attempt with backoff delay
    // First attempt is immediate, subsequent ones use backoff
    const delay = retryCount === 0 ? 0 : backoffMs;
    reconnectTimeoutRef.current = setTimeout(attemptReconnect, delay);

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [ibkrStatus?.configured, ibkrStatus?.connected, ibkrStatus?.connectionMode, isAutoConnecting, retryCount]);

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
        credentials: 'include',
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
        credentials: 'include',
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
      const response = await fetch('/api/settings/ibkr', { credentials: 'include' });
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
        credentials: 'include',
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
        credentials: 'include',
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
        credentials: 'include',
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

  // ==================== API KEYS FOR TWS RELAY ====================

  // Fetch API keys
  const { data: apiKeyData } = useQuery({
    queryKey: ['/api/settings/api-keys'],
    queryFn: async () => {
      const response = await fetch('/api/settings/api-keys', { credentials: 'include' });
      return response.json();
    },
    enabled: connectionMethod === 'relay',
  });

  // Update apiKey state when data changes
  useEffect(() => {
    if (apiKeyData?.keys && apiKeyData.keys.length > 0) {
      const key = apiKeyData.keys[0];
      setApiKey({
        id: key.id,
        key: key.keyPrefix + '...' + key.keySuffix,
        createdAt: key.createdAt,
        lastUsedAt: key.lastUsedAt,
      });
    } else {
      setApiKey(null);
    }
  }, [apiKeyData]);

  // Generate API key mutation
  const generateApiKeyMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/settings/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: 'Relay Key' }),
      });
      return response.json();
    },
    onSuccess: (data) => {
      if (data.key) {
        setNewlyGeneratedKey(data.key);
        setApiKey({
          id: data.id,
          key: data.key,
          createdAt: data.createdAt,
        });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/settings/api-keys'] });
    },
  });

  // Delete API key mutation
  const deleteApiKeyMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/settings/api-keys/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      return response.json();
    },
    onSuccess: () => {
      setNewlyGeneratedKey(null);
      setApiKey(null);
      queryClient.invalidateQueries({ queryKey: ['/api/settings/api-keys'] });
    },
  });

  const copyApiKey = () => {
    if (newlyGeneratedKey) {
      navigator.clipboard.writeText(newlyGeneratedKey);
    } else if (apiKey) {
      // Can't copy masked key - show message instead
      navigator.clipboard.writeText(apiKey.key);
    }
  };

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

  // CONSOLIDATED CONNECTION STATE
  // Single source of truth for all connection status display
  type ConnectionState = 'not_configured' | 'relay_mode' | 'connected' | 'connecting' | 'disconnected' | 'circuit_breaker';

  const connectionState: ConnectionState = (() => {
    if (!ibkrStatus?.configured) return 'not_configured';
    if (ibkrStatus?.connectionMode === 'relay') return 'relay_mode';
    // Check circuit breaker (from WebSocket status if available)
    if (ibkrStatus?.diagnostics?.websocket?.circuitBreakerOpen) return 'circuit_breaker';
    if (ibkrStatus?.connected) return 'connected';
    if (isAutoConnecting || warmMutation.isPending || reconnectMutation.isPending) return 'connecting';
    return 'disconnected';
  })();

  const connectionDisplay = {
    not_configured: {
      icon: <AlertCircle className="w-5 h-5 text-yellow-500" />,
      text: 'Not Configured',
      color: 'text-yellow-500',
    },
    relay_mode: {
      icon: <Database className="w-5 h-5 text-purple-500" />,
      text: 'TWS Mode',
      color: 'text-purple-500',
    },
    connected: {
      icon: <CheckCircle className="w-5 h-5 text-green-500" />,
      text: 'Connected',
      color: 'text-green-500',
    },
    connecting: {
      icon: <RefreshCw className="w-5 h-5 text-blue-500 animate-spin" />,
      text: 'Connecting...',
      color: 'text-blue-500',
    },
    disconnected: {
      icon: <XCircle className="w-5 h-5 text-red-500" />,
      text: 'Disconnected',
      color: 'text-red-500',
    },
    circuit_breaker: {
      icon: <XCircle className="w-5 h-5 text-orange-500" />,
      text: 'Auth Failed - Check Credentials',
      color: 'text-orange-500',
    },
  };

  const getConnectionIcon = () => connectionDisplay[connectionState].icon;
  const getConnectionStatus = () => connectionDisplay[connectionState].text;
  const getConnectionStatusColor = () => connectionDisplay[connectionState].color;

  return (
    <div className="flex h-[calc(100vh-64px)]">
      {!hideLeftNav && <LeftNav />}
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

            {/* MODE Toggle - LIVE/PAPER */}
            <div className="p-4 border-b border-white/10 bg-dark-gray/30">
              <div className="flex items-center justify-between">
                <span className="text-sm text-silver">Trading Mode</span>
                <div className="flex items-center gap-2">
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                    ibkrStatus?.environment === 'live'
                      ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                      : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                  }`}>
                    {ibkrStatus?.environment === 'live' ? 'LIVE' : 'PAPER'}
                  </span>
                </div>
              </div>
            </div>

            {/* ACCOUNT SUMMARY Section */}
            {ibkrStatus?.configured && (
              <div className="p-6 border-b border-white/10">
                <h4 className="text-sm font-medium text-silver uppercase tracking-wider mb-4">Account Summary</h4>
                <div className="grid grid-cols-4 gap-3">
                  <div className="p-3 bg-dark-gray rounded-lg">
                    <p className="text-xs text-silver mb-1">Account ID</p>
                    <p className="text-sm font-mono font-medium">{ibkrStatus?.accountId || '—'}</p>
                  </div>
                  <div className="p-3 bg-dark-gray rounded-lg">
                    <p className="text-xs text-silver mb-1">Portfolio Value</p>
                    <p className="text-sm font-medium tabular-nums">
                      {ibkrStatus?.nav
                        ? `$${ibkrStatus.nav.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : ibkrStatus?.netValue
                          ? `$${ibkrStatus.netValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : '—'}
                    </p>
                  </div>
                  <div className="p-3 bg-dark-gray rounded-lg">
                    <p className="text-xs text-silver mb-1">Buying Power</p>
                    <p className="text-sm font-medium tabular-nums">
                      {ibkrStatus?.buyingPower
                        ? `$${ibkrStatus.buyingPower.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : '—'}
                    </p>
                  </div>
                  <div className="p-3 bg-dark-gray rounded-lg">
                    <p className="text-xs text-silver mb-1">Last Updated</p>
                    <p className="text-sm text-silver flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {ibkrStatus?.lastUpdated
                        ? (() => {
                            const diff = Date.now() - new Date(ibkrStatus.lastUpdated).getTime();
                            const mins = Math.floor(diff / 60000);
                            return mins < 1 ? 'Just now' : `${mins}m ago`;
                          })()
                        : '—'}
                    </p>
                  </div>
                </div>

                {/* Connection Status Indicators - Compact */}
                {ibkrStatus?.diagnostics && connectionMethod === 'oauth' && (
                  <div className="mt-4 flex items-center gap-3 text-xs">
                    <span className="text-silver">Status:</span>
                    <div className="flex items-center gap-2">
                      <span className={`flex items-center gap-1 ${ibkrStatus.diagnostics.oauth?.success ? 'text-green-400' : 'text-zinc-500'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${ibkrStatus.diagnostics.oauth?.success ? 'bg-green-400' : 'bg-zinc-500'}`} />
                        OAuth
                      </span>
                      <span className={`flex items-center gap-1 ${ibkrStatus.diagnostics.sso?.success ? 'text-green-400' : 'text-zinc-500'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${ibkrStatus.diagnostics.sso?.success ? 'bg-green-400' : 'bg-zinc-500'}`} />
                        SSO
                      </span>
                      <span className={`flex items-center gap-1 ${ibkrStatus.diagnostics.websocket?.success ? 'text-green-400' : 'text-zinc-500'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${ibkrStatus.diagnostics.websocket?.success ? 'bg-green-400' : 'bg-zinc-500'}`} />
                        WebSocket
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Error Display - User Friendly */}
            {(ibkrStatus?.errorMessage || userCredentials?.errorMessage) && (
              (() => {
                const error = translateIbkrError(ibkrStatus?.errorMessage || userCredentials?.errorMessage);
                if (!error) return null;
                return (
                  <div className="mx-6 mt-4 p-4 bg-red-900/20 border border-red-500/30 rounded-lg">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-red-400">{error.title}</p>
                        <p className="text-xs text-red-300/80 mt-1">{error.message}</p>
                      </div>
                      {error.action && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-xs border-red-500/30 text-red-400 hover:bg-red-500/10"
                          onClick={() => {
                            if (error.action === 'Update Credentials') {
                              setShowCredentialsForm(true);
                              setShowAdvanced(true);
                            } else {
                              testCredentialsMutation.mutate();
                            }
                          }}
                        >
                          {error.action}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })()
            )}

            {/* CONNECTION METHOD Toggle */}
            <div className="p-6 border-b border-white/10">
              <h4 className="text-sm font-medium text-silver uppercase tracking-wider mb-4">Connection Method</h4>
              <div className="flex gap-2">
                <button
                  onClick={() => handleConnectionMethodChange('oauth')}
                  disabled={connectionModeLoading}
                  className={`flex-1 p-4 rounded-lg border-2 transition-all ${
                    connectionMethod === 'oauth'
                      ? 'border-electric bg-electric/10 text-white'
                      : 'border-white/10 bg-dark-gray text-silver hover:border-white/30'
                  } ${connectionModeLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    {connectionModeLoading && connectionMethod !== 'oauth' ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Key className="w-5 h-5" />
                    )}
                    <div className="text-left">
                      <p className="font-medium">OAuth 2.0</p>
                      <p className="text-xs opacity-70">Direct API connection via IBKR OAuth</p>
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => handleConnectionMethodChange('relay')}
                  disabled={connectionModeLoading}
                  className={`flex-1 p-4 rounded-lg border-2 transition-all ${
                    connectionMethod === 'relay'
                      ? 'border-electric bg-electric/10 text-white'
                      : 'border-white/10 bg-dark-gray text-silver hover:border-white/30'
                  } ${connectionModeLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    {connectionModeLoading && connectionMethod !== 'relay' ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Database className="w-5 h-5" />
                    )}
                    <div className="text-left">
                      <p className="font-medium">TWS/Gateway</p>
                      <p className="text-xs opacity-70">Local relay via TWS or IB Gateway</p>
                    </div>
                  </div>
                </button>
              </div>
              {connectionMethod === 'relay' && (
                <p className="text-xs text-electric mt-2">OAuth WebSocket disconnected. You can now connect TWS/Gateway locally.</p>
              )}
            </div>

            {/* Test/Order Results - shown when present */}
            {(testResult || orderResult || clearResult || credTestResult) && (
              <div className={`p-6 border-b border-white/10 transition-opacity ${connectionMethod !== 'oauth' ? 'opacity-40' : ''}`}>
                {testResult && (
                  <div className={`p-3 rounded-lg border ${
                    testResult.success ? 'bg-green-900/20 border-green-500/30' : 'bg-red-900/20 border-red-500/30'
                  }`}>
                    <p className={`text-sm font-medium ${testResult.success ? 'text-green-400' : 'text-red-400'}`}>
                      Connection Test: {testResult.message}
                    </p>
                  </div>
                )}

                {credTestResult && (
                  <div className={`${testResult ? 'mt-3' : ''} p-3 rounded-lg border ${
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

                {orderResult && (
                  <div className={`${testResult || credTestResult ? 'mt-3' : ''} p-3 rounded-lg border ${
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
                  <div className={`${testResult || credTestResult || orderResult ? 'mt-3' : ''} p-3 rounded-lg border ${
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
            )}

            {/* ADVANCED Section - Collapsible */}
            <div className={`border-b border-white/10 transition-opacity ${connectionMethod !== 'oauth' ? 'opacity-40' : ''}`}>
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="w-full p-4 flex items-center justify-between text-left hover:bg-white/5 transition-colors"
              >
                <span className="text-sm font-medium text-silver uppercase tracking-wider">Advanced Settings</span>
                <ChevronDown className={`w-4 h-4 text-silver transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
              </button>

              {showAdvanced && (
                <div className="pb-6">
                  {/* Data Source Info */}
                  <div className="px-6 pb-4">
                    <div className="p-3 rounded-lg border bg-electric/10 border-electric/30">
                      <div className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-electric" />
                        <span className="text-sm text-white">WebSocket Streaming</span>
                        <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">FREE</span>
                      </div>
                      <p className="text-xs text-silver mt-1">
                        Real-time push updates • ~50ms latency • Covered by OPRA subscription
                      </p>
                    </div>
                  </div>

                  {/* Auth Pipeline - Detailed */}
                  {ibkrStatus?.configured && ibkrStatus.diagnostics && connectionMethod === 'oauth' && (
                    <div className="px-6 pb-4">
                      <p className="text-xs text-silver mb-2">Auth Pipeline</p>
                      <div className="p-3 bg-dark-gray rounded-lg">
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
                          <StatusStep
                            name="WebSocket"
                            status={ibkrStatus.diagnostics.websocket?.status || 0}
                            message={ibkrStatus.diagnostics.websocket?.message || 'Not initialized'}
                            success={ibkrStatus.diagnostics.websocket?.success}
                            compact
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Credentials Management */}
                  <div className="px-6">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs text-silver">Credentials</p>
                      <span className={`text-xs font-medium ${getCredentialStatusColor()}`}>
                        {getCredentialStatusText()}
                      </span>
                    </div>

                    {/* Current Credentials Display */}
                    {userCredentials?.configured && !showCredentialsForm && (
                      <div className="grid grid-cols-3 gap-3 mb-3">
                        <div className="p-2 bg-dark-gray rounded-lg">
                          <p className="text-xs text-silver mb-0.5">Client ID</p>
                          <p className="text-xs font-mono truncate">{userCredentials.clientId}</p>
                        </div>
                        <div className="p-2 bg-dark-gray rounded-lg">
                          <p className="text-xs text-silver mb-0.5">Username</p>
                          <p className="text-xs font-mono">{userCredentials.credential}</p>
                        </div>
                        <div className="p-2 bg-dark-gray rounded-lg">
                          <p className="text-xs text-silver mb-0.5">Last Connected</p>
                          <p className="text-xs">
                            {userCredentials.lastConnectedAt
                              ? new Date(userCredentials.lastConnectedAt).toLocaleDateString()
                              : '—'}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Credentials Form - Keep existing form structure */}
                    {showCredentialsForm && (
                      <div className="space-y-4">
                        <p className="text-sm text-silver">
                          Enter your IBKR OAuth credentials from the API Gateway.
                        </p>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label htmlFor="cred-client-id" className="text-xs">Client ID *</Label>
                            <Input
                              id="cred-client-id"
                              value={credClientId}
                              onChange={(e) => setCredClientId(e.target.value)}
                              placeholder="Your IBKR Client ID"
                              className="input-monochrome mt-1 text-sm"
                            />
                          </div>
                          <div>
                            <Label htmlFor="cred-client-key-id" className="text-xs">Client Key ID *</Label>
                            <Input
                              id="cred-client-key-id"
                              value={credClientKeyId}
                              onChange={(e) => setCredClientKeyId(e.target.value)}
                              placeholder="e.g., main"
                              className="input-monochrome mt-1 text-sm"
                            />
                          </div>
                        </div>

                        <div>
                          <Label htmlFor="cred-username" className="text-xs">IBKR Username *</Label>
                          <Input
                            id="cred-username"
                            value={credUsername}
                            onChange={(e) => setCredUsername(e.target.value)}
                            placeholder="Your IBKR login username"
                            className="input-monochrome mt-1 text-sm"
                          />
                        </div>

                        <div>
                          <div className="flex items-center justify-between">
                            <Label htmlFor="cred-private-key" className="text-xs">Private Key (PEM) *</Label>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setShowPrivateKey(!showPrivateKey)}
                              className="text-xs text-silver hover:text-white h-6"
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
                            className={`input-monochrome mt-1 min-h-24 font-mono text-xs ${!showPrivateKey ? 'blur-sm hover:blur-none focus:blur-none' : ''}`}
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label htmlFor="cred-account-id" className="text-xs">Account ID (optional)</Label>
                            <Input
                              id="cred-account-id"
                              value={credAccountId}
                              onChange={(e) => setCredAccountId(e.target.value)}
                              placeholder="U1234567"
                              className="input-monochrome mt-1 text-sm"
                            />
                          </div>
                          <div>
                            <Label htmlFor="cred-environment" className="text-xs">Environment</Label>
                            <Select value={credEnvironment} onValueChange={(v) => setCredEnvironment(v as 'paper' | 'live')}>
                              <SelectTrigger className="input-monochrome mt-1 text-sm">
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
                          <Label htmlFor="cred-allowed-ip" className="text-xs">Allowed IP (optional)</Label>
                          <Input
                            id="cred-allowed-ip"
                            value={credAllowedIp}
                            onChange={(e) => setCredAllowedIp(e.target.value)}
                            placeholder="Your server's static IP"
                            className="input-monochrome mt-1 text-sm"
                          />
                        </div>

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
                            size="sm"
                          >
                            <Key className="w-4 h-4 mr-2" />
                            Add IBKR Credentials
                          </Button>
                        ) : (
                          <>
                            <Button
                              onClick={() => setShowCredentialsForm(true)}
                              className="btn-secondary flex-1"
                              size="sm"
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
                              size="sm"
                              disabled={deleteCredentialsMutation.isPending}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ACTIONS Section */}
            <div className={`p-6 bg-dark-gray/50 transition-opacity ${connectionMethod !== 'oauth' ? 'opacity-40' : ''}`}>
              {!ibkrStatus?.configured && (
                <div className="p-3 bg-yellow-900/20 border border-yellow-500/30 rounded-lg mb-4">
                  <p className="text-sm text-yellow-400">
                    IBKR credentials not configured.{' '}
                    <button
                      onClick={() => setShowAdvanced(true)}
                      className="underline hover:text-yellow-300"
                    >
                      Open Advanced Settings
                    </button>
                    {' '}to add your credentials.
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
                      startReconnectCooldown();
                    }}
                    className="btn-secondary"
                    disabled={reconnectMutation.isPending || warmMutation.isPending || reconnectCooldown > 0}
                    data-testid="button-reconnect"
                  >
                    <RefreshCw className={`w-4 h-4 mr-2 ${(reconnectMutation.isPending || warmMutation.isPending) ? 'animate-spin' : ''}`} />
                    {reconnectMutation.isPending || warmMutation.isPending
                      ? 'Reconnecting...'
                      : reconnectCooldown > 0
                        ? `Wait ${reconnectCooldown}s`
                        : 'Force Reconnect'}
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

            {/* TWS/GATEWAY RELAY Section - Only shown when relay is selected */}
            {connectionMethod === 'relay' && (
              <div className="p-6 border-t border-white/10">
                <h4 className="text-sm font-medium text-silver uppercase tracking-wider mb-4">TWS/Gateway Relay</h4>

                {/* API Key Section */}
                <div className="space-y-4 mb-6">
                  <h5 className="text-sm font-medium text-white">API Key</h5>

                  {apiKey ? (
                    <div className="space-y-3">
                      {/* Show masked key */}
                      <div className="flex items-center gap-2">
                        <code className="bg-black/50 px-3 py-2 rounded text-sm font-mono flex-1">
                          {showApiKey && newlyGeneratedKey ? newlyGeneratedKey : apiKey.key}
                        </code>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowApiKey(!showApiKey)}
                          disabled={!newlyGeneratedKey}
                          title={newlyGeneratedKey ? (showApiKey ? 'Hide key' : 'Show key') : 'Full key only visible after generation'}
                        >
                          {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={copyApiKey}
                          title="Copy to clipboard"
                        >
                          <Copy className="w-4 h-4" />
                        </Button>
                      </div>

                      {/* Key info */}
                      <p className="text-xs text-silver">
                        Created: {new Date(apiKey.createdAt).toLocaleDateString()}
                        {apiKey.lastUsedAt && ` \u2022 Last used: ${new Date(apiKey.lastUsedAt).toLocaleDateString()}`}
                      </p>

                      {/* Actions */}
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            if (apiKey && window.confirm('This will invalidate your current API key. Continue?')) {
                              deleteApiKeyMutation.mutate(apiKey.id, {
                                onSuccess: () => {
                                  generateApiKeyMutation.mutate();
                                }
                              });
                            }
                          }}
                          disabled={generateApiKeyMutation.isPending || deleteApiKeyMutation.isPending}
                        >
                          <RefreshCw className={`w-4 h-4 mr-2 ${generateApiKeyMutation.isPending ? 'animate-spin' : ''}`} />
                          Regenerate
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            if (apiKey && window.confirm('Are you sure you want to delete this API key?')) {
                              deleteApiKeyMutation.mutate(apiKey.id);
                            }
                          }}
                          disabled={deleteApiKeyMutation.isPending}
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      onClick={() => generateApiKeyMutation.mutate()}
                      disabled={generateApiKeyMutation.isPending}
                    >
                      <Key className="w-4 h-4 mr-2" />
                      {generateApiKeyMutation.isPending ? 'Generating...' : 'Generate API Key'}
                    </Button>
                  )}

                  {/* Show full key once after generation */}
                  {newlyGeneratedKey && (
                    <div className="p-4 bg-green-500/10 border border-green-500/30 rounded">
                      <p className="text-sm text-green-400 mb-2">
                        Copy your API key now - it won't be shown again!
                      </p>
                      <code className="bg-black px-3 py-2 rounded text-sm font-mono block break-all">
                        {newlyGeneratedKey}
                      </code>
                    </div>
                  )}
                </div>

                {/* Connection Instructions */}
                <div className="p-4 bg-dark-gray rounded-lg border border-white/10 mb-4">
                  <p className="text-sm text-silver mb-3">
                    Connect your local TWS or IB Gateway to APE-YOLO using the relay connector.
                  </p>
                  <div className="bg-black/30 rounded p-3 font-mono text-sm">
                    <p className="text-silver mb-2">To connect:</p>
                    <p className="text-electric">1. Start TWS or IB Gateway and log in</p>
                    <p className="text-electric">2. Enable API connections in TWS settings</p>
                    <p className="text-electric">3. Run the relay connector:</p>
                    <p className="text-white mt-2 bg-black/50 p-2 rounded">
                      npx apeyolo-connect --api-key {newlyGeneratedKey || apiKey?.key || 'YOUR_API_KEY'}
                    </p>
                  </div>
                </div>
                {/* Relay Connection Status - dynamic based on data flow */}
                {ibkrStatus?.diagnostics?.websocket?.hasRealData ? (
                  <div className="flex items-center gap-2 text-green-400">
                    <CheckCircle className="w-4 h-4" />
                    <span className="text-sm">Relay connected - receiving data</span>
                  </div>
                ) : ibkrStatus?.diagnostics?.websocket?.connected ? (
                  <div className="flex items-center gap-2 text-blue-400">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Relay connected - waiting for data</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-yellow-400">
                    <AlertCircle className="w-4 h-4" />
                    <span className="text-sm">Relay not connected - run the connector command above</span>
                  </div>
                )}
              </div>
            )}
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

            {/* NEW: Attestation Controls - Only show when wallet connected */}
            {solanaConnected && sasReady && onPeriodChange && onPreview && onAttest && (
              <div className="p-6 border-b border-white/10">
                <h4 className="text-sm font-medium text-silver uppercase tracking-wider mb-4">
                  Attestation Controls
                </h4>
                <AttestationControls
                  selectedPeriod={selectedPeriod}
                  onPeriodChange={onPeriodChange}
                  onPreview={onPreview}
                  onAttest={onAttest}
                  isLoading={isPreviewLoading}
                  hasPreview={!!previewData}
                  sasReady={sasReady}
                  disabled={!solanaConnected}
                />

                {/* Preview Data Display */}
                {previewData && (
                  <div className="mt-4 bg-dark-gray rounded-lg p-4 border border-white/10">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <div className="text-silver">Return</div>
                        <div className="text-white font-medium">
                          {previewData.return_pct?.toFixed(2)}%
                        </div>
                      </div>
                      <div>
                        <div className="text-silver">P&L</div>
                        <div className="text-white font-medium">
                          ${previewData.pnl?.toFixed(2)}
                        </div>
                      </div>
                      <div>
                        <div className="text-silver">Trades</div>
                        <div className="text-white font-medium">
                          {previewData.trade_count}
                        </div>
                      </div>
                      <div>
                        <div className="text-silver">Details Hash</div>
                        <div className="text-white font-mono text-xs truncate">
                          {previewData.details_hash}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* NEW: Chain Status Panel */}
            <div className="p-6 border-b border-white/10">
              <ChainStatusPanel
                sasReady={sasReady}
                cluster={cluster}
                attestationCount={attestations.length}
                checkingSas={checkingSas}
                sasError={sasError}
              />
            </div>

            {/* NEW: Rails Summary */}
            <div className="p-6 border-b border-white/10">
              <RailsSummary
                rail={rail}
                violationCount={violationCount}
                onCreateClick={() => {/* TODO: Handle create rail */}}
                loading={railLoading}
              />
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
                {internalSasError && (
                  <div className="p-3 bg-red-900/20 border border-red-500/30 rounded-lg mb-4">
                    <p className="text-sm text-red-400">{internalSasError}</p>
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
