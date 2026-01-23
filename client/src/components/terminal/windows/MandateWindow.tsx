/**
 * MandateWindow - Trading mandate display and management
 *
 * Full functionality: View, create, edit, commit to Solana.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Shield, Lock, ExternalLink, Loader2, Edit3, Save, X, Plus } from 'lucide-react';

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

interface MandateFormData {
  allowedSymbols: string;
  strategyType: string;
  minDelta: string;
  maxDelta: string;
  maxDailyLossPercent: string;
  noOvernightPositions: boolean;
  requireStopLoss: boolean;
  maxStopLossMultiplier: string;
  tradingWindowStart: string;
  exitDeadline: string;
}

const DEFAULT_FORM: MandateFormData = {
  allowedSymbols: 'SPY, SPX',
  strategyType: '0DTE Credit Spreads',
  minDelta: '0.10',
  maxDelta: '0.35',
  maxDailyLossPercent: '2',
  noOvernightPositions: true,
  requireStopLoss: true,
  maxStopLossMultiplier: '',
  tradingWindowStart: '11:00',
  exitDeadline: '15:59',
};

export function MandateWindow() {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<MandateFormData>(DEFAULT_FORM);
  const [error, setError] = useState<string | null>(null);

  const { data: mandate, isLoading } = useQuery<Mandate | null>({
    queryKey: ['mandate'],
    queryFn: async () => {
      const res = await fetch('/api/defi/mandate', { credentials: 'include' });
      if (!res.ok) return null;
      const data = await res.json();
      return data.mandate || null;
    },
  });

  // Save/Create mandate mutation
  const saveMutation = useMutation({
    mutationFn: async (isNew: boolean) => {
      const body = {
        allowedSymbols: formData.allowedSymbols.split(',').map(s => s.trim()),
        strategyType: formData.strategyType,
        minDelta: parseFloat(formData.minDelta),
        maxDelta: parseFloat(formData.maxDelta),
        maxDailyLossPercent: parseFloat(formData.maxDailyLossPercent) / 100,
        noOvernightPositions: formData.noOvernightPositions,
        requireStopLoss: formData.requireStopLoss,
        maxStopLossMultiplier: formData.maxStopLossMultiplier ? parseFloat(formData.maxStopLossMultiplier) : undefined,
        tradingWindowStart: formData.tradingWindowStart || undefined,
        exitDeadline: formData.exitDeadline || undefined,
      };

      const url = isNew ? '/api/defi/mandate' : `/api/defi/mandate/${mandate?.id}`;
      const method = isNew ? 'POST' : 'PUT';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to save mandate');
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mandate'] });
      setIsEditing(false);
      setError(null);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  // Commit to Solana mutation
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
      setError(null);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const startEditing = () => {
    if (mandate) {
      setFormData({
        allowedSymbols: mandate.allowedSymbols.join(', '),
        strategyType: mandate.strategyType,
        minDelta: (mandate.minDelta ?? 0).toString(),
        maxDelta: (mandate.maxDelta ?? 0).toString(),
        maxDailyLossPercent: ((mandate.maxDailyLossPercent ?? 0) * 100).toString(),
        noOvernightPositions: mandate.noOvernightPositions,
        requireStopLoss: mandate.requireStopLoss,
        maxStopLossMultiplier: mandate.maxStopLossMultiplier?.toString() || '',
        tradingWindowStart: mandate.tradingWindowStart || '',
        exitDeadline: mandate.exitDeadline || '',
      });
    } else {
      setFormData(DEFAULT_FORM);
    }
    setIsEditing(true);
    setError(null);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setError(null);
  };

  const handleSave = () => {
    saveMutation.mutate(!mandate);
  };

  if (isLoading) {
    return <p style={{ color: '#666' }}>&gt; Loading mandate...</p>;
  }

  // Edit/Create Form
  if (isEditing) {
    return (
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>
        <p style={{ color: '#87ceeb', marginBottom: 12 }}>
          &gt; {mandate ? 'EDIT MANDATE' : 'CREATE MANDATE'}
        </p>

        <FormRow label="Symbols">
          <input
            type="text"
            value={formData.allowedSymbols}
            onChange={e => setFormData({ ...formData, allowedSymbols: e.target.value })}
            style={inputStyle}
            placeholder="SPY, SPX"
          />
        </FormRow>

        <FormRow label="Strategy">
          <input
            type="text"
            value={formData.strategyType}
            onChange={e => setFormData({ ...formData, strategyType: e.target.value })}
            style={inputStyle}
          />
        </FormRow>

        <FormRow label="Delta Range">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              value={formData.minDelta}
              onChange={e => setFormData({ ...formData, minDelta: e.target.value })}
              style={{ ...inputStyle, width: 60 }}
              placeholder="0.10"
            />
            <span style={{ color: '#666' }}>–</span>
            <input
              type="text"
              value={formData.maxDelta}
              onChange={e => setFormData({ ...formData, maxDelta: e.target.value })}
              style={{ ...inputStyle, width: 60 }}
              placeholder="0.35"
            />
          </div>
        </FormRow>

        <FormRow label="Max Loss %/day">
          <input
            type="text"
            value={formData.maxDailyLossPercent}
            onChange={e => setFormData({ ...formData, maxDailyLossPercent: e.target.value })}
            style={{ ...inputStyle, width: 60 }}
            placeholder="2"
          />
        </FormRow>

        <FormRow label="Entry After">
          <input
            type="text"
            value={formData.tradingWindowStart}
            onChange={e => setFormData({ ...formData, tradingWindowStart: e.target.value })}
            style={{ ...inputStyle, width: 80 }}
            placeholder="11:00"
          />
        </FormRow>

        <FormRow label="Exit By">
          <input
            type="text"
            value={formData.exitDeadline}
            onChange={e => setFormData({ ...formData, exitDeadline: e.target.value })}
            style={{ ...inputStyle, width: 80 }}
            placeholder="15:59"
          />
        </FormRow>

        <FormRow label="Overnight">
          <ToggleButton
            active={!formData.noOvernightPositions}
            onClick={() => setFormData({ ...formData, noOvernightPositions: !formData.noOvernightPositions })}
            labels={['Allowed', 'NOT ALLOWED']}
          />
        </FormRow>

        <FormRow label="Stop Loss">
          <ToggleButton
            active={formData.requireStopLoss}
            onClick={() => setFormData({ ...formData, requireStopLoss: !formData.requireStopLoss })}
            labels={['Required', 'Optional']}
          />
        </FormRow>

        {formData.requireStopLoss && (
          <FormRow label="Max Stop Multiplier">
            <input
              type="text"
              value={formData.maxStopLossMultiplier}
              onChange={e => setFormData({ ...formData, maxStopLossMultiplier: e.target.value })}
              style={{ ...inputStyle, width: 60 }}
              placeholder="3"
            />
          </FormRow>
        )}

        {error && (
          <p style={{ color: '#ef4444', fontSize: 11, marginTop: 8 }}>&gt; ERROR: {error}</p>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <ActionButton onClick={handleSave} disabled={saveMutation.isPending} primary>
            {saveMutation.isPending ? <Loader2 style={iconSpin} /> : <Save style={iconStyle} />}
            Save
          </ActionButton>
          <ActionButton onClick={cancelEditing}>
            <X style={iconStyle} />
            Cancel
          </ActionButton>
        </div>
      </div>
    );
  }

  // No mandate - show create button
  if (!mandate) {
    return (
      <div style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
        <p>&gt; NO ACTIVE MANDATE</p>
        <p style={{ marginTop: 12, color: '#666', fontSize: 12 }}>
          &gt; Define your trading rules to enable guard rails.
        </p>
        <ActionButton onClick={startEditing} primary style={{ marginTop: 16 }}>
          <Plus style={iconStyle} />
          Create Mandate
        </ActionButton>
      </div>
    );
  }

  // Display mode
  return (
    <div style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <p style={{ color: '#4ade80', margin: 0 }}>
          <Shield style={{ width: 14, height: 14, display: 'inline', marginRight: 6 }} />
          MANDATE ACTIVE
        </p>
        {!mandate.solanaSignature && (
          <button onClick={startEditing} style={editButtonStyle}>
            <Edit3 style={{ width: 12, height: 12 }} />
          </button>
        )}
      </div>

      {/* Rules */}
      <div style={{ marginBottom: 16 }}>
        <Row label="Symbols" value={mandate.allowedSymbols.join(', ')} />
        <Row label="Strategy" value={mandate.strategyType} />
        <Row label="Delta" value={`${(mandate.minDelta ?? 0).toFixed(2)} – ${(mandate.maxDelta ?? 0).toFixed(2)}`} />
        <Row label="Max Loss" value={`${((mandate.maxDailyLossPercent ?? 0) * 100).toFixed(0)}%/day`} />
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
          <Row label="Entry" value={`After ${mandate.tradingWindowStart} ET`} />
        )}
        {mandate.exitDeadline && <Row label="Exit" value={`By ${mandate.exitDeadline} ET`} />}
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
              <span style={{ color: '#f59e0b' }}>NOT COMMITTED</span>
            )
          }
        />

        {/* Commit Button */}
        {!mandate.solanaSignature && (
          <ActionButton
            onClick={() => commitMutation.mutate()}
            disabled={commitMutation.isPending}
            primary
            style={{ width: '100%', marginTop: 12 }}
          >
            {commitMutation.isPending ? (
              <>
                <Loader2 style={iconSpin} />
                Committing...
              </>
            ) : (
              <>
                <Lock style={iconStyle} />
                Commit to Blockchain
              </>
            )}
          </ActionButton>
        )}

        {error && (
          <p style={{ color: '#ef4444', fontSize: 11, marginTop: 8 }}>&gt; ERROR: {error}</p>
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

// Styles
const inputStyle: React.CSSProperties = {
  background: '#111',
  border: '1px solid #333',
  color: '#fff',
  padding: '4px 8px',
  fontSize: 12,
  fontFamily: 'inherit',
  width: '100%',
};

const iconStyle: React.CSSProperties = { width: 12, height: 12 };
const iconSpin: React.CSSProperties = { width: 12, height: 12, animation: 'spin 1s linear infinite' };

const editButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #333',
  color: '#888',
  padding: 4,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
};

// Components
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

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
      <span style={{ color: '#888', fontSize: 12 }}>{label}</span>
      {children}
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  labels,
}: {
  active: boolean;
  onClick: () => void;
  labels: [string, string];
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? 'rgba(74, 222, 128, 0.2)' : 'rgba(239, 68, 68, 0.2)',
        border: `1px solid ${active ? 'rgba(74, 222, 128, 0.5)' : 'rgba(239, 68, 68, 0.5)'}`,
        color: active ? '#4ade80' : '#ef4444',
        padding: '4px 8px',
        fontSize: 11,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {active ? labels[0] : labels[1]}
    </button>
  );
}

function ActionButton({
  onClick,
  disabled,
  primary,
  children,
  style,
}: {
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: '6px 12px',
        background: primary ? 'rgba(59, 130, 246, 0.2)' : '#111',
        border: `1px solid ${primary ? 'rgba(59, 130, 246, 0.5)' : '#333'}`,
        color: primary ? '#3b82f6' : '#888',
        fontSize: 12,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        fontFamily: 'inherit',
        ...style,
      }}
    >
      {children}
    </button>
  );
}
