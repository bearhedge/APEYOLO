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
import { useTokenRefreshLogs, type RefreshLogEntry } from '@/hooks/useTokenRefreshLogs';
import { IbkrConnectionSection } from '@/components/settings/IbkrConnectionSection';

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

/**
 * Token Refresh Log Panel Component
 * Shows real-time OAuth token refresh activity in a collapsible panel
 */
function TokenRefreshLogPanel() {
  const [expanded, setExpanded] = useState(false);
  const { logs } = useTokenRefreshLogs();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new log entries when expanded
  useEffect(() => {
    if (expanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, expanded]);

  const getLogColor = (type: RefreshLogEntry['type']) => {
    switch (type) {
      case 'refresh_success':
      case 'ws_updated':
        return 'text-green-400';
      case 'refresh_error':
        return 'text-red-400';
      case 'refresh_start':
        return 'text-yellow-400';
      default:
        return 'text-silver';
    }
  };

  const formatTime = (ts: string) => {
    return new Date(ts).toLocaleTimeString('en-US', { hour12: false });
  };

  const getLogPrefix = (type: RefreshLogEntry['type']) => {
    switch (type) {
      case 'refresh_success':
      case 'ws_updated':
        return '\u2713 '; // checkmark
      case 'refresh_error':
        return '\u2717 '; // X mark
      default:
        return '';
    }
  };

  return (
    <div className="px-6 pb-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-silver hover:text-white transition-colors"
      >
        <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        Token Refresh Log
        {logs.length > 0 && (
          <span className="bg-white/10 px-1.5 py-0.5 rounded text-xs">{logs.length}</span>
        )}
      </button>

      {expanded && (
        <div
          ref={scrollRef}
          className="mt-2 bg-black/50 rounded-lg p-3 max-h-48 overflow-y-auto font-mono text-xs"
        >
          {logs.length === 0 ? (
            <p className="text-silver">No refresh activity yet...</p>
          ) : (
            logs.map((log, i) => (
              <div key={i} className={`${getLogColor(log.type)} leading-relaxed`}>
                <span className="text-zinc-500">[{formatTime(log.timestamp)}]</span>{' '}
                {getLogPrefix(log.type)}
                {log.message}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
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
          {/* Simplified IBKR Connection Section */}
          <IbkrConnectionSection />

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
