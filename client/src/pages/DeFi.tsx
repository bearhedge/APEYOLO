/**
 * DeFi Page - Bloomberg Terminal Style
 *
 * Trading credentials and on-chain attestations.
 * Two-column layout: controls (left), data display (right).
 */

import { useState, useMemo, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { LeftNav } from '@/components/LeftNav';
import { MandateSummary } from '@/components/defi/MandateSummary';
import { PerformanceGrid } from '@/components/defi/PerformanceGrid';
import { AttestationControls } from '@/components/defi/AttestationControls';
import { RecordsTable } from '@/components/defi/RecordsTable';
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

  // Compute performance rows from attestations
  const performanceRows = useMemo(() => {
    if (attestations.length === 0) return [];

    const totalReturn = attestations.reduce((sum, a) => sum + (a.data.returnPercent || 0), 0);
    const totalPnl = attestations.reduce((sum, a) => sum + (a.data.pnlUsd || 0), 0);
    const totalTrades = attestations.reduce((sum, a) => sum + (a.data.tradeCount || 0), 0);
    const avgWinRate = attestations.reduce((sum, a) => sum + (a.data.winRate || 0), 0) / attestations.length;

    // Find most recent MTD attestation
    const mtdAtt = attestations.find(a => a.data.periodLabel?.toLowerCase().includes('mtd'));

    const rows = [];

    if (mtdAtt) {
      rows.push({
        label: 'MTD',
        returnPercent: mtdAtt.data.returnPercent,
        pnlUsd: mtdAtt.data.pnlUsd,
        tradeCount: mtdAtt.data.tradeCount,
        winRate: mtdAtt.data.winRate,
      });
    }

    rows.push({
      label: 'YTD',
      returnPercent: totalReturn,
      pnlUsd: totalPnl,
      tradeCount: totalTrades,
      winRate: avgWinRate,
    });

    rows.push({
      label: 'ALL',
      returnPercent: totalReturn,
      pnlUsd: totalPnl,
      tradeCount: totalTrades,
      winRate: avgWinRate,
    });

    return rows;
  }, [attestations]);

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

          <div className="flex items-center gap-4">
            {connected ? (
              <div className="flex items-center gap-2 text-xs text-bloomberg-green">
                <Wallet className="w-3 h-3" />
                <span>Connected</span>
              </div>
            ) : (
              <WalletMultiButton className="!bg-bloomberg-blue !text-black !text-xs !h-8 !px-3 !rounded-none !font-medium" />
            )}
          </div>
        </div>

        {/* Main Content - Two Column Grid */}
        <div className="h-[calc(100%-48px)] overflow-y-auto p-4">
          <div className="grid grid-cols-12 gap-4 max-w-7xl">

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
              <PerformanceGrid
                rows={performanceRows}
                loading={attestationsLoading}
              />

              <RecordsTable
                records={attestations}
                cluster={cluster}
                loading={attestationsLoading}
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
