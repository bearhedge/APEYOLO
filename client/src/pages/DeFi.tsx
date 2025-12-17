/**
 * DeFi Page
 *
 * On-chain records of trading track records on Solana.
 * Sections: Trading Mandate, Create Record, Records Table, Info Box
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
  Lock,
  Shield,
  Plus,
  AlertCircle,
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
import { getSasExplorerUrl } from '@/lib/sas-client';

// Period option type for the selector
interface PeriodOption {
  type: AttestationPeriod;
  label: string;
  dateRange?: string;
}

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
  const { connected } = useWallet();
  const {
    attestations,
    loading: attestationsLoading,
    cluster,
    // SAS Integration
    sasReady,
    sasError,
    checkingSas,
    userHasMandate,
    mandateData,
  } = useWalletContext();

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

  // Fetch mandate data on mount
  useEffect(() => {
    fetchMandate();
  }, []);

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

  // Submit attestation to Solana via SAS
  const handleAttest = async () => {
    if (!previewData || !connected) return;

    if (!sasReady) {
      alert(
        'Solana Attestation Service infrastructure not ready.\n\n' +
        (sasError || 'Admin setup required: Credential and Schema must be created first.')
      );
      return;
    }

    // TODO: Implement SAS attestation transaction
    // 1. Create attestation data from previewData
    // 2. Call createAttestation from WalletProvider
    // 3. Show success with explorer link
    alert(
      'SAS infrastructure detected!\n\n' +
      'Attestation creation will be enabled once the admin creates the APEYOLO credential and schema on-chain.'
    );
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

  return (
    <div className="flex h-[calc(100vh-64px)]">
      <LeftNav />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Page Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-wide">DEFI</h1>
          <p className="text-silver text-sm mt-1">
            Trading mandates and on-chain attestations
          </p>
        </div>

        {/* Section 0: Trading Mandate */}
        <div className="mb-6">
          {mandateLoading ? (
            <div className="bg-charcoal rounded-2xl p-12 border border-white/10 flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-silver" />
            </div>
          ) : mandate ? (
            <MandateCard
              mandate={mandate}
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
                      Once created, these rules will be enforced on all trades. To change rules, you must deactivate this mandate and create a new one.
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
                    className="px-6 py-2 bg-electric text-black font-medium rounded-lg hover:bg-electric/90 disabled:bg-zinc-600 disabled:text-zinc-400 disabled:cursor-not-allowed flex items-center gap-2"
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
            /* No Mandate - Show Create Button */
            <div className="bg-charcoal rounded-2xl p-8 border border-white/10 text-center">
              <Shield className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No Trading Mandate</h3>
              <p className="text-silver text-sm mb-6 max-w-md mx-auto">
                Create a trading mandate to enforce disciplined trading rules. Mandates are permanent and recorded on-chain for transparency.
              </p>
              <button
                onClick={() => setShowCreateMandate(true)}
                className="px-6 py-2.5 bg-electric text-black font-medium rounded-lg hover:bg-electric/90 inline-flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Create Mandate
              </button>
            </div>
          )}
        </div>

        {/* Section 1: Create Record */}
        <div className={`bg-charcoal rounded-2xl p-6 border border-white/10 relative ${!connected ? 'overflow-hidden' : ''}`}>
          {/* Blur overlay when not connected */}
          {!connected && (
            <div className="absolute inset-0 bg-charcoal/80 backdrop-blur-sm z-10 flex items-center justify-center rounded-2xl">
              <div className="text-center">
                <Lock className="w-8 h-8 text-zinc-500 mx-auto mb-3" />
                <p className="text-silver text-sm mb-3">Connect wallet to create records</p>
                <WalletMultiButton className="!bg-electric !text-black hover:!bg-electric/90 !rounded-lg !h-10 !px-6 !font-medium !text-sm" />
              </div>
            </div>
          )}

          {/* Card Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <FileCheck className="w-5 h-5 text-electric" />
              <h3 className="text-lg font-semibold">Create Record</h3>
            </div>
            <div className="flex items-center gap-2">
              {/* SAS Status Badge */}
              {checkingSas ? (
                <span className="px-2 py-1 text-xs rounded-full bg-zinc-500/20 text-zinc-400 border border-zinc-500/30 flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  SAS
                </span>
              ) : sasReady ? (
                <span className="px-2 py-1 text-xs rounded-full bg-green-500/20 text-green-400 border border-green-500/30 flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  SAS Ready
                </span>
              ) : (
                <span
                  className="px-2 py-1 text-xs rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center gap-1 cursor-help"
                  title={sasError || 'SAS infrastructure not ready'}
                >
                  <AlertCircle className="w-3 h-3" />
                  SAS Pending
                </span>
              )}
              {/* Cluster Badge */}
              <span className={`px-2 py-1 text-xs rounded-full ${
                cluster === 'devnet'
                  ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                  : 'bg-green-500/20 text-green-400 border border-green-500/30'
              }`}>
                {cluster === 'devnet' ? 'Devnet' : 'Mainnet'}
              </span>
            </div>
          </div>

          {/* Period Selector */}
          <div className="mb-6">
            <label className="text-silver text-sm mb-2 block">Select Period</label>
            <div className="flex items-center gap-4">
              <div className="relative">
                <button
                  onClick={() => connected && setShowPeriodDropdown(!showPeriodDropdown)}
                  disabled={!connected}
                  className="flex items-center gap-3 px-4 py-2.5 bg-black border border-white/20 rounded-lg hover:border-white/30 transition-colors min-w-[240px] justify-between disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-silver" />
                    <span>{selectedPeriodInfo?.label}</span>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-silver transition-transform ${showPeriodDropdown ? 'rotate-180' : ''}`} />
                </button>

                {showPeriodDropdown && connected && (
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
              disabled={isPreviewLoading || !connected}
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
              disabled={!previewData || !connected || checkingSas}
              className={`px-6 py-2 font-medium rounded-lg transition-all flex items-center gap-2 ${
                !sasReady && !checkingSas
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30'
                  : 'bg-electric text-black hover:bg-electric/90 active:bg-electric/80 active:translate-y-px disabled:bg-zinc-600 disabled:text-zinc-400'
              } disabled:cursor-not-allowed`}
            >
              {checkingSas ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Checking SAS...
                </>
              ) : !sasReady ? (
                <>
                  <AlertCircle className="w-4 h-4" />
                  SAS Setup Required
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  Create Record
                </>
              )}
            </button>
          </div>
        </div>

        {/* Section 2: Records Table */}
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

        {/* Section 3: Info Box */}
        <div className="bg-charcoal/50 border border-white/5 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-silver mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-silver text-sm font-medium mb-1">About On-Chain Records</p>
              <p className="text-zinc-500 text-sm leading-relaxed">
                Records are created using the <a href="https://attest.solana.com" target="_blank" rel="noopener noreferrer" className="text-electric hover:underline">Solana Attestation Service (SAS)</a>—the
                official protocol for verifiable credentials on Solana. Each attestation creates an immutable, queryable entry
                that anyone can verify. Build your on-chain track record for DeFi reputation, fund management, or personal benchmarking.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DeFi;
