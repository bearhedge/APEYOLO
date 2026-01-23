/**
 * StatsWindow - Performance statistics with attestation generation
 *
 * Shows total return, win rate, Sharpe ratio, and other metrics.
 * Allows generating and submitting performance attestations to Solana.
 */

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';

interface PerformanceData {
  totalReturn: number;
  winRate: number;
  totalTrades: number;
  winCount: number;
  lossCount: number;
  totalPnl: number;
  avgWin: number;
  avgLoss: number;
  sharpeRatio?: number;
  maxDrawdown?: number;
  profitFactor?: number;
}

interface AttestationPreview {
  period: string;
  startDate: string;
  endDate: string;
  totalReturn: number;
  winRate: number;
  totalTrades: number;
  totalPnl: number;
  hash?: string;
}

type Period = 'week' | 'month' | 'quarter' | 'year' | 'all';

const PERIOD_LABELS: Record<Period, string> = {
  week: 'Last Week',
  month: 'Last Month',
  quarter: 'Last Quarter',
  year: 'Last Year',
  all: 'All Time',
};

export function StatsWindow() {
  const [selectedPeriod, setSelectedPeriod] = useState<Period>('month');
  const [showAttestation, setShowAttestation] = useState(false);
  const [attestationPreview, setAttestationPreview] = useState<AttestationPreview | null>(null);

  const { data: stats, isLoading, error } = useQuery<PerformanceData>({
    queryKey: ['performance'],
    queryFn: async () => {
      const res = await fetch('/api/defi/performance', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch performance');
      const data = await res.json();
      return data.performance || data;
    },
    refetchInterval: 60000,
  });

  // Generate attestation mutation
  const generateMutation = useMutation({
    mutationFn: async (period: Period) => {
      const res = await fetch('/api/defi/generate-attestation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ period }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to generate attestation');
      }
      return res.json();
    },
    onSuccess: (data) => {
      setAttestationPreview(data.attestation || data);
    },
  });

  // Submit attestation mutation
  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!attestationPreview) throw new Error('No attestation to submit');
      const res = await fetch('/api/defi/submit-attestation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ attestation: attestationPreview }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to submit attestation');
      }
      return res.json();
    },
    onSuccess: () => {
      setAttestationPreview(null);
      setShowAttestation(false);
    },
  });

  if (isLoading) {
    return <p style={{ color: '#666' }}>&gt; Calculating stats...</p>;
  }

  if (error) {
    return <p style={{ color: '#ef4444' }}>&gt; ERROR: Failed to load stats</p>;
  }

  if (!stats || !stats.totalTrades) {
    return (
      <div>
        <p>&gt; NO PERFORMANCE DATA</p>
        <p style={{ marginTop: 12, color: '#666' }}>&gt; Stats will appear after your first trade.</p>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
      <p style={{ color: '#87ceeb', marginBottom: 16 }}>&gt; PERFORMANCE METRICS</p>

      {/* Key Metrics */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <MetricCard
          label="Total Return"
          value={`${(stats.totalReturn ?? 0) >= 0 ? '+' : ''}${(stats.totalReturn ?? 0).toFixed(2)}%`}
          color={(stats.totalReturn ?? 0) >= 0 ? '#4ade80' : '#ef4444'}
        />
        <MetricCard
          label="Win Rate"
          value={`${(stats.winRate ?? 0).toFixed(1)}%`}
          color={(stats.winRate ?? 0) >= 50 ? '#4ade80' : '#f59e0b'}
        />
        <MetricCard
          label="Total P&L"
          value={`${(stats.totalPnl ?? 0) >= 0 ? '+' : ''}$${(stats.totalPnl ?? 0).toFixed(0)}`}
          color={(stats.totalPnl ?? 0) >= 0 ? '#4ade80' : '#ef4444'}
        />
        <MetricCard label="Trades" value={(stats.totalTrades ?? 0).toString()} color="#fff" />
      </div>

      {/* Detailed Stats */}
      <div style={{ borderTop: '1px solid #333', paddingTop: 12, marginBottom: 16 }}>
        <Row label="Wins / Losses" value={`${stats.winCount ?? 0} / ${stats.lossCount ?? 0}`} />
        <Row label="Avg Win" value={`+$${(stats.avgWin ?? 0).toFixed(0)}`} valueColor="#4ade80" />
        <Row label="Avg Loss" value={`-$${Math.abs(stats.avgLoss ?? 0).toFixed(0)}`} valueColor="#ef4444" />
        {stats.profitFactor !== undefined && (
          <Row
            label="Profit Factor"
            value={stats.profitFactor.toFixed(2)}
            valueColor={stats.profitFactor >= 1.5 ? '#4ade80' : '#f59e0b'}
          />
        )}
        {stats.sharpeRatio !== undefined && (
          <Row
            label="Sharpe Ratio"
            value={stats.sharpeRatio.toFixed(2)}
            valueColor={stats.sharpeRatio >= 1 ? '#4ade80' : '#f59e0b'}
          />
        )}
        {stats.maxDrawdown !== undefined && (
          <Row
            label="Max Drawdown"
            value={`-${stats.maxDrawdown.toFixed(1)}%`}
            valueColor="#ef4444"
          />
        )}
      </div>

      {/* Attestation Section */}
      <div style={{ borderTop: '1px solid #333', paddingTop: 12 }}>
        <p style={{ color: '#87ceeb', marginBottom: 12 }}>&gt; ATTESTATION</p>

        {/* Period Selector */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ color: '#888', fontSize: 11, display: 'block', marginBottom: 4 }}>
            Period
          </label>
          <select
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value as Period)}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: '#111',
              border: '1px solid #333',
              color: '#fff',
              fontSize: 12,
              fontFamily: 'inherit',
            }}
          >
            {Object.entries(PERIOD_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {/* Generate Button */}
        {!showAttestation && (
          <button
            onClick={() => {
              setShowAttestation(true);
              generateMutation.mutate(selectedPeriod);
            }}
            disabled={generateMutation.isPending}
            style={{
              width: '100%',
              fontSize: 11,
              color: '#87ceeb',
              background: 'none',
              border: '1px solid #87ceeb',
              padding: '8px 0',
              cursor: 'pointer',
              fontFamily: 'inherit',
              marginBottom: 8,
            }}
          >
            {generateMutation.isPending ? 'GENERATING...' : 'GENERATE ATTESTATION'}
          </button>
        )}

        {/* Error Display */}
        {(generateMutation.isError || submitMutation.isError) && (
          <p style={{ color: '#ef4444', fontSize: 11, marginBottom: 8 }}>
            &gt; ERROR: {generateMutation.error?.message || submitMutation.error?.message}
          </p>
        )}

        {/* Attestation Preview */}
        {showAttestation && (
          <div
            style={{
              background: '#111',
              border: '1px solid #333',
              padding: 12,
              marginBottom: 12,
            }}
          >
            {generateMutation.isPending ? (
              <p style={{ color: '#666' }}>&gt; Generating attestation...</p>
            ) : attestationPreview ? (
              <>
                <p style={{ color: '#4ade80', marginBottom: 8, fontWeight: 500 }}>
                  &gt; ATTESTATION PREVIEW
                </p>
                <div style={{ fontSize: 11, color: '#888' }}>
                  <Row label="Period" value={PERIOD_LABELS[selectedPeriod]} />
                  <Row
                    label="Date Range"
                    value={`${formatDate(attestationPreview.startDate)} - ${formatDate(attestationPreview.endDate)}`}
                  />
                  <Row
                    label="Return"
                    value={`${attestationPreview.totalReturn >= 0 ? '+' : ''}${attestationPreview.totalReturn.toFixed(2)}%`}
                    valueColor={attestationPreview.totalReturn >= 0 ? '#4ade80' : '#ef4444'}
                  />
                  <Row
                    label="Win Rate"
                    value={`${attestationPreview.winRate.toFixed(1)}%`}
                  />
                  <Row label="Trades" value={attestationPreview.totalTrades.toString()} />
                  <Row
                    label="P&L"
                    value={`${attestationPreview.totalPnl >= 0 ? '+' : ''}$${attestationPreview.totalPnl.toFixed(0)}`}
                    valueColor={attestationPreview.totalPnl >= 0 ? '#4ade80' : '#ef4444'}
                  />
                  {attestationPreview.hash && (
                    <Row label="Hash" value={`${attestationPreview.hash.slice(0, 12)}...`} />
                  )}
                </div>

                {/* Action Buttons */}
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button
                    onClick={() => submitMutation.mutate()}
                    disabled={submitMutation.isPending}
                    style={{
                      flex: 1,
                      fontSize: 11,
                      color: '#000',
                      background: '#4ade80',
                      border: 'none',
                      padding: '8px 0',
                      cursor: submitMutation.isPending ? 'wait' : 'pointer',
                      fontFamily: 'inherit',
                      fontWeight: 500,
                    }}
                  >
                    {submitMutation.isPending ? 'SUBMITTING...' : 'SUBMIT TO CHAIN'}
                  </button>
                  <button
                    onClick={() => {
                      setShowAttestation(false);
                      setAttestationPreview(null);
                    }}
                    disabled={submitMutation.isPending}
                    style={{
                      flex: 1,
                      fontSize: 11,
                      color: '#888',
                      background: 'none',
                      border: '1px solid #333',
                      padding: '8px 0',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    CANCEL
                  </button>
                </div>
              </>
            ) : (
              <p style={{ color: '#666' }}>&gt; Failed to generate attestation</p>
            )}
          </div>
        )}

        {/* Success Message */}
        {submitMutation.isSuccess && (
          <p style={{ color: '#4ade80', fontSize: 11 }}>
            &gt; Attestation submitted successfully!
          </p>
        )}
      </div>
    </div>
  );
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString();
  } catch {
    return dateStr;
  }
}

function MetricCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div
      style={{
        background: '#111',
        border: '1px solid #222',
        padding: 12,
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, color, fontWeight: 500 }}>{value}</div>
    </div>
  );
}

function Row({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
      <span style={{ color: '#888' }}>{label}</span>
      <span style={{ color: valueColor || '#fff' }}>{value}</span>
    </div>
  );
}
