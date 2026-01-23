/**
 * AgentWindow - AI Trading Assistant
 *
 * Two views:
 * 1. Chat: Quick operations (Analyze, Propose, Positions), activity feed, chat input
 * 2. Log: Real-time CodeAct agent terminal log via SSE
 */

import { useState, useRef, useEffect } from 'react';
import { useAgentOperator } from '@/hooks/useAgentOperator';
import { useAgentStream, LOG_TYPES, type LogLine, type LogType } from '@/hooks/useAgentStream';
import { useQuery } from '@tanstack/react-query';

type ViewMode = 'chat' | 'log';

export function AgentWindow() {
  const [viewMode, setViewMode] = useState<ViewMode>('log');

  return (
    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* View Tabs */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 8 }}>
        <TabButton
          label="LOG"
          active={viewMode === 'log'}
          onClick={() => setViewMode('log')}
        />
        <TabButton
          label="CHAT"
          active={viewMode === 'chat'}
          onClick={() => setViewMode('chat')}
        />
      </div>

      {viewMode === 'log' ? <AgentLogView /> : <AgentChatView />}
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 16px',
        background: active ? '#1a1a1a' : 'transparent',
        border: 'none',
        borderBottom: active ? '2px solid #4ade80' : '2px solid transparent',
        color: active ? '#4ade80' : '#666',
        fontSize: 10,
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontWeight: active ? 600 : 400,
      }}
    >
      {label}
    </button>
  );
}

/**
 * AgentLogView - Real-time CodeAct agent terminal log via SSE
 */
function AgentLogView() {
  const { lines, isConnected, error, clearLines } = useAgentStream();
  const terminalRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  // Copy logs to clipboard
  const copyLogs = () => {
    const text = lines.map(line => {
      const config = LOG_TYPES[line.logType] || { label: line.logType };
      return `${line.timestamp} [${config.label}] ${line.text}`;
    }).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Auto-scroll to bottom
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Status bar */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
        paddingBottom: 8,
        borderBottom: '1px solid #222',
      }}>
        <span style={{ color: isConnected ? '#4ade80' : '#ef4444', fontSize: 10 }}>
          {isConnected ? 'CONNECTED' : error || 'DISCONNECTED'}
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={copyLogs}
            style={{
              padding: '2px 8px',
              background: 'none',
              border: '1px solid #333',
              color: copied ? '#4ade80' : '#666',
              fontSize: 9,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {copied ? 'COPIED!' : 'COPY'}
          </button>
          <button
            onClick={clearLines}
            style={{
              padding: '2px 8px',
              background: 'none',
              border: '1px solid #333',
              color: '#666',
              fontSize: 9,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            CLEAR
          </button>
        </div>
      </div>

      {/* Terminal output */}
      <div
        ref={terminalRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          background: '#0d1117',
          padding: 12,
          fontFamily: "'JetBrains Mono', 'Fira Code', 'IBM Plex Mono', monospace",
          fontSize: 13,
          lineHeight: 1.5,
        }}
      >
        {lines.length === 0 ? (
          <div style={{ color: '#444' }}>
            Waiting for agent activity...
          </div>
        ) : (
          lines.map(line => <LogLineDisplay key={line.id} line={line} />)
        )}
      </div>
    </div>
  );
}

function LogLineDisplay({ line }: { line: LogLine }) {
  const config = LOG_TYPES[line.logType] || { label: line.logType, color: '#888' };

  // Format multi-line content with proper indentation
  const contentLines = line.text.split('\n');
  // Calculate indent based on actual header width: timestamp (8) + space + [TAG] + 5 spaces
  const headerWidth = line.timestamp.length + 1 + config.label.length + 2 + 5;

  return (
    <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginBottom: 2 }}>
      {/* First line with timestamp and tag */}
      <span style={{ color: '#6b7280' }}>{line.timestamp}</span>
      {' '}
      <span style={{ color: config.color, fontWeight: 600 }}>
        [{config.label}]
      </span>
      {'     '}
      <span style={{ color: config.color }}>
        {contentLines[0]}
      </span>

      {/* Continuation lines - indent to align with content */}
      {contentLines.slice(1).map((text, i) => (
        <div key={i} style={{ paddingLeft: `${headerWidth}ch` }}>
          <span style={{ color: config.color }}>{text}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * AgentChatView - Interactive chat with quick operations
 */
function AgentChatView() {
  const [chatInput, setChatInput] = useState('');
  const activityEndRef = useRef<HTMLDivElement>(null);

  const {
    isOnline,
    isProcessing,
    activities,
    activeProposal,
    activeCritique,
    operate,
    executeProposal,
    dismissProposal,
    stopOperation,
    clearActivities,
  } = useAgentOperator({ enableStatusPolling: true });

  // Broker status
  const { data: broker } = useQuery({
    queryKey: ['broker-status'],
    queryFn: async () => {
      const res = await fetch('/api/broker/diag', { credentials: 'include' });
      if (!res.ok) return { connected: false };
      const data = await res.json();
      return { connected: data.connected || data.status === 'connected' };
    },
    refetchInterval: 10000,
  });

  // Auto-scroll activity feed
  useEffect(() => {
    activityEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activities]);

  // Handle chat submit
  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isProcessing) return;
    operate('custom', { message: chatInput.trim() });
    setChatInput('');
  };

  return (
    <>
      {/* Header with status */}
      <div style={{ marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid #333' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#87ceeb' }}>&gt; APE AGENT v2.0</span>
          <div style={{ display: 'flex', gap: 8, fontSize: 10 }}>
            <StatusBadge label="LLM" status={isOnline} />
            <StatusBadge label="IBKR" status={broker?.connected ?? false} />
          </div>
        </div>
      </div>

      {/* Quick action buttons */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        <QuickButton
          label="Analyze"
          onClick={() => operate('analyze')}
          disabled={isProcessing}
        />
        <QuickButton
          label="Propose"
          onClick={() => operate('propose')}
          disabled={isProcessing}
        />
        <QuickButton
          label="Positions"
          onClick={() => operate('positions')}
          disabled={isProcessing}
        />
        {isProcessing && (
          <QuickButton
            label="Stop"
            onClick={stopOperation}
            variant="danger"
          />
        )}
      </div>

      {/* Active Proposal Card */}
      {activeProposal && (
        <ProposalCard
          proposal={activeProposal}
          critique={activeCritique}
          onExecute={() => executeProposal()}
          onDismiss={dismissProposal}
          isProcessing={isProcessing}
        />
      )}

      {/* Activity Feed */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          background: '#0a0a0a',
          border: '1px solid #222',
          padding: 8,
          marginBottom: 12,
        }}
      >
        {activities.length === 0 ? (
          <p style={{ color: '#444', fontSize: 11 }}>No activity yet. Click Analyze to start.</p>
        ) : (
          <>
            {activities.slice(-20).map(activity => (
              <ActivityItem key={activity.id} activity={activity} />
            ))}
            <div ref={activityEndRef} />
          </>
        )}
      </div>

      {/* Clear button */}
      {activities.length > 0 && (
        <button
          onClick={clearActivities}
          style={{
            marginBottom: 8,
            padding: '4px 8px',
            background: 'none',
            border: '1px solid #333',
            color: '#666',
            fontSize: 10,
            cursor: 'pointer',
            fontFamily: 'inherit',
            alignSelf: 'flex-start',
          }}
        >
          Clear Log
        </button>
      )}

      {/* Chat Input */}
      <form onSubmit={handleChatSubmit} style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          placeholder="Ask the agent..."
          disabled={isProcessing}
          style={{
            flex: 1,
            padding: '8px 12px',
            background: '#111',
            border: '1px solid #333',
            color: '#fff',
            fontSize: 11,
            fontFamily: 'inherit',
          }}
        />
        <button
          type="submit"
          disabled={isProcessing || !chatInput.trim()}
          style={{
            padding: '8px 16px',
            background: chatInput.trim() && !isProcessing ? '#3b82f6' : '#333',
            border: 'none',
            color: '#fff',
            fontSize: 11,
            cursor: chatInput.trim() && !isProcessing ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit',
          }}
        >
          {isProcessing ? '...' : 'Send'}
        </button>
      </form>
    </>
  );
}

function StatusBadge({ label, status }: { label: string; status: boolean }) {
  return (
    <span style={{ color: status ? '#4ade80' : '#ef4444' }}>
      {label} {status ? 'ON' : 'OFF'}
    </span>
  );
}

function QuickButton({
  label,
  onClick,
  disabled,
  variant = 'default',
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'default' | 'danger';
}) {
  const colors = variant === 'danger'
    ? { bg: 'rgba(239, 68, 68, 0.2)', border: '#ef4444', color: '#ef4444' }
    : { bg: 'rgba(59, 130, 246, 0.2)', border: '#3b82f6', color: '#3b82f6' };

  return (
    <button
      onClick={onClick}
      disabled={disabled && variant !== 'danger'}
      style={{
        flex: 1,
        padding: '6px 0',
        background: disabled && variant !== 'danger' ? 'transparent' : colors.bg,
        border: `1px solid ${disabled && variant !== 'danger' ? '#333' : colors.border}`,
        color: disabled && variant !== 'danger' ? '#444' : colors.color,
        fontSize: 10,
        cursor: disabled && variant !== 'danger' ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {label}
    </button>
  );
}

interface ActivityData {
  id: string;
  type: string;
  timestamp: Date;
  content: string;
  tool?: string;
  status?: 'running' | 'done' | 'error';
}

function ActivityItem({ activity }: { activity: ActivityData }) {
  const typeColors: Record<string, string> = {
    action: '#3b82f6',
    result: '#4ade80',
    thinking: '#f59e0b',
    error: '#ef4444',
    info: '#888',
    tool_progress: '#87ceeb',
  };

  const statusIcon = activity.status === 'running' ? '...' : activity.status === 'error' ? 'ERR' : '';
  const color = typeColors[activity.type] || '#888';

  // Truncate long content
  const displayContent = activity.content.length > 150
    ? activity.content.slice(0, 147) + '...'
    : activity.content;

  return (
    <div style={{ marginBottom: 4, fontSize: 10 }}>
      <span style={{ color: '#666' }}>
        {new Date(activity.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })}
      </span>
      {' '}
      {activity.tool && <span style={{ color: '#87ceeb' }}>[{activity.tool}]</span>}
      {' '}
      <span style={{ color }}>{displayContent}</span>
      {statusIcon && <span style={{ color: activity.status === 'error' ? '#ef4444' : '#888' }}> {statusIcon}</span>}
    </div>
  );
}

interface ProposalCardProps {
  proposal: {
    symbol: string;
    strategy: string;
    legs: Array<{
      optionType: string;
      strike: number;
      premium: number;
    }>;
    contracts?: number;
    entryPremiumTotal?: number;
  };
  critique: {
    approved: boolean;
    reasoning: string;
    riskLevel: string;
  } | null;
  onExecute: () => void;
  onDismiss: () => void;
  isProcessing: boolean;
}

function ProposalCard({ proposal, critique, onExecute, onDismiss, isProcessing }: ProposalCardProps) {
  const canExecute = critique?.approved && !isProcessing;

  return (
    <div
      style={{
        background: '#111',
        border: `1px solid ${critique?.approved ? '#4ade80' : critique ? '#ef4444' : '#333'}`,
        padding: 12,
        marginBottom: 12,
      }}
    >
      <p style={{ color: '#4ade80', marginBottom: 8, fontWeight: 500, fontSize: 11 }}>
        &gt; TRADE PROPOSAL
      </p>

      {/* Summary */}
      <div style={{ fontSize: 11, marginBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#888' }}>{proposal.symbol} {proposal.strategy}</span>
          <span style={{ color: '#4ade80' }}>${(proposal.entryPremiumTotal ?? 0).toFixed(0)}</span>
        </div>
        {proposal.legs.map((leg, i) => (
          <div key={i} style={{ color: '#666', fontSize: 10 }}>
            {leg.optionType} {leg.strike} @ ${(leg.premium ?? 0).toFixed(2)}
          </div>
        ))}
        {proposal.contracts && (
          <div style={{ color: '#888', fontSize: 10 }}>
            x{proposal.contracts} contracts
          </div>
        )}
      </div>

      {/* Critique */}
      {critique && (
        <div style={{ marginBottom: 8, fontSize: 10 }}>
          <span style={{ color: critique.approved ? '#4ade80' : '#ef4444' }}>
            {critique.approved ? 'APPROVED' : 'REJECTED'}
          </span>
          <span style={{ color: '#666' }}> ({critique.riskLevel} risk)</span>
          {critique.reasoning && (
            <p style={{ color: '#888', marginTop: 4, fontSize: 10 }}>
              {critique.reasoning.slice(0, 100)}...
            </p>
          )}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onExecute}
          disabled={!canExecute}
          style={{
            flex: 1,
            padding: '6px 0',
            background: canExecute ? '#4ade80' : '#333',
            border: 'none',
            color: canExecute ? '#000' : '#666',
            fontSize: 10,
            cursor: canExecute ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit',
            fontWeight: 500,
          }}
        >
          {isProcessing ? 'EXECUTING...' : 'EXECUTE'}
        </button>
        <button
          onClick={onDismiss}
          style={{
            flex: 1,
            padding: '6px 0',
            background: 'none',
            border: '1px solid #333',
            color: '#888',
            fontSize: 10,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          DISMISS
        </button>
      </div>
    </div>
  );
}
