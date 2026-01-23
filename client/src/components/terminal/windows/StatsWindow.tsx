/**
 * StatsWindow - Performance Metrics & Attestation
 *
 * Shows performance metrics with period selection:
 * - Top metrics: Total Return %, Total P&L $, Trade Count
 * - Core stats: Win Rate, Avg Win, Avg Loss, Profit Factor, Expectancy
 * - Risk-adjusted (30+ trades): Sharpe Ratio, Max Drawdown, Recovery Factor
 * - Period selector: MTD, YTD, Since Benchmark, All Time
 * - Attestation generation for on-chain proof
 */

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';

// Benchmark date: Jan 24, 2026 - public track record starts from this date
const BENCHMARK_DATE = '2026-01-24';

// API response types
interface PeriodMetrics {
  returnPercent: number;
  pnlUsd: number;
  pnlHkd: number;
  tradeCount: number;
  winRate: number;  // 0-1 scale
}

interface PerformanceAPIResponse {
  success: boolean;
  data: {
    mtd: PeriodMetrics;
    ytd: PeriodMetrics;
    all: PeriodMetrics;
  };
}

interface Trade {
  id: string;
  date: string;
  realizedPnlUSD: number;
  returnPercent: number;
  outcome: 'win' | 'loss' | 'breakeven' | 'open';
  status: string;
}

interface TradesAPIResponse {
  success: boolean;
  trades: Trade[];
  count: number;
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

// Computed metrics from trade data
interface ComputedMetrics {
  totalReturn: number;
  totalPnl: number;
  tradeCount: number;
  winRate: number;
  winCount: number;
  lossCount: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number | null;
  expectancy: number | null;
  sharpeRatio: number | null;
  maxDrawdown: number | null;
  recoveryFactor: number | null;
}

type Period = 'mtd' | 'ytd' | 'since_benchmark' | 'all';

const PERIOD_LABELS: Record<Period, string> = {
  mtd: 'MTD',
  ytd: 'YTD',
  since_benchmark: 'Since Jan 24',
  all: 'All Time',
};

export function StatsWindow() {
  const [selectedPeriod, setSelectedPeriod] = useState<Period>('since_benchmark');
  const [showAttestation, setShowAttestation] = useState(false);
  const [attestationPreview, setAttestationPreview] = useState<AttestationPreview | null>(null);

  // Fetch performance data from API
  const { data: performanceData, isLoading: perfLoading } = useQuery<PerformanceAPIResponse>({
    queryKey: ['performance'],
    queryFn: async () => {
      const res = await fetch('/api/defi/performance', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch performance');
      return res.json();
    },
    refetchInterval: 60000,
  });

  // Fetch trades for detailed metrics calculation
  const { data: tradesData, isLoading: tradesLoading, error } = useQuery<TradesAPIResponse>({
    queryKey: ['trades'],
    queryFn: async () => {
      const res = await fetch('/api/defi/trades?limit=500', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch trades');
      return res.json();
    },
    refetchInterval: 60000,
  });

  const isLoading = perfLoading || tradesLoading;

  // Generate attestation mutation
  const generateMutation = useMutation({
    mutationFn: async (period: string) => {
      // Map UI period to API period type
      const periodTypeMap: Record<string, string> = {
        mtd: 'mtd',
        ytd: 'last_month', // TODO: Add ytd to API
        since_benchmark: 'custom',
        all: 'custom',
      };
      const body: any = { periodType: periodTypeMap[period] || 'mtd' };
      if (period === 'since_benchmark') {
        body.customStart = BENCHMARK_DATE;
        body.customEnd = new Date().toISOString().split('T')[0];
      } else if (period === 'all') {
        body.customStart = '2020-01-01';
        body.customEnd = new Date().toISOString().split('T')[0];
      }
      const res = await fetch('/api/defi/generate-attestation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to generate attestation');
      }
      return res.json();
    },
    onSuccess: (data) => {
      setAttestationPreview(data.data || data.attestation || data);
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

  // Get all trades and filter by period
  const allTrades = tradesData?.trades || [];
  const filteredTrades = filterTradesByPeriod(allTrades, selectedPeriod);
  const closedTrades = filteredTrades.filter(t => t.status !== 'open');

  // Calculate metrics from filtered trades
  const metrics = calculateMetrics(closedTrades, performanceData?.data, selectedPeriod);

  if (!metrics || metrics.tradeCount === 0) {
    return (
      <div style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
        <PeriodSelector selected={selectedPeriod} onChange={setSelectedPeriod} />
        <p style={{ marginTop: 12 }}>&gt; NO PERFORMANCE DATA</p>
        <p style={{ marginTop: 8, color: '#666' }}>&gt; Stats will appear after your first trade.</p>
      </div>
    );
  }

  const showRiskMetrics = metrics.tradeCount >= 30;

  return (
    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11 }}>
      {/* Period Selector */}
      <PeriodSelector selected={selectedPeriod} onChange={setSelectedPeriod} />

      {/* Top Metrics - Big Numbers */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 8,
          marginBottom: 12,
        }}
      >
        <MetricCard
          label="Total Return"
          value={`${metrics.totalReturn >= 0 ? '+' : ''}${metrics.totalReturn.toFixed(2)}%`}
          color={metrics.totalReturn >= 0 ? '#4ade80' : '#ef4444'}
        />
        <MetricCard
          label="Total P&L"
          value={`${metrics.totalPnl >= 0 ? '+' : ''}$${metrics.totalPnl.toFixed(0)}`}
          color={metrics.totalPnl >= 0 ? '#4ade80' : '#ef4444'}
        />
        <MetricCard label="Trades" value={metrics.tradeCount.toString()} color="#fff" />
      </div>

      {/* Core Stats */}
      <div style={{ borderTop: '1px solid #333', paddingTop: 10, marginBottom: 10 }}>
        <p style={{ color: '#666', fontSize: 9, textTransform: 'uppercase', marginBottom: 6 }}>Core Stats</p>
        <Row
          label="Win Rate"
          value={`${metrics.winRate.toFixed(1)}%`}
          valueColor={metrics.winRate >= 50 ? '#4ade80' : '#f59e0b'}
        />
        <Row label="Wins / Losses" value={`${metrics.winCount} / ${metrics.lossCount}`} />
        <Row label="Avg Win" value={`+$${metrics.avgWin.toFixed(0)}`} valueColor="#4ade80" />
        <Row label="Avg Loss" value={`-$${Math.abs(metrics.avgLoss).toFixed(0)}`} valueColor="#ef4444" />
        {metrics.profitFactor !== null && (
          <Row
            label="Profit Factor"
            value={metrics.profitFactor.toFixed(2)}
            valueColor={metrics.profitFactor >= 1.5 ? '#4ade80' : '#f59e0b'}
          />
        )}
        {metrics.expectancy !== null && (
          <Row
            label="Expectancy"
            value={`${metrics.expectancy >= 0 ? '+' : ''}$${metrics.expectancy.toFixed(0)}/trade`}
            valueColor={metrics.expectancy >= 0 ? '#4ade80' : '#ef4444'}
          />
        )}
      </div>

      {/* Risk-Adjusted Metrics (only show with 30+ trades) */}
      {showRiskMetrics && (
        <div style={{ borderTop: '1px solid #333', paddingTop: 10, marginBottom: 10 }}>
          <p style={{ color: '#666', fontSize: 9, textTransform: 'uppercase', marginBottom: 6 }}>Risk-Adjusted</p>
          {metrics.sharpeRatio !== null && (
            <Row
              label="Sharpe Ratio"
              value={metrics.sharpeRatio.toFixed(2)}
              valueColor={metrics.sharpeRatio >= 1 ? '#4ade80' : metrics.sharpeRatio >= 0.5 ? '#f59e0b' : '#ef4444'}
            />
          )}
          {metrics.maxDrawdown !== null && (
            <Row
              label="Max Drawdown"
              value={`-${metrics.maxDrawdown.toFixed(1)}%`}
              valueColor={metrics.maxDrawdown <= 5 ? '#4ade80' : metrics.maxDrawdown <= 10 ? '#f59e0b' : '#ef4444'}
            />
          )}
          {metrics.recoveryFactor !== null && (
            <Row
              label="Recovery Factor"
              value={metrics.recoveryFactor.toFixed(2)}
              valueColor={metrics.recoveryFactor >= 2 ? '#4ade80' : '#f59e0b'}
            />
          )}
        </div>
      )}

      {!showRiskMetrics && metrics.tradeCount > 0 && (
        <div style={{ color: '#666', fontSize: 10, marginBottom: 10, fontStyle: 'italic' }}>
          Risk-adjusted metrics available after 30 trades ({30 - metrics.tradeCount} more)
        </div>
      )}

      {/* Attestation Section */}
      <div style={{ borderTop: '1px solid #333', paddingTop: 10 }}>
        <p style={{ color: '#87ceeb', fontSize: 10, marginBottom: 8 }}>&gt; ON-CHAIN ATTESTATION</p>

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
              fontSize: 10,
              color: '#87ceeb',
              background: 'none',
              border: '1px solid #87ceeb',
              padding: '6px 0',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {generateMutation.isPending ? 'GENERATING...' : `GENERATE ATTESTATION (${PERIOD_LABELS[selectedPeriod]})`}
          </button>
        )}

        {/* Error Display */}
        {(generateMutation.isError || submitMutation.isError) && (
          <p style={{ color: '#ef4444', fontSize: 10, marginTop: 6 }}>
            &gt; ERROR: {generateMutation.error?.message || submitMutation.error?.message}
          </p>
        )}

        {/* Attestation Preview */}
        {showAttestation && (
          <div
            style={{
              background: '#0a0a0a',
              border: '1px solid #333',
              padding: 10,
              marginTop: 8,
            }}
          >
            {generateMutation.isPending ? (
              <p style={{ color: '#666', fontSize: 10 }}>&gt; Generating attestation...</p>
            ) : attestationPreview ? (
              <>
                <div style={{ fontSize: 10, color: '#888' }}>
                  <Row label="Period" value={PERIOD_LABELS[selectedPeriod]} />
                  <Row
                    label="Return"
                    value={`${(attestationPreview.totalReturn || 0) >= 0 ? '+' : ''}${(attestationPreview.totalReturn || 0).toFixed(2)}%`}
                    valueColor={(attestationPreview.totalReturn || 0) >= 0 ? '#4ade80' : '#ef4444'}
                  />
                  <Row
                    label="P&L"
                    value={`${(attestationPreview.totalPnl || 0) >= 0 ? '+' : ''}$${(attestationPreview.totalPnl || 0).toFixed(0)}`}
                    valueColor={(attestationPreview.totalPnl || 0) >= 0 ? '#4ade80' : '#ef4444'}
                  />
                  {attestationPreview.hash && (
                    <Row label="Hash" value={`${attestationPreview.hash.slice(0, 16)}...`} />
                  )}
                </div>

                {/* Action Buttons */}
                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                  <button
                    onClick={() => submitMutation.mutate()}
                    disabled={submitMutation.isPending}
                    style={{
                      flex: 1,
                      fontSize: 10,
                      color: '#000',
                      background: '#4ade80',
                      border: 'none',
                      padding: '6px 0',
                      cursor: submitMutation.isPending ? 'wait' : 'pointer',
                      fontFamily: 'inherit',
                      fontWeight: 500,
                    }}
                  >
                    {submitMutation.isPending ? 'SUBMITTING...' : 'SUBMIT TO SOLANA'}
                  </button>
                  <button
                    onClick={() => {
                      setShowAttestation(false);
                      setAttestationPreview(null);
                    }}
                    disabled={submitMutation.isPending}
                    style={{
                      flex: 1,
                      fontSize: 10,
                      color: '#888',
                      background: 'none',
                      border: '1px solid #333',
                      padding: '6px 0',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    CANCEL
                  </button>
                </div>
              </>
            ) : (
              <p style={{ color: '#666', fontSize: 10 }}>&gt; Failed to generate attestation</p>
            )}
          </div>
        )}

        {/* Success Message */}
        {submitMutation.isSuccess && (
          <p style={{ color: '#4ade80', fontSize: 10, marginTop: 6 }}>
            &gt; Attestation submitted to Solana!
          </p>
        )}
      </div>
    </div>
  );
}

// Helper: Filter trades by period
function filterTradesByPeriod(trades: Trade[], period: Period): Trade[] {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  switch (period) {
    case 'since_benchmark':
      return trades.filter(t => t.date >= BENCHMARK_DATE);
    case 'mtd': {
      const mtdStart = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-01`;
      return trades.filter(t => t.date >= mtdStart);
    }
    case 'ytd': {
      const ytdStart = `${currentYear}-01-01`;
      return trades.filter(t => t.date >= ytdStart);
    }
    case 'all':
    default:
      return trades;
  }
}

// Helper: Calculate metrics from trades
function calculateMetrics(
  trades: Trade[],
  apiData: PerformanceAPIResponse['data'] | undefined,
  period: Period
): ComputedMetrics | null {
  if (!trades.length) return null;

  // Get API metrics for return % (more accurate NAV-based calculation)
  let totalReturn = 0;
  let totalPnl = 0;
  if (apiData) {
    const periodData = period === 'mtd' ? apiData.mtd
      : period === 'ytd' ? apiData.ytd
      : apiData.all; // Use 'all' for both 'since_benchmark' and 'all'
    totalReturn = periodData?.returnPercent || 0;
    totalPnl = periodData?.pnlUsd || 0;
  }

  // Calculate detailed metrics from trade data
  const wins = trades.filter(t => t.outcome === 'win');
  const losses = trades.filter(t => t.outcome === 'loss');

  const winCount = wins.length;
  const lossCount = losses.length;
  const tradeCount = winCount + lossCount;
  const winRate = tradeCount > 0 ? (winCount / tradeCount) * 100 : 0;

  // Calculate average win/loss
  const totalWins = wins.reduce((sum, t) => sum + (t.realizedPnlUSD || 0), 0);
  const totalLosses = Math.abs(losses.reduce((sum, t) => sum + (t.realizedPnlUSD || 0), 0));
  const avgWin = winCount > 0 ? totalWins / winCount : 0;
  const avgLoss = lossCount > 0 ? -totalLosses / lossCount : 0;

  // If API didn't provide total P&L, calculate from trades
  if (totalPnl === 0) {
    totalPnl = trades.reduce((sum, t) => sum + (t.realizedPnlUSD || 0), 0);
  }

  // Profit Factor = Gross Profit / Gross Loss
  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : (totalWins > 0 ? Infinity : null);

  // Expectancy = (Win Rate × Avg Win) - (Loss Rate × Avg Loss)
  const expectancy = tradeCount > 0
    ? ((winCount / tradeCount) * avgWin) + ((lossCount / tradeCount) * avgLoss)
    : null;

  // Risk-adjusted metrics (need sufficient data)
  let sharpeRatio: number | null = null;
  let maxDrawdown: number | null = null;
  let recoveryFactor: number | null = null;

  if (tradeCount >= 30) {
    // Calculate Sharpe Ratio
    // Sharpe = (Mean Return - Risk Free Rate) / Std Dev of Returns
    const returns = trades.map(t => t.returnPercent || 0);
    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    const riskFreeRate = 0.05 / 252; // Approximate daily risk-free rate (5% annual)
    sharpeRatio = stdDev > 0 ? ((meanReturn - riskFreeRate) / stdDev) * Math.sqrt(252) : null; // Annualized

    // Calculate Max Drawdown
    // Track cumulative P&L and find largest peak-to-trough drop
    let peak = 0;
    let maxDD = 0;
    let cumulative = 0;
    for (const trade of trades.slice().reverse()) { // Process in chronological order
      cumulative += trade.realizedPnlUSD || 0;
      if (cumulative > peak) peak = cumulative;
      const drawdown = peak > 0 ? ((peak - cumulative) / peak) * 100 : 0;
      if (drawdown > maxDD) maxDD = drawdown;
    }
    maxDrawdown = maxDD;

    // Recovery Factor = Total Profit / Max Drawdown
    if (maxDD > 0 && totalPnl > 0) {
      recoveryFactor = totalPnl / (maxDD * totalPnl / 100); // Convert DD% to $
    }
  }

  return {
    totalReturn,
    totalPnl,
    tradeCount,
    winRate,
    winCount,
    lossCount,
    avgWin,
    avgLoss,
    profitFactor: profitFactor === Infinity ? null : profitFactor,
    expectancy,
    sharpeRatio,
    maxDrawdown,
    recoveryFactor,
  };
}

// Component: Period Selector
function PeriodSelector({ selected, onChange }: { selected: Period; onChange: (p: Period) => void }) {
  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
      {(Object.entries(PERIOD_LABELS) as [Period, string][]).map(([value, label]) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          style={{
            flex: 1,
            padding: '4px 0',
            fontSize: 9,
            fontFamily: 'inherit',
            background: selected === value ? '#222' : 'transparent',
            border: selected === value ? '1px solid #444' : '1px solid #222',
            color: selected === value ? '#fff' : '#666',
            cursor: 'pointer',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
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
        padding: 8,
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 9, color: '#666', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 16, color, fontWeight: 600 }}>{value}</div>
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
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 11 }}>
      <span style={{ color: '#888' }}>{label}</span>
      <span style={{ color: valueColor || '#fff' }}>{value}</span>
    </div>
  );
}
