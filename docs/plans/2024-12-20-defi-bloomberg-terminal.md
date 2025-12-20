# DeFi Page Bloomberg Terminal Redesign

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the DeFi page from a boring utility into a Bloomberg terminal-style professional trading credential display.

**Architecture:** Two-column grid layout with mandate summary (left) and performance metrics (right). Dense data presentation with monospace numbers, sharp corners, thin grid lines. Future phases add Agent integration and public shareable profiles.

**Tech Stack:** React, Tailwind CSS (existing), Lucide icons (existing)

---

## Task 1: Add Bloomberg Color Variables

**Files:**
- Modify: `client/src/index.css:41-60`

**Step 1: Add new Bloomberg-inspired color classes**

Add after line 60 in index.css:

```css
/* Bloomberg Terminal Colors */
.bg-terminal {
  background-color: #0a0a0a;
}

.bg-terminal-panel {
  background-color: #111111;
}

.border-terminal {
  border-color: #1a1a1a;
}

.text-terminal-bright {
  color: #f5f5f5;
}

.text-terminal-dim {
  color: #888888;
}

/* Bloomberg accent colors */
.text-bloomberg-green {
  color: #00d26a;
}

.text-bloomberg-red {
  color: #ff4757;
}

.text-bloomberg-amber {
  color: #ffa502;
}

.text-bloomberg-blue {
  color: #0095ff;
}

/* Terminal grid effect */
.terminal-grid {
  border: 1px solid #1a1a1a;
}

.terminal-grid-dense {
  background-image:
    linear-gradient(#1a1a1a 1px, transparent 1px),
    linear-gradient(90deg, #1a1a1a 1px, transparent 1px);
  background-size: 1px 1px;
}
```

**Step 2: Verify CSS loads correctly**

Run: `npm run dev`
Expected: App loads without CSS errors

**Step 3: Commit**

```bash
git add client/src/index.css
git commit -m "feat(defi): add Bloomberg terminal color classes"
```

---

## Task 2: Create PerformanceGrid Component

**Files:**
- Create: `client/src/components/defi/PerformanceGrid.tsx`

**Step 1: Create the component file**

```tsx
/**
 * PerformanceGrid - Bloomberg-style performance metrics display
 *
 * Dense, monospace, right-aligned numbers with period rows.
 */

import { formatUSD, formatPercent } from '@/lib/solana';

interface PerformanceRow {
  label: string;
  returnPercent: number;
  pnlUsd: number;
  tradeCount: number;
  winRate?: number;
  sharpe?: number;
}

interface PerformanceGridProps {
  rows: PerformanceRow[];
  loading?: boolean;
}

export function PerformanceGrid({ rows, loading }: PerformanceGridProps) {
  if (loading) {
    return (
      <div className="bg-terminal-panel terminal-grid p-4">
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-6 bg-white/5 rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-terminal-panel terminal-grid">
      {/* Header Row */}
      <div className="grid grid-cols-5 gap-2 px-4 py-2 border-b border-terminal text-xs text-terminal-dim uppercase tracking-wide">
        <div>Period</div>
        <div className="text-right">Return</div>
        <div className="text-right">P&L</div>
        <div className="text-right">Trades</div>
        <div className="text-right">Win %</div>
      </div>

      {/* Data Rows */}
      {rows.map((row, i) => (
        <div
          key={row.label}
          className={`grid grid-cols-5 gap-2 px-4 py-2 text-sm font-mono ${
            i < rows.length - 1 ? 'border-b border-terminal' : ''
          }`}
        >
          <div className="text-terminal-dim">{row.label}</div>
          <div className={`text-right tabular-nums font-medium ${
            row.returnPercent >= 0 ? 'text-bloomberg-green' : 'text-bloomberg-red'
          }`}>
            {row.returnPercent >= 0 ? '+' : ''}{row.returnPercent.toFixed(2)}%
          </div>
          <div className={`text-right tabular-nums ${
            row.pnlUsd >= 0 ? 'text-bloomberg-green' : 'text-bloomberg-red'
          }`}>
            {row.pnlUsd >= 0 ? '+' : ''}{formatUSD(row.pnlUsd)}
          </div>
          <div className="text-right tabular-nums text-terminal-bright">
            {row.tradeCount}
          </div>
          <div className="text-right tabular-nums text-terminal-dim">
            {row.winRate !== undefined ? `${(row.winRate * 100).toFixed(0)}%` : '—'}
          </div>
        </div>
      ))}

      {/* Empty State */}
      {rows.length === 0 && (
        <div className="px-4 py-8 text-center text-terminal-dim text-sm">
          No performance data available
        </div>
      )}
    </div>
  );
}
```

**Step 2: Verify component compiles**

Run: `npm run typecheck`
Expected: No type errors

**Step 3: Commit**

```bash
git add client/src/components/defi/PerformanceGrid.tsx
git commit -m "feat(defi): add PerformanceGrid component"
```

---

## Task 3: Create Compact MandateSummary Component

**Files:**
- Create: `client/src/components/defi/MandateSummary.tsx`

**Step 1: Create the compact mandate display**

```tsx
/**
 * MandateSummary - Compact spec-sheet style mandate display
 *
 * Always visible, dense, terminal-style.
 */

import { Shield, AlertTriangle } from 'lucide-react';
import type { Mandate } from '@shared/types/mandate';

interface MandateSummaryProps {
  mandate: Mandate | null;
  violationCount?: number;
  onCreateClick?: () => void;
  loading?: boolean;
}

export function MandateSummary({
  mandate,
  violationCount = 0,
  onCreateClick,
  loading,
}: MandateSummaryProps) {
  if (loading) {
    return (
      <div className="bg-terminal-panel terminal-grid p-4">
        <div className="animate-pulse space-y-2">
          <div className="h-4 bg-white/5 rounded w-1/2" />
          <div className="h-3 bg-white/5 rounded w-3/4" />
          <div className="h-3 bg-white/5 rounded w-2/3" />
        </div>
      </div>
    );
  }

  if (!mandate) {
    return (
      <div className="bg-terminal-panel terminal-grid p-4">
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-4 h-4 text-terminal-dim" />
          <span className="text-xs uppercase tracking-wide text-terminal-dim">Mandate</span>
        </div>
        <p className="text-sm text-terminal-dim mb-3">No active mandate</p>
        <button
          onClick={onCreateClick}
          className="text-xs text-bloomberg-blue hover:underline"
        >
          + Create Mandate
        </button>
      </div>
    );
  }

  return (
    <div className="bg-terminal-panel terminal-grid p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-bloomberg-green" />
          <span className="text-xs uppercase tracking-wide text-terminal-dim">Mandate</span>
        </div>
        <span className="text-xs text-bloomberg-green">ACTIVE</span>
      </div>

      {/* Spec Grid */}
      <div className="space-y-1.5 text-xs font-mono">
        <div className="flex justify-between">
          <span className="text-terminal-dim">Symbols</span>
          <span className="text-terminal-bright">{mandate.allowedSymbols.join(', ')}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-terminal-dim">Strategy</span>
          <span className="text-terminal-bright">{mandate.strategyType} only</span>
        </div>
        <div className="flex justify-between">
          <span className="text-terminal-dim">Delta</span>
          <span className="text-terminal-bright tabular-nums">
            {mandate.minDelta.toFixed(2)} – {mandate.maxDelta.toFixed(2)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-terminal-dim">Max Loss</span>
          <span className="text-terminal-bright tabular-nums">
            {(mandate.maxDailyLossPercent * 100).toFixed(0)}%/day
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-terminal-dim">Overnight</span>
          <span className={mandate.noOvernightPositions ? 'text-bloomberg-red' : 'text-terminal-bright'}>
            {mandate.noOvernightPositions ? 'NOT ALLOWED' : 'Allowed'}
          </span>
        </div>
      </div>

      {/* Violations */}
      <div className="mt-3 pt-3 border-t border-terminal flex items-center justify-between">
        <span className="text-xs text-terminal-dim">Violations</span>
        <span className={`text-xs font-mono ${
          violationCount > 0 ? 'text-bloomberg-red' : 'text-bloomberg-green'
        }`}>
          {violationCount > 0 && <AlertTriangle className="w-3 h-3 inline mr-1" />}
          {violationCount}
        </span>
      </div>
    </div>
  );
}
```

**Step 2: Verify component compiles**

Run: `npm run typecheck`
Expected: No type errors

**Step 3: Commit**

```bash
git add client/src/components/defi/MandateSummary.tsx
git commit -m "feat(defi): add MandateSummary compact component"
```

---

## Task 4: Create AttestationControls Component

**Files:**
- Create: `client/src/components/defi/AttestationControls.tsx`

**Step 1: Create the compact attestation controls**

```tsx
/**
 * AttestationControls - Compact period selector and attest button
 */

import { useState } from 'react';
import { ChevronDown, Zap, Loader2 } from 'lucide-react';
import type { AttestationPeriod } from '@shared/types/defi';

interface AttestationControlsProps {
  selectedPeriod: AttestationPeriod;
  onPeriodChange: (period: AttestationPeriod) => void;
  onAttest: () => void;
  onPreview: () => void;
  isLoading?: boolean;
  hasPreview?: boolean;
  sasReady?: boolean;
  disabled?: boolean;
}

const PERIODS: { type: AttestationPeriod; label: string }[] = [
  { type: 'mtd', label: 'MTD' },
  { type: 'last_week', label: 'Last Week' },
  { type: 'last_month', label: 'Last Month' },
];

export function AttestationControls({
  selectedPeriod,
  onPeriodChange,
  onAttest,
  onPreview,
  isLoading,
  hasPreview,
  sasReady,
  disabled,
}: AttestationControlsProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const selectedLabel = PERIODS.find(p => p.type === selectedPeriod)?.label || 'Select';

  return (
    <div className="bg-terminal-panel terminal-grid p-4">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="w-4 h-4 text-bloomberg-blue" />
        <span className="text-xs uppercase tracking-wide text-terminal-dim">Attest</span>
      </div>

      {/* Period Selector */}
      <div className="relative mb-3">
        <button
          onClick={() => !disabled && setShowDropdown(!showDropdown)}
          disabled={disabled}
          className="w-full flex items-center justify-between px-3 py-2 bg-terminal border border-terminal text-sm text-terminal-bright disabled:opacity-50"
        >
          <span>{selectedLabel}</span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
        </button>

        {showDropdown && (
          <div className="absolute top-full left-0 right-0 mt-1 bg-terminal border border-terminal z-10">
            {PERIODS.map(p => (
              <button
                key={p.type}
                onClick={() => {
                  onPeriodChange(p.type);
                  setShowDropdown(false);
                }}
                className={`w-full px-3 py-2 text-left text-sm hover:bg-white/5 ${
                  selectedPeriod === p.type ? 'text-bloomberg-blue' : 'text-terminal-bright'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        <button
          onClick={onPreview}
          disabled={disabled || isLoading}
          className="flex-1 px-3 py-2 text-xs uppercase tracking-wide border border-terminal text-terminal-dim hover:text-terminal-bright hover:border-white/30 disabled:opacity-50 transition-colors"
        >
          Preview
        </button>
        <button
          onClick={onAttest}
          disabled={disabled || isLoading || !hasPreview || !sasReady}
          className="flex-1 px-3 py-2 text-xs uppercase tracking-wide bg-bloomberg-blue text-black font-medium disabled:opacity-50 disabled:bg-terminal disabled:text-terminal-dim transition-colors flex items-center justify-center gap-1"
        >
          {isLoading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            'Attest'
          )}
        </button>
      </div>

      {/* Status */}
      <div className="mt-3 pt-3 border-t border-terminal flex items-center justify-between text-xs">
        <span className="text-terminal-dim">SAS</span>
        <span className={sasReady ? 'text-bloomberg-green' : 'text-bloomberg-amber'}>
          {sasReady ? 'Ready' : 'Pending'}
        </span>
      </div>
    </div>
  );
}
```

**Step 2: Verify component compiles**

Run: `npm run typecheck`
Expected: No type errors

**Step 3: Commit**

```bash
git add client/src/components/defi/AttestationControls.tsx
git commit -m "feat(defi): add AttestationControls component"
```

---

## Task 5: Create RecordsTable Component

**Files:**
- Create: `client/src/components/defi/RecordsTable.tsx`

**Step 1: Create the dense records table**

```tsx
/**
 * RecordsTable - Dense Bloomberg-style on-chain records display
 */

import { ExternalLink } from 'lucide-react';
import type { OnChainAttestation } from '@shared/types/defi';
import { formatUSD, formatPercent, getExplorerUrl } from '@/lib/solana';

interface RecordsTableProps {
  records: OnChainAttestation[];
  cluster: 'devnet' | 'mainnet-beta';
  loading?: boolean;
}

export function RecordsTable({ records, cluster, loading }: RecordsTableProps) {
  if (loading) {
    return (
      <div className="bg-terminal-panel terminal-grid">
        <div className="px-4 py-3 border-b border-terminal">
          <span className="text-xs uppercase tracking-wide text-terminal-dim">On-Chain Records</span>
        </div>
        <div className="p-4 animate-pulse space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-8 bg-white/5 rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-terminal-panel terminal-grid">
      {/* Header */}
      <div className="px-4 py-3 border-b border-terminal flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-terminal-dim">
          On-Chain Records ({records.length})
        </span>
        <span className={`text-xs ${cluster === 'devnet' ? 'text-bloomberg-amber' : 'text-bloomberg-green'}`}>
          {cluster === 'devnet' ? 'DEVNET' : 'MAINNET'}
        </span>
      </div>

      {/* Table Header */}
      <div className="grid grid-cols-5 gap-2 px-4 py-2 border-b border-terminal text-xs text-terminal-dim uppercase tracking-wide">
        <div>Period</div>
        <div className="text-right">Return</div>
        <div className="text-right">P&L</div>
        <div className="text-right">Trades</div>
        <div className="text-right">Tx</div>
      </div>

      {/* Records */}
      {records.length > 0 ? (
        <div className="max-h-64 overflow-y-auto">
          {records.map((record, i) => (
            <div
              key={record.txSignature}
              className={`grid grid-cols-5 gap-2 px-4 py-2 text-xs font-mono hover:bg-white/5 ${
                i < records.length - 1 ? 'border-b border-terminal' : ''
              }`}
            >
              <div className="text-terminal-bright truncate">{record.data.periodLabel}</div>
              <div className={`text-right tabular-nums ${
                record.data.returnPercent >= 0 ? 'text-bloomberg-green' : 'text-bloomberg-red'
              }`}>
                {record.data.returnPercent >= 0 ? '+' : ''}{record.data.returnPercent.toFixed(2)}%
              </div>
              <div className={`text-right tabular-nums ${
                record.data.pnlUsd >= 0 ? 'text-bloomberg-green' : 'text-bloomberg-red'
              }`}>
                {formatUSD(record.data.pnlUsd)}
              </div>
              <div className="text-right tabular-nums text-terminal-dim">
                {record.data.tradeCount}
              </div>
              <div className="text-right">
                <a
                  href={getExplorerUrl(record.txSignature, 'tx', cluster)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-bloomberg-blue hover:underline inline-flex items-center gap-0.5"
                >
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-4 py-8 text-center text-terminal-dim text-xs">
          No on-chain records yet
        </div>
      )}
    </div>
  );
}
```

**Step 2: Verify component compiles**

Run: `npm run typecheck`
Expected: No type errors

**Step 3: Commit**

```bash
git add client/src/components/defi/RecordsTable.tsx
git commit -m "feat(defi): add RecordsTable component"
```

---

## Task 6: Refactor DeFi Page Layout

**Files:**
- Modify: `client/src/pages/DeFi.tsx`

**Step 1: Update imports at top of file**

Replace lines 11-27 with:

```tsx
import { LeftNav } from '@/components/LeftNav';
import { MandateSummary } from '@/components/defi/MandateSummary';
import { PerformanceGrid } from '@/components/defi/PerformanceGrid';
import { AttestationControls } from '@/components/defi/AttestationControls';
import { RecordsTable } from '@/components/defi/RecordsTable';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import {
  Loader2,
  Lock,
  Shield,
  Plus,
  AlertCircle,
  Wallet,
} from 'lucide-react';
```

**Step 2: Replace the entire return JSX (lines 277-651)**

Replace with the new two-column Bloomberg layout:

```tsx
  // Compute performance rows from attestations
  const performanceRows = useMemo(() => {
    // Group attestations by period type for summary
    const mtdAtts = attestations.filter(a => a.data.periodLabel?.includes('MTD'));
    const lastMtd = mtdAtts[0];

    // Calculate totals
    const totalReturn = attestations.reduce((sum, a) => sum + (a.data.returnPercent || 0), 0);
    const totalPnl = attestations.reduce((sum, a) => sum + (a.data.pnlUsd || 0), 0);
    const totalTrades = attestations.reduce((sum, a) => sum + (a.data.tradeCount || 0), 0);
    const avgWinRate = attestations.length > 0
      ? attestations.reduce((sum, a) => sum + (a.data.winRate || 0), 0) / attestations.length
      : 0;

    return [
      lastMtd ? {
        label: 'MTD',
        returnPercent: lastMtd.data.returnPercent,
        pnlUsd: lastMtd.data.pnlUsd,
        tradeCount: lastMtd.data.tradeCount,
        winRate: lastMtd.data.winRate,
      } : null,
      {
        label: 'YTD',
        returnPercent: totalReturn,
        pnlUsd: totalPnl,
        tradeCount: totalTrades,
        winRate: avgWinRate,
      },
      {
        label: 'ALL',
        returnPercent: totalReturn,
        pnlUsd: totalPnl,
        tradeCount: totalTrades,
        winRate: avgWinRate,
      },
    ].filter(Boolean) as any[];
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
              {/* Mandate Summary */}
              <MandateSummary
                mandate={mandate}
                violationCount={violationCount}
                onCreateClick={() => setShowCreateMandate(true)}
                loading={mandateLoading}
              />

              {/* Attestation Controls */}
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

              {/* Preview Data (if exists) */}
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
              {/* Performance Grid */}
              <PerformanceGrid
                rows={performanceRows}
                loading={attestationsLoading}
              />

              {/* Records Table */}
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
              {/* Modal Header */}
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
                  className="text-terminal-dim hover:text-terminal-bright"
                >
                  ×
                </button>
              </div>

              {/* Mandate Rules Preview */}
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

              {/* Warning */}
              <div className="p-4 border-b border-terminal bg-bloomberg-amber/10">
                <div className="flex items-start gap-2 text-xs text-bloomberg-amber">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium mb-1">This mandate is permanent</p>
                    <p className="text-bloomberg-amber/80">Cannot be modified once created. To change rules, create a new mandate.</p>
                  </div>
                </div>
              </div>

              {/* Confirmation */}
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
```

**Step 3: Add the Wallet import at top**

Add to imports:
```tsx
import { Wallet } from 'lucide-react';
```

**Step 4: Verify page compiles and renders**

Run: `npm run dev`
Navigate to: http://localhost:5000/defi
Expected: New Bloomberg-style layout visible

**Step 5: Commit**

```bash
git add client/src/pages/DeFi.tsx
git commit -m "feat(defi): refactor to Bloomberg terminal layout"
```

---

## Task 7: Final Cleanup and Testing

**Files:**
- Delete: `client/src/components/MandateCard.tsx` (replaced by MandateSummary)

**Step 1: Remove old MandateCard import from DeFi.tsx if still present**

Check and remove any remaining imports of MandateCard.

**Step 2: Run full type check**

Run: `npm run typecheck`
Expected: No errors

**Step 3: Run build**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Visual QA**

Navigate to /defi and verify:
- [ ] Two-column layout visible
- [ ] Dark terminal background (#0a0a0a)
- [ ] Monospace numbers throughout
- [ ] Green/red colors for gains/losses
- [ ] Sharp corners on all panels
- [ ] Mandate summary compact and visible
- [ ] Performance grid shows MTD/YTD/ALL rows
- [ ] Records table is scrollable and dense

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat(defi): complete Bloomberg terminal redesign

- New two-column grid layout (controls left, data right)
- Bloomberg-inspired color palette
- Compact MandateSummary component
- PerformanceGrid with period rows
- Dense RecordsTable with scroll
- AttestationControls with period selector
- Terminal-style typography and borders"
```

---

## Summary

**Files Created:**
- `client/src/components/defi/PerformanceGrid.tsx`
- `client/src/components/defi/MandateSummary.tsx`
- `client/src/components/defi/AttestationControls.tsx`
- `client/src/components/defi/RecordsTable.tsx`

**Files Modified:**
- `client/src/index.css` (Bloomberg colors)
- `client/src/pages/DeFi.tsx` (complete layout refactor)

**Files to Delete:**
- `client/src/components/MandateCard.tsx` (optional, can keep for reference)

**Total Tasks:** 7
**Estimated Time:** 2-3 hours
