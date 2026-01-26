/**
 * RailsWindow - DeFi Rails display and management with event timeline
 *
 * Full functionality: View, create, edit, commit to Solana, view event history.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Shield, Lock, ExternalLink, Loader2, Edit3, Save, X, Plus, Clock, AlertTriangle, CheckCircle, FileText, History } from 'lucide-react';

interface Rail {
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

interface RailEvent {
  id: string;
  eventType: string;
  eventData: any;
  eventHash: string;
  solanaSignature?: string;
  solanaSlot?: number;
  createdAt: string;
  recordedOnChainAt?: string;
}

interface RailFormData {
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

type TabType = 'rules' | 'history';

const DEFAULT_FORM: RailFormData = {
  allowedSymbols: 'SPY, SPX',
  strategyType: 'Credit Spreads',
  minDelta: '0.10',
  maxDelta: '0.35',
  maxDailyLossPercent: '2',
  noOvernightPositions: true,
  requireStopLoss: true,
  maxStopLossMultiplier: '3',
  tradingWindowStart: '11:00',  // 11am ET = 12am HKT
  exitDeadline: '15:59',        // 3:59pm ET = 3:59am HKT
};

export function RailsWindow() {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<RailFormData>(DEFAULT_FORM);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('rules');

  const { data: rail, isLoading } = useQuery<Rail | null>({
    queryKey: ['rails'],
    queryFn: async () => {
      const res = await fetch('/api/defi/rails', { credentials: 'include' });
      if (!res.ok) return null;
      const data = await res.json();
      return data.rail || null;
    },
  });

  const { data: eventData, isLoading: eventsLoading } = useQuery<{
    events: RailEvent[];
    totalCount: number;
    uncommittedCount: number;
  }>({
    queryKey: ['railEvents'],
    queryFn: async () => {
      const res = await fetch('/api/defi/rails/events', { credentials: 'include' });
      if (!res.ok) return { events: [], totalCount: 0, uncommittedCount: 0 };
      const data = await res.json();
      return data;
    },
  });

  // Save/Create rail mutation
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

      const url = isNew ? '/api/defi/rails' : `/api/defi/rails/${rail?.id}`;
      const method = isNew ? 'POST' : 'PUT';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to save rail');
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rails'] });
      queryClient.invalidateQueries({ queryKey: ['railEvents'] });
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
      if (!rail) throw new Error('No rail to commit');
      const res = await fetch(`/api/defi/rails/${rail.id}/commit`, {
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
      queryClient.invalidateQueries({ queryKey: ['rails'] });
      setError(null);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  // Commit event mutation
  const commitEventMutation = useMutation({
    mutationFn: async (eventId: string) => {
      const res = await fetch(`/api/defi/rails/events/${eventId}/commit`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to commit event');
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['railEvents'] });
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const startEditing = () => {
    if (rail) {
      setFormData({
        allowedSymbols: rail.allowedSymbols.join(', '),
        strategyType: rail.strategyType,
        minDelta: (rail.minDelta ?? 0).toString(),
        maxDelta: (rail.maxDelta ?? 0).toString(),
        maxDailyLossPercent: ((rail.maxDailyLossPercent ?? 0) * 100).toString(),
        noOvernightPositions: rail.noOvernightPositions,
        requireStopLoss: rail.requireStopLoss,
        maxStopLossMultiplier: rail.maxStopLossMultiplier?.toString() || '',
        tradingWindowStart: rail.tradingWindowStart || '',
        exitDeadline: rail.exitDeadline || '',
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
    saveMutation.mutate(!rail);
  };

  if (isLoading) {
    return <p style={{ color: '#666' }}>&gt; Loading rails...</p>;
  }

  // Edit/Create Form
  if (isEditing) {
    return (
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>
        <p style={{ color: '#87ceeb', marginBottom: 12 }}>
          &gt; {rail ? 'EDIT DEFI RAILS' : 'CREATE DEFI RAILS'}
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

  // No rail - show create button
  if (!rail) {
    return (
      <div style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
        <p>&gt; NO ACTIVE DEFI RAILS</p>
        <p style={{ marginTop: 12, color: '#666', fontSize: 12 }}>
          &gt; Define your trading rules to enable guard rails.
        </p>
        <ActionButton onClick={startEditing} primary style={{ marginTop: 16 }}>
          <Plus style={iconStyle} />
          Create DeFi Rails
        </ActionButton>
      </div>
    );
  }

  // Display mode - Tabbed interface
  return (
    <div style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
      {/* Tab Navigation */}
      <div style={{ display: 'flex', borderBottom: '1px solid #333', marginBottom: 12 }}>
        <TabButton active={activeTab === 'rules'} onClick={() => setActiveTab('rules')}>
          <Shield style={{ width: 12, height: 12 }} />
          Rules
        </TabButton>
        <TabButton active={activeTab === 'history'} onClick={() => setActiveTab('history')}>
          <History style={{ width: 12, height: 12 }} />
          History
          {eventData?.uncommittedCount ? (
            <span style={{
              background: '#f59e0b',
              color: '#000',
              padding: '1px 6px',
              borderRadius: 10,
              fontSize: 10,
              fontWeight: 600,
            }}>
              {eventData.uncommittedCount}
            </span>
          ) : null}
        </TabButton>
      </div>

      {/* Rules Tab */}
      {activeTab === 'rules' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <p style={{ color: '#4ade80', margin: 0 }}>
              DEFI RAILS
            </p>
            {!rail.solanaSignature && (
              <button onClick={startEditing} style={editButtonStyle}>
                <Edit3 style={{ width: 12, height: 12 }} />
              </button>
            )}
          </div>

          {/* Green bordered table */}
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            border: '1px solid #4ade80',
            fontSize: 12,
            marginBottom: 16,
          }}>
            <tbody>
              <TableRow label="Symbols" value={rail.allowedSymbols.join(', ')} />
              <TableRow label="Strategy" value={rail.strategyType || 'Credit Spreads'} />
              <TableRow label="Delta Range" value={`${(rail.minDelta ?? 0.10).toFixed(2)} – ${(rail.maxDelta ?? 0.35).toFixed(2)}`} />
              <TableRow label="Daily Max Loss" value={`${((rail.maxDailyLossPercent ?? 0.02) * 100).toFixed(0)}%`} />
              <TableRow label="Entry Window" value="After 11:00am ET (12:00am HKT)" />
              <TableRow label="Exit By" value="3:59pm ET (4:59am HKT)" />
              <TableRow label="Stop Loss" value="Yes" highlight />
              <TableRow label="Overnight" value="No" warn />
            </tbody>
          </table>

          {/* Blockchain Status */}
          <div style={{ borderTop: '1px solid #333', paddingTop: 12 }}>
            <Row
              label="On-Chain"
              value={
                rail.solanaSignature ? (
                  <a
                    href={`https://explorer.solana.com/tx/${rail.solanaSignature}`}
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
            {!rail.solanaSignature && (
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
          </div>
        </>
      )}

      {/* History Tab */}
      {activeTab === 'history' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <p style={{ color: '#87ceeb', margin: 0 }}>EVENT HISTORY</p>
            <span style={{ color: '#666', fontSize: 10 }}>
              {eventData?.totalCount || 0} events
            </span>
          </div>

          {eventsLoading ? (
            <p style={{ color: '#666', fontSize: 12 }}>Loading events...</p>
          ) : eventData?.events.length === 0 ? (
            <p style={{ color: '#666', fontSize: 12 }}>No events recorded yet.</p>
          ) : (
            <div style={{ maxHeight: 300, overflowY: 'auto' }}>
              {eventData?.events.map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
                  onCommit={(id) => commitEventMutation.mutate(id)}
                  isCommitting={commitEventMutation.isPending}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <p style={{ color: '#ef4444', fontSize: 11, marginTop: 8 }}>&gt; ERROR: {error}</p>
      )}

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

function TableRow({
  label,
  value,
  highlight,
  warn,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  warn?: boolean;
}) {
  return (
    <tr>
      <td style={{
        padding: '8px 12px',
        borderBottom: '1px solid #4ade80',
        color: '#888',
        width: '40%',
      }}>
        {label}
      </td>
      <td style={{
        padding: '8px 12px',
        borderBottom: '1px solid #4ade80',
        color: warn ? '#ef4444' : highlight ? '#4ade80' : '#fff',
        fontWeight: highlight || warn ? 600 : 400,
      }}>
        {value}
      </td>
    </tr>
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

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 16px',
        background: active ? 'rgba(74, 222, 128, 0.2)' : 'transparent',
        border: 'none',
        borderBottom: active ? '2px solid #4ade80' : '2px solid transparent',
        color: active ? '#4ade80' : '#888',
        fontSize: 12,
        cursor: 'pointer',
        fontFamily: 'inherit',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {children}
    </button>
  );
}

function EventRow({
  event,
  onCommit,
  isCommitting,
}: {
  event: RailEvent;
  onCommit: (id: string) => void;
  isCommitting: boolean;
}) {
  const getEventIcon = (type: string) => {
    switch (type) {
      case 'RAIL_CREATED':
        return <FileText style={{ width: 14, height: 14, color: '#4ade80' }} />;
      case 'RAIL_DEACTIVATED':
        return <X style={{ width: 14, height: 14, color: '#f59e0b' }} />;
      case 'VIOLATION_BLOCKED':
        return <AlertTriangle style={{ width: 14, height: 14, color: '#ef4444' }} />;
      case 'COMMITMENT_RECORDED':
        return <Lock style={{ width: 14, height: 14, color: '#3b82f6' }} />;
      default:
        return <Clock style={{ width: 14, height: 14, color: '#888' }} />;
    }
  };

  const getEventTitle = (type: string) => {
    switch (type) {
      case 'RAIL_CREATED':
        return 'Rails Created';
      case 'RAIL_DEACTIVATED':
        return 'Rails Deactivated';
      case 'VIOLATION_BLOCKED':
        return 'Violation Blocked';
      case 'COMMITMENT_RECORDED':
        return 'Committed to Chain';
      default:
        return type;
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      padding: '8px 0',
      borderBottom: '1px solid #222',
      gap: 12,
    }}>
      {getEventIcon(event.eventType)}
      <div style={{ flex: 1 }}>
        <div style={{ color: '#fff', fontSize: 12 }}>{getEventTitle(event.eventType)}</div>
        <div style={{ color: '#666', fontSize: 10 }}>{formatDate(event.createdAt)}</div>
      </div>
      {event.solanaSignature ? (
        <a
          href={`https://explorer.solana.com/tx/${event.solanaSignature}?cluster=devnet`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#3b82f6', display: 'flex', alignItems: 'center', gap: 4, fontSize: 10 }}
        >
          <CheckCircle style={{ width: 12, height: 12 }} />
          Verified
          <ExternalLink style={{ width: 10, height: 10 }} />
        </a>
      ) : (
        <button
          onClick={() => onCommit(event.id)}
          disabled={isCommitting}
          style={{
            padding: '4px 8px',
            background: 'rgba(59, 130, 246, 0.2)',
            border: '1px solid rgba(59, 130, 246, 0.5)',
            color: '#3b82f6',
            fontSize: 10,
            cursor: isCommitting ? 'not-allowed' : 'pointer',
            opacity: isCommitting ? 0.5 : 1,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {isCommitting ? <Loader2 style={{ width: 10, height: 10, animation: 'spin 1s linear infinite' }} /> : <Lock style={{ width: 10, height: 10 }} />}
          Commit
        </button>
      )}
    </div>
  );
}
