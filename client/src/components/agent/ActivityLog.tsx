/**
 * ActivityLog - Manus-style event visibility
 *
 * Shows all orchestrator events AND automated job runs in a chronological list.
 * Entries are collapsed by default, expandable for details.
 */

import { useState, useMemo } from 'react';
import { useAgentStore, ActivityLogEntry } from '@/lib/agentStore';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Zap, Clock, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

// Types for job run history from /api/jobs/history
interface JobRun {
  id: string;
  jobId: string;
  status: 'running' | 'success' | 'failed' | 'skipped';
  triggeredBy: 'scheduler' | 'manual';
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  result?: any;
  error?: string;
  marketDay?: string;
}

interface JobHistoryResponse {
  ok: boolean;
  history: JobRun[];
}

// Types for trades from /api/public/trades
interface Trade {
  id: string;
  symbol: string;
  strategy: string;
  bias: string;
  contracts: number;
  entryPremiumTotal: string;
  realizedPnl: string | null;
  status: string;
  expiration: string;
  createdAt: string;
  closedAt: string | null;
  leg1Strike: string | null;
  leg2Strike: string | null;
}

interface TradesResponse {
  ok: boolean;
  trades: Trade[];
  count: number;
}

// Fetch job run history
async function fetchJobHistory(): Promise<JobHistoryResponse> {
  const response = await fetch('/api/jobs/history?limit=50', {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error('Failed to fetch job history');
  }
  return response.json();
}

// Fetch recent trades
async function fetchTrades(): Promise<TradesResponse> {
  const response = await fetch('/api/public/trades?limit=50', {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error('Failed to fetch trades');
  }
  return response.json();
}

// Transform a trade into an ActivityLogEntry
function tradeToActivity(trade: Trade): ActivityLogEntry {
  const pnl = trade.realizedPnl ? parseFloat(trade.realizedPnl) : null;
  const isWin = pnl !== null && pnl > 0;
  const isLoss = pnl !== null && pnl < 0;
  const isOpen = trade.status === 'open';

  // Format strategy name
  const strategyName = trade.strategy
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());

  // Build title
  let title = `${trade.symbol} ${strategyName}`;
  const strike1 = trade.leg1Strike ? Math.round(parseFloat(trade.leg1Strike)) : null;
  const strike2 = trade.leg2Strike ? Math.round(parseFloat(trade.leg2Strike)) : null;
  if (strike1 && strike2) {
    title += ` $${strike1}/$${strike2}`;
  } else if (strike1) {
    title += ` $${strike1}`;
  }

  // Build summary
  let summary = `${trade.contracts} contract${trade.contracts > 1 ? 's' : ''}`;
  if (pnl !== null) {
    const sign = pnl >= 0 ? '+' : '';
    summary += ` • ${sign}$${pnl.toFixed(0)}`;
  }

  // Determine event type for styling
  let eventType = 'trade_open';
  if (isWin) eventType = 'trade_win';
  else if (isLoss) eventType = 'trade_loss';
  else if (trade.status === 'expired' || trade.status === 'closed') eventType = 'trade_closed';

  return {
    id: `trade_${trade.id}`,
    timestamp: new Date(trade.createdAt).getTime(),
    eventType,
    title,
    summary,
    details: {
      result: {
        symbol: trade.symbol,
        strategy: trade.strategy,
        bias: trade.bias,
        contracts: trade.contracts,
        entry: trade.entryPremiumTotal,
        pnl: trade.realizedPnl,
        status: trade.status,
        expiration: trade.expiration,
      },
    },
    isExpandable: true,
  };
}

// Transform a job run into an ActivityLogEntry
function jobRunToActivity(run: JobRun): ActivityLogEntry {
  const isTradeEngine = run.jobId === 'trade-engine';
  const isSuccess = run.status === 'success';
  const isSkipped = run.status === 'skipped';
  const isFailed = run.status === 'failed';

  // Determine event type for styling
  let eventType = 'job_run';
  if (isSuccess) eventType = 'job_success';
  else if (isFailed) eventType = 'job_error';
  else if (isSkipped) eventType = 'job_skipped';

  // Build title based on job type
  let title = run.jobId.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  // Add status indicator
  if (isTradeEngine) {
    const decision = run.result?.decision;
    if (decision?.canTrade && run.result?.execution?.executed) {
      title = `Trade Engine: ${decision.direction || 'TRADE'} executed`;
    } else if (decision && !decision.canTrade) {
      title = `Trade Engine: No trade`;
    } else if (isSkipped) {
      title = `Trade Engine: Skipped`;
    } else if (isFailed) {
      title = `Trade Engine: Failed`;
    }
  }

  // Build summary
  let summary = '';
  if (run.durationMs) {
    summary = `${(run.durationMs / 1000).toFixed(1)}s`;
  }
  if (isSkipped && run.error) {
    summary = run.error.slice(0, 30);
  }

  return {
    id: `job_${run.id}`,
    timestamp: new Date(run.startedAt).getTime(),
    eventType,
    title,
    summary,
    details: {
      result: run.result,
      durationMs: run.durationMs,
      reasoning: run.error || undefined,
    },
    isExpandable: !!(run.result || run.error),
  };
}

export function ActivityLog() {
  const { activityLog } = useAgentStore();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Fetch job run history (polls every 15 seconds)
  const { data: jobHistory } = useQuery({
    queryKey: ['/api/jobs/history'],
    queryFn: fetchJobHistory,
    refetchInterval: 15000,
    staleTime: 5000,
  });

  // Fetch recent trades (polls every 15 seconds)
  const { data: tradesData } = useQuery({
    queryKey: ['/api/public/trades'],
    queryFn: fetchTrades,
    refetchInterval: 15000,
    staleTime: 5000,
  });

  // Merge agent activity log with job runs and trades, sorted by timestamp (newest first)
  const mergedLog = useMemo(() => {
    const jobEntries: ActivityLogEntry[] = [];
    const tradeEntries: ActivityLogEntry[] = [];

    if (jobHistory?.history) {
      // Only include meaningful job runs (not routine skipped checks)
      const meaningfulRuns = jobHistory.history.filter(run => {
        // Always show trade-engine runs
        if (run.jobId === 'trade-engine') return true;
        // Show failed runs
        if (run.status === 'failed') return true;
        // Show successful runs that had action
        if (run.status === 'success' && run.result) return true;
        // Filter out routine "skipped" checks from monitors
        return false;
      });

      // Add all meaningful job runs (final merge will limit to 50)
      for (const run of meaningfulRuns) {
        jobEntries.push(jobRunToActivity(run));
      }
    }

    // Add all recent trades (final merge will limit to 50)
    if (tradesData?.trades) {
      for (const trade of tradesData.trades) {
        tradeEntries.push(tradeToActivity(trade));
      }
    }

    // Merge and sort by timestamp (newest first)
    const merged = [...activityLog, ...jobEntries, ...tradeEntries];
    merged.sort((a, b) => b.timestamp - a.timestamp);

    return merged.slice(0, 50); // Keep last 50 entries
  }, [activityLog, jobHistory, tradesData]);

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const getIcon = (eventType: string) => {
    switch (eventType) {
      case 'tool_start': return '→';
      case 'tool_done': return '✓';
      case 'tool_error': return '✗';
      case 'thought': return '•';
      case 'state_change': return '◉';
      case 'job_success': return '⚡';
      case 'job_error': return '✗';
      case 'job_skipped': return '○';
      case 'job_run': return '⚙';
      case 'trade_win': return '$';
      case 'trade_loss': return '−';
      case 'trade_open': return '○';
      case 'trade_closed': return '✓';
      default: return '·';
    }
  };

  const getIconColor = (eventType: string) => {
    switch (eventType) {
      case 'tool_done': return 'text-green-400';
      case 'tool_error': return 'text-red-400';
      case 'tool_start': return 'text-blue-400';
      case 'state_change': return 'text-amber-400';
      case 'job_success': return 'text-emerald-400';
      case 'job_error': return 'text-red-400';
      case 'job_skipped': return 'text-silver/50';
      case 'job_run': return 'text-purple-400';
      case 'trade_win': return 'text-emerald-400';
      case 'trade_loss': return 'text-red-400';
      case 'trade_open': return 'text-blue-400';
      case 'trade_closed': return 'text-silver/70';
      default: return 'text-silver/50';
    }
  };

  // Format timestamp for display
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - timestamp;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="space-y-1 text-sm font-mono max-h-64 overflow-y-auto">
      {mergedLog.length === 0 ? (
        <div className="text-silver/50 text-center py-4">
          No activity yet
        </div>
      ) : (
        mergedLog.map((entry) => (
          <div key={entry.id} className="border-l-2 border-white/10 pl-3 py-0.5">
            <div
              className={`flex items-start gap-2 ${entry.isExpandable ? 'cursor-pointer hover:bg-white/5 rounded px-1 -mx-1' : ''}`}
              onClick={() => entry.isExpandable && toggleExpand(entry.id)}
            >
              {entry.isExpandable ? (
                expandedIds.has(entry.id)
                  ? <ChevronDown className="w-3 h-3 mt-1 flex-shrink-0 text-silver/50" />
                  : <ChevronRight className="w-3 h-3 mt-1 flex-shrink-0 text-silver/50" />
              ) : (
                <span className="w-3 flex-shrink-0" />
              )}
              <span className={`flex-shrink-0 ${getIconColor(entry.eventType)}`}>
                {getIcon(entry.eventType)}
              </span>
              <span className="text-white flex-1 truncate">{entry.title}</span>
              <span className="text-silver/40 text-xs flex-shrink-0">
                {formatTime(entry.timestamp)}
              </span>
            </div>
            {entry.isExpandable && expandedIds.has(entry.id) && entry.details && (
              <div className="ml-6 mt-1 p-2 bg-white/5 text-xs text-silver overflow-x-auto rounded">
                {entry.details.reasoning && (
                  <div className="mb-2 text-amber-400/80">{entry.details.reasoning}</div>
                )}
                {entry.details.result && (
                  <pre className="whitespace-pre-wrap break-words">
                    {JSON.stringify(entry.details.result, null, 2)?.slice(0, 800)}
                    {JSON.stringify(entry.details.result, null, 2)?.length > 800 ? '...' : ''}
                  </pre>
                )}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
