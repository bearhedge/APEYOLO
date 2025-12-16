/**
 * Smart Contracts Page
 *
 * Two-tab layout:
 * - RULES: Trading mandate creation and management
 * - RECORDS: On-chain notarization of trading performance (attestations)
 *
 * Requires wallet connection for full functionality.
 */

import { useState, useMemo, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { LeftNav } from '@/components/LeftNav';
import { DataTable } from '@/components/DataTable';
import { MandateCard } from '@/components/MandateCard';
import {
  ShieldCheck,
  Calendar,
  FileCheck,
  ExternalLink,
  Loader2,
  ChevronDown,
  Zap,
  Info,
  Shield,
  Plus,
  AlertCircle,
  ScrollText,
  BarChart3,
  Wallet,
  CheckCircle,
  Link as LinkIcon,
} from 'lucide-react';
import type { AttestationData, AttestationPeriod, OnChainAttestation } from '@shared/types/defi';
import type { Mandate, Violation, CreateMandateRequest } from '@shared/types/mandate';
import { useWalletContext } from '@/components/WalletProvider';
import {
  getExplorerUrl,
  formatUSD,
  formatPercent,
  getLastWeekRange,
  getLastMonthRange,
  getMTDRange,
  formatPeriodLabel,
} from '@/lib/solana';

// Period option type for the selector
interface PeriodOption {
  type: AttestationPeriod;
  label: string;
  dateRange?: string;
}

// Tab type
type TabType = 'rules' | 'records';

// Default mandate values for new creation
const DEFAULT_MANDATE: CreateMandateRequest = {
  allowedSymbols: ['SPY', 'SPX'],
  strategyType: 'SELL',
  minDelta: 0.20,
  maxDelta: 0.35,
  maxDailyLossPercent: 0.02, // 2%
  noOvernightPositions: true,
  exitDeadline: '15:55',
  tradingWindowStart: '12:00',
  tradingWindowEnd: '14:00',
};

export function DeFi() {
  const { connected, publicKey } = useWallet();
  const { attestations, loading: attestationsLoading, cluster, createAttestation, refetchAttestations } = useWalletContext();

  // Tab state
  const [activeTab, setActiveTab] = useState<TabType>('rules');

  // Mandate state
  const [mandate, setMandate] = useState<Mandate | null>(null);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [violationCount, setViolationCount] = useState(0);
  const [monthlyViolations, setMonthlyViolations] = useState(0);
  const [mandateLoading, setMandateLoading] = useState(true);
  const [showCreateMandate, setShowCreateMandate] = useState(false);
  const [createMandateLoading, setCreateMandateLoading] = useState(false);
  const [createMandateError, setCreateMandateError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');

  // Local state for attestation
  const [selectedPeriod, setSelectedPeriod] = useState<AttestationPeriod>('last_week');
  const [showPeriodDropdown, setShowPeriodDropdown] = useState(false);
  const [previewData, setPreviewData] = useState<AttestationData | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  // Fetch mandate data when wallet connects
  useEffect(() => {
    if (connected) {
      fetchMandate();
    }
  }, [connected]);

  const fetchMandate = async () => {
    setMandateLoading(true);
    try {
      const response = await fetch('/api/defi/mandate', {
        credentials: 'include',
      });
      const result = await response.json();
      if (result.success) {
        setMandate(result.mandate);
        setViolations(result.violations || []);
        setViolationCount(result.violationCount || 0);
        setMonthlyViolations(result.monthlyViolations || 0);
      }
    } catch (error) {
      console.error('Error fetching mandate:', error);
    } finally {
      setMandateLoading(false);
    }
  };

  const handleCreateMandate = async () => {
    if (confirmText !== 'I UNDERSTAND') {
      setCreateMandateError('Please type "I UNDERSTAND" to confirm');
      return;
    }

    setCreateMandateLoading(true);
    setCreateMandateError(null);

    try {
      const response = await fetch('/api/defi/mandate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(DEFAULT_MANDATE),
      });

      const result = await response.json();
      if (result.success) {
        setMandate(result.mandate);
        setShowCreateMandate(false);
        setConfirmText('');
      } else {
        setCreateMandateError(result.error || 'Failed to create mandate');
      }
    } catch (error: any) {
      setCreateMandateError(error.message || 'Failed to create mandate');
    } finally {
      setCreateMandateLoading(false);
    }
  };

  // Get period options with date ranges
  const periodOptions = useMemo((): PeriodOption[] => {
    const lastWeek = getLastWeekRange();
    const lastMonth = getLastMonthRange();
    const mtd = getMTDRange();

    return [
      {
        type: 'last_week',
        label: 'Last Week',
        dateRange: formatPeriodLabel(lastWeek.start, lastWeek.end),
      },
      {
        type: 'last_month',
        label: 'Last Month',
        dateRange: formatPeriodLabel(lastMonth.start, lastMonth.end),
      },
      {
        type: 'mtd',
        label: 'Month to Date',
        dateRange: formatPeriodLabel(mtd.start, mtd.end),
      },
    ];
  }, []);

  // Selected period info
  const selectedPeriodInfo = periodOptions.find(p => p.type === selectedPeriod);

  // Generate attestation preview
  const handlePreview = async () => {
    if (!connected) return;
    setIsPreviewLoading(true);
    setPreviewData(null);

    try {
      const response = await fetch('/api/defi/generate-attestation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ periodType: selectedPeriod }),
      });

      const result = await response.json();
      if (result.success && result.data) {
        setPreviewData(result.data);
      } else {
        console.error('Failed to generate record:', result.error);
      }
    } catch (error) {
      console.error('Error generating record:', error);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  // Attestation submission state
  const [isAttesting, setIsAttesting] = useState(false);
  const [attestSuccess, setAttestSuccess] = useState<{ signature: string } | null>(null);
  const [attestError, setAttestError] = useState<string | null>(null);

  // Submit attestation to Solana
  const handleAttest = async () => {
    if (!previewData || !connected) return;

    setIsAttesting(true);
    setAttestError(null);
    setAttestSuccess(null);

    try {
      const signature = await createAttestation(previewData);
      setAttestSuccess({ signature });
      setPreviewData(null); // Clear preview after success

      // Refetch attestations to show the new one
      await refetchAttestations();
    } catch (error: any) {
      console.error('Attestation error:', error);
      setAttestError(error.message || 'Failed to create attestation');
    } finally {
      setIsAttesting(false);
    }
  };

  // Records table columns
  const recordColumns = [
    {
      header: 'Period',
      accessor: (row: OnChainAttestation) => row.data.periodLabel,
      className: 'font-medium',
    },
    {
      header: 'Return',
      accessor: (row: OnChainAttestation) => {
        const ret = row.data.returnPercent;
        return (
          <span className={ret >= 0 ? 'text-green-400' : 'text-red-400'}>
            {formatPercent(ret, true)}
          </span>
        );
      },
      className: 'tabular-nums',
    },
    {
      header: 'P&L',
      accessor: (row: OnChainAttestation) => {
        const pnl = row.data.pnlUsd;
        return (
          <span className={pnl >= 0 ? 'text-green-400' : 'text-red-400'}>
            {pnl >= 0 ? '+' : ''}{formatUSD(pnl)}
          </span>
        );
      },
      className: 'tabular-nums',
    },
    {
      header: 'Trades',
      accessor: (row: OnChainAttestation) => String(row.data.tradeCount),
      className: 'tabular-nums text-silver',
    },
    {
      header: 'Tx',
      accessor: (row: OnChainAttestation) => (
        <a
          href={getExplorerUrl(row.txSignature, 'tx', cluster)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-electric hover:underline flex items-center gap-1 group"
        >
          View <ExternalLink className="w-3 h-3 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
        </a>
      ),
    },
  ];

  // Format wallet address for display
  const walletAddress = publicKey?.toBase58();
  const shortWallet = walletAddress
    ? `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`
    : '';

  return (
    <div className="flex h-[calc(100vh-64px)]">
      <LeftNav />
      <div className="flex-1 overflow-y-auto p-6">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-wide">ACCOUNTABILITY</h1>
          <p className="text-silver text-sm mt-1">
            Commit to trading rules. Prove your results. Build verifiable trust.
          </p>
        </div>

        {/* Wallet Connection Section - Always visible at top */}
        {!connected ? (
          /* Not Connected - Show prominent connect section */
          <div className="mb-8">
            <div className="bg-gradient-to-br from-charcoal to-charcoal/80 rounded-2xl border border-white/10 overflow-hidden">
              {/* Hero section */}
              <div className="p-8 text-center">
                <div className="w-16 h-16 bg-electric/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <Wallet className="w-8 h-8 text-electric" />
                </div>
                <h2 className="text-xl font-semibold mb-3">Connect Your Wallet to Get Started</h2>
                <p className="text-silver max-w-lg mx-auto mb-6">
                  Your Solana wallet is your identity. Mandates and performance records are tied to your wallet address,
                  allowing anyone to verify your trading rules and results.
                </p>
                <WalletMultiButton className="!bg-electric !text-black hover:!bg-electric/90 !rounded-lg !h-12 !px-8 !font-semibold !text-base" />
              </div>

              {/* Feature highlights */}
              <div className="border-t border-white/10 bg-black/20 p-6">
                <div className="grid grid-cols-3 gap-6">
                  <div className="text-center">
                    <div className="w-10 h-10 bg-white/5 rounded-lg flex items-center justify-center mx-auto mb-3">
                      <Shield className="w-5 h-5 text-electric" />
                    </div>
                    <p className="text-sm font-medium mb-1">Lock In Rules</p>
                    <p className="text-xs text-silver">Commit to trading rules on-chain</p>
                  </div>
                  <div className="text-center">
                    <div className="w-10 h-10 bg-white/5 rounded-lg flex items-center justify-center mx-auto mb-3">
                      <ShieldCheck className="w-5 h-5 text-electric" />
                    </div>
                    <p className="text-sm font-medium mb-1">Enforce Discipline</p>
                    <p className="text-xs text-silver">Hard blocks on rule violations</p>
                  </div>
                  <div className="text-center">
                    <div className="w-10 h-10 bg-white/5 rounded-lg flex items-center justify-center mx-auto mb-3">
                      <BarChart3 className="w-5 h-5 text-electric" />
                    </div>
                    <p className="text-sm font-medium mb-1">Prove Results</p>
                    <p className="text-xs text-silver">Verifiable track record for investors</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Connected - Show wallet status */
          <div className="mb-6 flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-green-500/10 border border-green-500/30 rounded-lg">
              <CheckCircle className="w-4 h-4 text-green-400" />
              <span className="text-sm text-green-400 font-medium">Connected</span>
            </div>
            <code className="text-sm text-silver bg-white/5 px-3 py-1.5 rounded-lg font-mono">
              {shortWallet}
            </code>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('rules')}
            disabled={!connected}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium transition-all ${
              activeTab === 'rules'
                ? 'bg-electric text-black'
                : connected
                  ? 'bg-charcoal border border-white/10 text-silver hover:border-white/20 hover:text-white'
                  : 'bg-charcoal border border-white/5 text-zinc-600 cursor-not-allowed'
            }`}
          >
            <ScrollText className="w-4 h-4" />
            Rules
          </button>
          <button
            onClick={() => setActiveTab('records')}
            disabled={!connected}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg font-medium transition-all ${
              activeTab === 'records'
                ? 'bg-electric text-black'
                : connected
                  ? 'bg-charcoal border border-white/10 text-silver hover:border-white/20 hover:text-white'
                  : 'bg-charcoal border border-white/5 text-zinc-600 cursor-not-allowed'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            Records
            {attestations.length > 0 && (
              <span className="text-xs bg-black/20 px-1.5 py-0.5 rounded">{attestations.length}</span>
            )}
          </button>
        </div>

        {/* Tab Content */}
        {connected ? (
          <div className="space-y-6">
            {activeTab === 'rules' ? (
              /* RULES TAB */
              <>
                {mandateLoading ? (
                  <div className="bg-charcoal rounded-2xl p-12 border border-white/10 flex items-center justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-silver" />
                  </div>
                ) : mandate ? (
                  /* Has Mandate - Show Card */
                  <MandateCard
                    mandate={mandate}
                    violations={violations}
                    violationCount={violationCount}
                    monthlyViolations={monthlyViolations}
                    cluster={cluster}
                  />
                ) : showCreateMandate ? (
                  /* Create Mandate Form */
                  <div className="bg-charcoal rounded-2xl border border-white/10 overflow-hidden">
                    <div className="border-b border-white/10 p-6">
                      <div className="flex items-center gap-3 mb-2">
                        <Shield className="w-6 h-6 text-electric" />
                        <h2 className="text-lg font-semibold">Create Trading Mandate</h2>
                      </div>
                      <p className="text-silver text-sm">
                        Establish binding trading rules that cannot be modified once created.
                      </p>
                    </div>

                    <div className="p-6 space-y-6">
                      {/* Preview of Rules */}
                      <div className="bg-black/50 rounded-xl p-5 border border-white/10">
                        <h3 className="text-sm font-medium text-silver mb-4 uppercase tracking-wide">Mandate Rules</h3>
                        <div className="space-y-3 text-sm">
                          <div className="flex justify-between">
                            <span className="text-silver">Allowed Symbols</span>
                            <span className="font-medium">SPY, SPX</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-silver">Strategy Type</span>
                            <span className="font-medium">SELL (Credit Only)</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-silver">Delta Range</span>
                            <span className="font-medium">0.20 - 0.35</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-silver">Max Daily Loss</span>
                            <span className="font-medium">2% of NAV</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-silver">Overnight Positions</span>
                            <span className="font-medium">Not Allowed (Exit by 3:55 PM ET)</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-silver">Trading Window</span>
                            <span className="font-medium">12:00 PM - 2:00 PM ET (Guideline)</span>
                          </div>
                        </div>
                      </div>

                      {/* Warning */}
                      <div className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                        <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-amber-400 font-medium text-sm mb-1">
                            This mandate is permanent and cannot be modified
                          </p>
                          <p className="text-amber-400/80 text-xs">
                            Once created, these rules will be enforced on all trades. Violations are recorded on-chain. To change rules, you must deactivate this mandate and create a new one.
                          </p>
                        </div>
                      </div>

                      {/* On-Chain Commitment Info */}
                      <div className="flex items-start gap-3 p-4 bg-electric/5 border border-electric/20 rounded-lg">
                        <LinkIcon className="w-5 h-5 text-electric flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-electric font-medium text-sm mb-1">
                            Committed to Solana blockchain
                          </p>
                          <p className="text-electric/70 text-xs">
                            A hash of your mandate will be stored on-chain tied to your wallet. Anyone can verify your rules.
                          </p>
                        </div>
                      </div>

                      {/* Confirmation Input */}
                      <div>
                        <label className="text-silver text-sm mb-2 block">
                          Type <span className="font-mono bg-white/10 px-1.5 py-0.5 rounded text-white">I UNDERSTAND</span> to confirm
                        </label>
                        <input
                          type="text"
                          value={confirmText}
                          onChange={(e) => setConfirmText(e.target.value)}
                          placeholder="I UNDERSTAND"
                          className="w-full px-4 py-3 bg-black border border-white/20 rounded-lg focus:border-electric focus:outline-none transition-colors"
                        />
                        {createMandateError && (
                          <p className="text-red-400 text-sm mt-2">{createMandateError}</p>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center justify-between pt-2">
                        <button
                          onClick={() => {
                            setShowCreateMandate(false);
                            setConfirmText('');
                            setCreateMandateError(null);
                          }}
                          className="px-4 py-2 text-silver hover:text-white transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleCreateMandate}
                          disabled={createMandateLoading || confirmText !== 'I UNDERSTAND'}
                          className="px-6 py-2.5 bg-electric text-black font-semibold rounded-lg hover:bg-electric/90 disabled:bg-zinc-600 disabled:text-zinc-400 disabled:cursor-not-allowed flex items-center gap-2 transition-all"
                        >
                          {createMandateLoading ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Creating...
                            </>
                          ) : (
                            <>
                              <Shield className="w-4 h-4" />
                              Create Mandate
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* No Mandate - Show Create Prompt */
                  <div className="bg-charcoal rounded-2xl border border-white/10 overflow-hidden">
                    <div className="p-8 text-center">
                      <div className="w-16 h-16 bg-electric/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
                        <Shield className="w-8 h-8 text-electric" />
                      </div>
                      <h3 className="text-xl font-semibold mb-3">Create Your Trading Mandate</h3>
                      <p className="text-silver max-w-md mx-auto mb-2">
                        Lock in your trading rules on-chain. Once created, the rules are enforced on every trade -
                        preventing emotional decisions like buying single-stock options.
                      </p>
                      <p className="text-electric/80 text-sm mb-6">
                        Build trust with investors through verifiable discipline.
                      </p>
                      <button
                        onClick={() => setShowCreateMandate(true)}
                        className="px-8 py-3 bg-electric text-black font-semibold rounded-lg hover:bg-electric/90 inline-flex items-center gap-2 transition-all"
                      >
                        <Plus className="w-5 h-5" />
                        Create Mandate
                      </button>
                    </div>

                    {/* What you'll commit to */}
                    <div className="border-t border-white/10 bg-black/20 p-6">
                      <p className="text-silver text-xs uppercase tracking-wide mb-4 text-center">Default Rules</p>
                      <div className="grid grid-cols-3 gap-4 text-center">
                        <div>
                          <p className="font-medium">SPY / SPX Only</p>
                          <p className="text-xs text-silver">No single stocks</p>
                        </div>
                        <div>
                          <p className="font-medium">Credit Spreads</p>
                          <p className="text-xs text-silver">SELL strategies only</p>
                        </div>
                        <div>
                          <p className="font-medium">2% Max Loss</p>
                          <p className="text-xs text-silver">Daily circuit breaker</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              /* RECORDS TAB */
              <>
                {/* Create Record Section */}
                <div className="bg-charcoal rounded-2xl p-6 border border-white/10">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <FileCheck className="w-5 h-5 text-electric" />
                      <h3 className="text-lg font-semibold">Create Performance Record</h3>
                    </div>
                  </div>

                  {/* Period Selector */}
                  <div className="mb-6">
                    <label className="text-silver text-sm mb-2 block">Select Period</label>
                    <div className="flex items-center gap-4">
                      <div className="relative">
                        <button
                          onClick={() => setShowPeriodDropdown(!showPeriodDropdown)}
                          className="flex items-center gap-3 px-4 py-2.5 bg-black border border-white/20 rounded-lg hover:border-white/30 transition-colors min-w-[240px] justify-between"
                        >
                          <div className="flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-silver" />
                            <span>{selectedPeriodInfo?.label}</span>
                          </div>
                          <ChevronDown className={`w-4 h-4 text-silver transition-transform ${showPeriodDropdown ? 'rotate-180' : ''}`} />
                        </button>

                        {showPeriodDropdown && (
                          <div className="absolute top-full left-0 mt-1 w-full bg-black border border-white/20 rounded-lg shadow-xl z-20 overflow-hidden">
                            {periodOptions.map(option => (
                              <button
                                key={option.type}
                                onClick={() => {
                                  setSelectedPeriod(option.type);
                                  setShowPeriodDropdown(false);
                                  setPreviewData(null);
                                }}
                                className={`w-full px-4 py-3 text-left hover:bg-white/10 transition-colors ${
                                  selectedPeriod === option.type ? 'bg-white/5' : ''
                                }`}
                              >
                                <p className="font-medium">{option.label}</p>
                                <p className="text-xs text-silver">{option.dateRange}</p>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <span className="text-silver text-sm">{selectedPeriodInfo?.dateRange}</span>
                    </div>
                  </div>

                  {/* Preview Panel */}
                  {previewData && (
                    <div className="bg-black/50 rounded-xl p-4 border border-white/10 mb-6">
                      <div className="flex items-center gap-2 mb-4">
                        <ShieldCheck className="w-4 h-4 text-electric" />
                        <span className="text-sm font-medium uppercase tracking-wide">Preview</span>
                      </div>

                      {/* Metrics Grid */}
                      <div className="grid grid-cols-4 gap-4 mb-4">
                        <div>
                          <p className="text-silver text-xs mb-1">Return</p>
                          <p className={`text-lg font-medium ${previewData.returnPercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {formatPercent(previewData.returnPercent, true)}
                          </p>
                        </div>
                        <div>
                          <p className="text-silver text-xs mb-1">P&L</p>
                          <p className={`text-lg font-medium ${previewData.pnlUsd >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {previewData.pnlUsd >= 0 ? '+' : ''}{formatUSD(previewData.pnlUsd)}
                          </p>
                        </div>
                        <div>
                          <p className="text-silver text-xs mb-1">Trades</p>
                          <p className="text-lg font-medium">{previewData.tradeCount}</p>
                        </div>
                        <div>
                          <p className="text-silver text-xs mb-1">Notional</p>
                          <p className="text-lg font-medium">{formatUSD(previewData.impliedNotional, true)}</p>
                        </div>
                      </div>

                      {/* Hash and Cost */}
                      <div className="pt-4 border-t border-white/10 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-silver text-xs">Hash:</span>
                          <code className="text-xs font-mono text-silver bg-white/5 px-2 py-0.5 rounded">
                            {previewData.detailsHash.slice(0, 10)}...{previewData.detailsHash.slice(-8)}
                          </code>
                        </div>
                        <span className="text-silver text-xs">Est. Cost: ~0.002 SOL</span>
                      </div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex items-center justify-between">
                    <button
                      onClick={handlePreview}
                      disabled={isPreviewLoading}
                      className="px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20 active:bg-white/15 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      {isPreviewLoading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Loading...
                        </>
                      ) : (
                        'Preview'
                      )}
                    </button>
                    <button
                      onClick={handleAttest}
                      disabled={!previewData || isAttesting}
                      className={`px-6 py-2.5 font-semibold rounded-lg transition-all flex items-center gap-2 ${
                        previewData && !isAttesting
                          ? 'bg-[#00D1FF] text-black hover:bg-[#00B8E0] active:translate-y-px'
                          : 'bg-zinc-700 text-zinc-400 border border-zinc-600 cursor-not-allowed'
                      }`}
                    >
                      {isAttesting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Signing...
                        </>
                      ) : (
                        <>
                          <Zap className="w-4 h-4" />
                          Create Record
                        </>
                      )}
                    </button>
                  </div>

                  {/* Success Message */}
                  {attestSuccess && (
                    <div className="mt-4 p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
                      <div className="flex items-center gap-2 text-green-400 mb-2">
                        <CheckCircle className="w-5 h-5" />
                        <span className="font-semibold">Record Created Successfully!</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-zinc-400">Transaction:</span>
                        <a
                          href={getExplorerUrl(attestSuccess.signature, 'tx', cluster)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-electric hover:underline flex items-center gap-1 font-mono"
                        >
                          {attestSuccess.signature.slice(0, 20)}...{attestSuccess.signature.slice(-8)}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </div>
                  )}

                  {/* Error Message */}
                  {attestError && (
                    <div className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                      <div className="flex items-center gap-2 text-red-400">
                        <AlertCircle className="w-5 h-5" />
                        <span className="text-sm">{attestError}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Records Table */}
                <div className="bg-charcoal rounded-2xl p-6 border border-white/10">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold">
                      On-Chain Records {attestations.length > 0 && `(${attestations.length})`}
                    </h3>
                    {attestationsLoading && (
                      <div className="flex items-center gap-2 text-silver text-sm">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading...
                      </div>
                    )}
                  </div>

                  {attestations.length > 0 ? (
                    <DataTable data={attestations} columns={recordColumns} />
                  ) : (
                    <div className="text-center py-12">
                      <ShieldCheck className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
                      <p className="text-silver">No records yet</p>
                      <p className="text-zinc-500 text-sm mt-1">
                        Create your first record to build your on-chain track record
                      </p>
                    </div>
                  )}
                </div>

                {/* Info Box */}
                <div className="bg-charcoal/50 border border-white/5 rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <Info className="w-5 h-5 text-silver mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-silver text-sm font-medium mb-1">About Performance Records</p>
                      <p className="text-zinc-500 text-sm leading-relaxed">
                        Each record creates an immutable entry on Solana. The hash allows anyone to verify your trading results.
                        Build verifiable credentials for DeFi reputation, fund management, or personal benchmarking.
                      </p>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          /* Not connected - Show disabled tabs preview */
          <div className="bg-charcoal/50 rounded-2xl p-12 border border-white/10 text-center">
            <p className="text-zinc-500">Connect your wallet to access smart contract features</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default DeFi;
