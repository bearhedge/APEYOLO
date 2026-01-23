/**
 * MandateWindow - Trading mandate display and management
 *
 * Shows current rules, allows editing, and Solana commit.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Shield, Lock, ExternalLink, Loader2 } from 'lucide-react';

interface Mandate {
  id: string;
  allowedSymbols: string[];
  strategyType: string;
  minDelta: number;
  maxDelta: number;
  maxDailyLossPercent: number;
  noOvernightPositions: boolean;
  requireStopLoss: boolean;
  maxStopLossMultiplier?: number;
  tradingWindowStart?: string;
  tradingWindowEnd?: string;
  exitDeadline?: string;
  solanaSignature?: string;
  isActive: boolean;
}

export function MandateWindow() {
  const queryClient = useQueryClient();
  const [commitError, setCommitError] = useState<string | null>(null);

  const { data: mandate, isLoading } = useQuery<Mandate>({
    queryKey: ['mandate'],
    queryFn: async () => {
      const res = await fetch('/api/defi/mandate', { credentials: 'include' });
      if (!res.ok) return null;
      const data = await res.json();
      return data.mandate;
    },
  });

  const commitMutation = useMutation({
    mutationFn: async () => {
      if (!mandate) throw new Error('No mandate to commit');
      const res = await fetch(`/api/defi/mandate/${mandate.id}/commit`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to commit');
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mandate'] });
      setCommitError(null);
    },
    onError: (err: Error) => {
      setCommitError(err.message);
    },
  });

  if (isLoading) {
    return <p style={{ color: '#666' }}>&gt; Loading mandate...</p>;
  }

  if (!mandate) {
    return (
      <div>
        <p>&gt; NO ACTIVE MANDATE</p>
        <p style={{ marginTop: 12 }}>&gt; Create one in settings to define your trading rules.</p>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
      <p style={{ color: '#4ade80', marginBottom: 12 }}>
        <Shield style={{ width: 14, height: 14, display: 'inline', marginRight: 6 }} />
        MANDATE ACTIVE
      </p>

      {/* Rules */}
      <div style={{ marginBottom: 16 }}>
        <Row label="Symbols" value={mandate.allowedSymbols.join(', ')} />
        <Row label="Strategy" value={`${mandate.strategyType} only`} />
        <Row label="Delta" value={`${mandate.minDelta.toFixed(2)} – ${mandate.maxDelta.toFixed(2)}`} />
        <Row label="Max Loss" value={`${(mandate.maxDailyLossPercent * 100).toFixed(0)}%/day`} />
        <Row
          label="Overnight"
          value={mandate.noOvernightPositions ? 'NOT ALLOWED' : 'Allowed'}
          valueColor={mandate.noOvernightPositions ? '#ef4444' : undefined}
        />
        <Row
          label="Stop Loss"
          value={
            mandate.requireStopLoss
              ? mandate.maxStopLossMultiplier
                ? `REQUIRED (max ${mandate.maxStopLossMultiplier}x)`
                : 'REQUIRED'
              : 'Optional'
          }
          valueColor={mandate.requireStopLoss ? '#4ade80' : undefined}
        />
        {mandate.tradingWindowStart && (
          <Row label="Entry" value={`After ${mandate.tradingWindowStart}`} />
        )}
        {mandate.exitDeadline && <Row label="Exit" value={`By ${mandate.exitDeadline}`} />}
      </div>

      {/* Blockchain Status */}
      <div style={{ borderTop: '1px solid #333', paddingTop: 12 }}>
        <Row
          label="On-Chain"
          value={
            mandate.solanaSignature ? (
              <a
                href={`https://explorer.solana.com/tx/${mandate.solanaSignature}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#3b82f6', display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <Lock style={{ width: 12, height: 12 }} />
                Verified
                <ExternalLink style={{ width: 12, height: 12 }} />
              </a>
            ) : (
              <span style={{ color: '#ef4444' }}>NOT COMMITTED</span>
            )
          }
        />

        {/* Commit Button */}
        {!mandate.solanaSignature && (
          <button
            onClick={() => commitMutation.mutate()}
            disabled={commitMutation.isPending}
            style={{
              width: '100%',
              marginTop: 12,
              padding: '8px 12px',
              background: 'rgba(59, 130, 246, 0.2)',
              border: '1px solid rgba(59, 130, 246, 0.5)',
              color: '#3b82f6',
              fontSize: 12,
              cursor: commitMutation.isPending ? 'not-allowed' : 'pointer',
              opacity: commitMutation.isPending ? 0.5 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              fontFamily: 'inherit',
            }}
          >
            {commitMutation.isPending ? (
              <>
                <Loader2 style={{ width: 12, height: 12, animation: 'spin 1s linear infinite' }} />
                Committing...
              </>
            ) : (
              <>
                <Lock style={{ width: 12, height: 12 }} />
                Commit to Blockchain
              </>
            )}
          </button>
        )}

        {commitError && (
          <p style={{ color: '#ef4444', fontSize: 11, marginTop: 8 }}>&gt; ERROR: {commitError}</p>
        )}
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

function Row({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: React.ReactNode;
  valueColor?: string;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
      <span style={{ color: '#888' }}>{label}</span>
      <span style={{ color: valueColor || '#fff' }}>{value}</span>
    </div>
  );
}
