/**
 * DeFi Page - Bloomberg Terminal Style
 *
 * Trading credentials and on-chain attestations.
 * Two-column layout: controls (left), data display (right).
 */

import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWallet } from '@solana/wallet-adapter-react';
// Note: WalletMultiButton removed - using global connect button in top nav
import { LeftNav } from '@/components/LeftNav';
import { MandateSummary } from '@/components/defi/MandateSummary';
import { PeriodSummaryTable } from '@/components/defi/PeriodSummaryTable';
import { TradeLogTable } from '@/components/defi/TradeLogTable';
import { AttestationControls } from '@/components/defi/AttestationControls';
import {
  Loader2,
  Shield,
  AlertCircle,
  Wallet,
} from 'lucide-react';
import type { AttestationData, AttestationPeriod } from '@shared/types/defi';
import type { Mandate, CreateMandateRequest } from '@shared/types/mandate';
import { useWalletContext } from '@/components/WalletProvider';
import { formatUSD } from '@/lib/solana';

// Performance data types
interface PeriodMetrics {
  returnPercent: number;
  pnlUsd: number;
  pnlHkd?: number;  // HKD value for display (matches Trade Log)
  tradeCount: number;
  winRate: number;
}

interface PerformanceData {
  mtd: PeriodMetrics;
  ytd: PeriodMetrics;
  all: PeriodMetrics;
}

// Trade log types (all monetary values in HKD)
interface Trade {
  id: string;
  date: string;
  dateFormatted: string;
  symbol: string;
  strategy: string;
  contracts: number;
  putStrike: number | null;
  callStrike: number | null;
  leg1Premium: number | null;
  leg2Premium: number | null;
  entryPremium: number | null;
  exitPremium: number | null;
  entryTime: string | null;
  exitTime: string | null;
  status: string;
  exitReason?: string;
  realizedPnl: number;
  realizedPnlUSD?: number;
  returnPercent: number;
  // NAV data (in HKD)
  openingNav?: number | null;
  closingNav?: number | null;
  navChange?: number | null;
  dailyReturnPct?: number | null;
  // Notional values (in HKD)
  putNotionalHKD?: number | null;
  callNotionalHKD?: number | null;
  totalNotionalHKD?: number | null;
  // Validation data
  spotPriceAtClose?: number | null;
  validationStatus?: 'verified' | 'pending' | 'discrepancy';
  marginRequired?: number | null;
  maxLoss?: number | null;
  entrySpy?: number | null;
}

// Default mandate values for new creation
const DEFAULT_MANDATE: CreateMandateRequest = {
  allowedSymbols: ['SPY', 'SPX'],
  strategyType: 'SELL',
  minDelta: 0.20,
  maxDelta: 0.35,
  maxDailyLossPercent: 0.02,
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
    sasReady,
    sasError,
    checkingSas,
  } = useWalletContext();

  // Fetch real performance data from trades (not just attestations)
  const { data: performanceResponse, isLoading: performanceLoading } = useQuery<{
    success: boolean;
    data?: PerformanceData;
  }>({
    queryKey: ['/api/defi/performance'],
    queryFn: async () => {
      const response = await fetch('/api/defi/performance', { credentials: 'include' });
      return response.json();
    },
    staleTime: 60_000, // Refresh every minute
  });

  const performanceData = performanceResponse?.data;

  // Fetch trade log
  const { data: tradesResponse, isLoading: tradesLoading } = useQuery<{
    success: boolean;
    trades?: Trade[];
    count?: number;
  }>({
    queryKey: ['/api/defi/trades'],
    queryFn: async () => {
      const response = await fetch('/api/defi/trades', { credentials: 'include' });
      return response.json();
    },
    staleTime: 60_000,
  });

  const trades = tradesResponse?.trades || [];

  // Mandate state
  const [mandate, setMandate] = useState<Mandate | null>(null);
  const [violationCount, setViolationCount] = useState(0);
  const [mandateLoading, setMandateLoading] = useState(true);
  const [showCreateMandate, setShowCreateMandate] = useState(false);
  const [createMandateLoading, setCreateMandateLoading] = useState(false);
  const [createMandateError, setCreateMandateError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');

  // Attestation state
  const [selectedPeriod, setSelectedPeriod] = useState<AttestationPeriod>('last_week');
  const [previewData, setPreviewData] = useState<AttestationData | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  // Fetch mandate on mount
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
        setViolationCount(result.violationCount || 0);
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
      }
    } catch (error) {
      console.error('Error generating preview:', error);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleAttest = async () => {
    if (!previewData || !connected || !sasReady) {
      alert(sasError || 'SAS infrastructure not ready');
      return;
    }
    // TODO: Implement SAS attestation
    alert('SAS attestation coming soon');
  };

  // Compute performance rows with on-chain attestation status
  const periodSummaryRows = useMemo(() => {
    if (!performanceData) return [];

    // Check attestations by matching period label or date range
    const findAttestation = (period: string) => {
      // Try to match by period label in the attestation data
      return attestations.find(a => {
        const label = a.data?.periodLabel?.toUpperCase() || '';
        if (period === 'MTD' && (label.includes('MTD') || label.includes('MONTH'))) return true;
        if (period === 'YTD' && (label.includes('YTD') || label.includes('YEAR'))) return true;
        if (period === 'ALL' && label.includes('ALL')) return true;
        return false;
      });
    };

    return [
      {
        period: 'MTD',
        returnPercent: performanceData.mtd.returnPercent,
        pnlUsd: performanceData.mtd.pnlUsd,
        pnlHkd: performanceData.mtd.pnlHkd,
        tradeCount: performanceData.mtd.tradeCount,
        winRate: performanceData.mtd.winRate,
        isAttested: !!findAttestation('MTD'),
        txHash: findAttestation('MTD')?.txSignature,
      },
      {
        period: 'YTD',
        returnPercent: performanceData.ytd.returnPercent,
        pnlUsd: performanceData.ytd.pnlUsd,
        pnlHkd: performanceData.ytd.pnlHkd,
        tradeCount: performanceData.ytd.tradeCount,
        winRate: performanceData.ytd.winRate,
        isAttested: !!findAttestation('YTD'),
        txHash: findAttestation('YTD')?.txSignature,
      },
      {
        period: 'ALL',
        returnPercent: performanceData.all.returnPercent,
        pnlUsd: performanceData.all.pnlUsd,
        pnlHkd: performanceData.all.pnlHkd,
        tradeCount: performanceData.all.tradeCount,
        winRate: performanceData.all.winRate,
        isAttested: !!findAttestation('ALL'),
        txHash: findAttestation('ALL')?.txSignature,
      },
    ];
  }, [performanceData, attestations]);

  return (
    <div className="flex h-[calc(100vh-64px)]">
      <LeftNav />

      <div className="flex-1 bg-terminal overflow-hidden">
        {/* Header Bar */}
        <div className="h-12 border-b border-terminal flex items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-medium uppercase tracking-wide text-terminal-bright">
              Trading Credentials
            </h1>
            <span className={`text-xs px-2 py-0.5 ${
              cluster === 'devnet'
                ? 'bg-bloomberg-amber/20 text-bloomberg-amber'
                : 'bg-bloomberg-green/20 text-bloomberg-green'
            }`}>
              {cluster === 'devnet' ? 'DEVNET' : 'MAINNET'}
            </span>
          </div>

        </div>

        {/* Main Content - Two Column Grid */}
        <div className="h-[calc(100%-48px)] overflow-y-auto p-4">
          <div className="grid grid-cols-12 gap-4 w-full">

            {/* Left Column - Controls (4 cols) */}
            <div className="col-span-4 space-y-4">
              <MandateSummary
                mandate={mandate}
                violationCount={violationCount}
                onCreateClick={() => setShowCreateMandate(true)}
                loading={mandateLoading}
              />

              <AttestationControls
                selectedPeriod={selectedPeriod}
                onPeriodChange={(p) => {
                  setSelectedPeriod(p);
                  setPreviewData(null);
                }}
                onPreview={handlePreview}
                onAttest={handleAttest}
                isLoading={isPreviewLoading}
                hasPreview={!!previewData}
                sasReady={sasReady}
                disabled={!connected}
              />

              {/* Preview Data */}
              {previewData && (
                <div className="bg-terminal-panel terminal-grid p-4">
                  <div className="text-xs uppercase tracking-wide text-terminal-dim mb-3">Preview</div>
                  <div className="space-y-2 text-xs font-mono">
                    <div className="flex justify-between">
                      <span className="text-terminal-dim">Return</span>
                      <span className={previewData.returnPercent >= 0 ? 'text-bloomberg-green' : 'text-bloomberg-red'}>
                        {previewData.returnPercent >= 0 ? '+' : ''}{previewData.returnPercent.toFixed(2)}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-terminal-dim">P&L</span>
                      <span className={previewData.pnlUsd >= 0 ? 'text-bloomberg-green' : 'text-bloomberg-red'}>
                        {formatUSD(previewData.pnlUsd)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-terminal-dim">Trades</span>
                      <span className="text-terminal-bright">{previewData.tradeCount}</span>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-terminal">
                      <span className="text-terminal-dim">Hash</span>
                      <code className="text-terminal-dim">
                        {previewData.detailsHash.slice(0, 8)}...
                      </code>
                    </div>
                  </div>
                </div>
              )}

              {/* Chain Status */}
              <div className="bg-terminal-panel terminal-grid p-4">
                <div className="text-xs uppercase tracking-wide text-terminal-dim mb-3">Chain Status</div>
                <div className="space-y-2 text-xs font-mono">
                  <div className="flex justify-between">
                    <span className="text-terminal-dim">SAS</span>
                    <span className={sasReady ? 'text-bloomberg-green' : 'text-bloomberg-amber'}>
                      {checkingSas ? 'Checking...' : sasReady ? 'Ready' : 'Setup Required'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-terminal-dim">Cluster</span>
                    <span className={cluster === 'mainnet-beta' ? 'text-bloomberg-green' : 'text-bloomberg-amber'}>
                      {cluster === 'devnet' ? 'Devnet' : 'Mainnet'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-terminal-dim">Records</span>
                    <span className="text-terminal-bright">{attestations.length}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column - Data Display (8 cols) */}
            <div className="col-span-8 space-y-4">
              <PeriodSummaryTable
                rows={periodSummaryRows}
                cluster={cluster}
                loading={performanceLoading}
                onAttest={(period) => {
                  // Set period for attestation preview
                  // Note: For YTD and ALL, we use 'custom' which allows date range selection
                  const periodToType: Record<string, AttestationPeriod> = {
                    'MTD': 'mtd',
                    'YTD': 'custom',  // Custom date range for YTD
                    'ALL': 'custom',  // Custom date range for ALL
                  };
                  setSelectedPeriod(periodToType[period] || 'last_month');
                }}
              />

              <TradeLogTable
                trades={trades}
                loading={tradesLoading}
              />
            </div>
          </div>
        </div>

        {/* Create Mandate Modal */}
        {showCreateMandate && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
            <div className="bg-terminal-panel terminal-grid max-w-lg w-full max-h-[90vh] overflow-y-auto">
              <div className="p-4 border-b border-terminal flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-bloomberg-blue" />
                  <span className="text-sm font-medium uppercase tracking-wide">Create Mandate</span>
                </div>
                <button
                  onClick={() => {
                    setShowCreateMandate(false);
                    setConfirmText('');
                    setCreateMandateError(null);
                  }}
                  className="text-terminal-dim hover:text-terminal-bright text-xl"
                >
                  ×
                </button>
              </div>

              <div className="p-4 border-b border-terminal">
                <div className="text-xs uppercase tracking-wide text-terminal-dim mb-3">Rules</div>
                <div className="space-y-2 text-xs font-mono">
                  <div className="flex justify-between">
                    <span className="text-terminal-dim">Symbols</span>
                    <span className="text-terminal-bright">SPY, SPX</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-terminal-dim">Strategy</span>
                    <span className="text-terminal-bright">SELL only</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-terminal-dim">Delta</span>
                    <span className="text-terminal-bright">0.20 – 0.35</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-terminal-dim">Max Loss</span>
                    <span className="text-terminal-bright">2%/day</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-terminal-dim">Overnight</span>
                    <span className="text-bloomberg-red">NOT ALLOWED</span>
                  </div>
                </div>
              </div>

              <div className="p-4 border-b border-terminal bg-bloomberg-amber/10">
                <div className="flex items-start gap-2 text-xs text-bloomberg-amber">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium mb-1">This mandate is permanent</p>
                    <p className="text-bloomberg-amber/80">Cannot be modified once created.</p>
                  </div>
                </div>
              </div>

              <div className="p-4">
                <label className="text-xs text-terminal-dim mb-2 block">
                  Type <code className="bg-white/10 px-1">I UNDERSTAND</code> to confirm
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="I UNDERSTAND"
                  className="w-full px-3 py-2 bg-terminal border border-terminal text-sm text-terminal-bright focus:border-bloomberg-blue focus:outline-none"
                />
                {createMandateError && (
                  <p className="text-xs text-bloomberg-red mt-2">{createMandateError}</p>
                )}

                <div className="flex gap-2 mt-4">
                  <button
                    onClick={() => {
                      setShowCreateMandate(false);
                      setConfirmText('');
                      setCreateMandateError(null);
                    }}
                    className="flex-1 px-3 py-2 text-xs uppercase tracking-wide border border-terminal text-terminal-dim hover:text-terminal-bright"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateMandate}
                    disabled={createMandateLoading || confirmText !== 'I UNDERSTAND'}
                    className="flex-1 px-3 py-2 text-xs uppercase tracking-wide bg-bloomberg-blue text-black font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {createMandateLoading ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      'Create'
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default DeFi;
