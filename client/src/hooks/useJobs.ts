/**
 * Custom hook for Jobs API integration
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// ============================================
// Types
// ============================================

export interface Job {
  id: string;
  name: string;
  description: string | null;
  type: string;
  schedule: string;
  timezone: string;
  enabled: boolean;
  config: Record<string, unknown> | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  createdAt: string;
  updatedAt: string;
  latestRun?: JobRun;
}

export interface JobRun {
  id: string;
  jobId: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  triggeredBy: 'scheduler' | 'manual';
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  result: Record<string, unknown> | null;
  error: string | null;
  marketDay: string | null;
  createdAt: string;
}

export interface MarketStatus {
  isOpen: boolean;
  currentTimeET: string;
  marketCloseET: string;
  reason: string;
}

export interface MarketEvent {
  date: string;
  event: string;
  type: 'holiday' | 'early_close' | 'economic';
  impactLevel?: 'low' | 'medium' | 'high' | 'critical';
  time?: string;
}

export interface MarketCalendar {
  today: string;
  marketStatus: MarketStatus;
  upcomingEvents: MarketEvent[];
  calendar: Array<{
    date: string;
    isOpen: boolean;
    closeTime: string;
    holiday?: string;
    earlyClose?: boolean;
  }>;
}

export interface OptionChainSnapshot {
  id: string;
  symbol: string;
  capturedAt: string;
  marketDay: string;
  underlyingPrice: string | null;
  vix: string | null;
  expiration: string | null;
  chainData: {
    puts: unknown[];
    calls: unknown[];
  } | null;
  metadata: Record<string, unknown> | null;
}

// ============================================
// API Functions
// ============================================

async function fetchJobs(): Promise<{ ok: boolean; jobs: Job[] }> {
  const response = await fetch('/api/jobs', { credentials: 'include' });
  if (!response.ok) throw new Error('Failed to fetch jobs');
  return response.json();
}

async function fetchJobHistory(limit = 50): Promise<{ ok: boolean; history: JobRun[] }> {
  const response = await fetch(`/api/jobs/history?limit=${limit}`, { credentials: 'include' });
  if (!response.ok) throw new Error('Failed to fetch job history');
  return response.json();
}

async function fetchMarketCalendar(): Promise<MarketCalendar & { ok: boolean }> {
  const response = await fetch('/api/jobs/calendar', { credentials: 'include' });
  if (!response.ok) throw new Error('Failed to fetch market calendar');
  return response.json();
}

async function runJob(
  jobId: string,
  options?: { forceRun?: boolean; skipMarketCheck?: boolean }
): Promise<{ ok: boolean; jobRun: JobRun }> {
  const response = await fetch(`/api/jobs/${jobId}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(options || {}),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Failed to run job');
  }
  return response.json();
}

async function toggleJob(
  jobId: string,
  enabled: boolean
): Promise<{ ok: boolean; job: Job }> {
  const response = await fetch(`/api/jobs/${jobId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || 'Failed to update job');
  }
  return response.json();
}

async function fetchLatestSnapshot(symbol: string): Promise<{ ok: boolean; snapshot: OptionChainSnapshot | null }> {
  const response = await fetch(`/api/jobs/snapshots/${symbol}/latest`, { credentials: 'include' });
  if (response.status === 404) return { ok: true, snapshot: null };
  if (!response.ok) throw new Error('Failed to fetch snapshot');
  return response.json();
}

// ============================================
// Hook
// ============================================

export function useJobs() {
  const queryClient = useQueryClient();

  // Fetch all jobs
  const jobsQuery = useQuery({
    queryKey: ['jobs'],
    queryFn: fetchJobs,
    refetchInterval: 30000, // Poll every 30s
    select: (data) => data.jobs,
  });

  // Fetch job history
  const historyQuery = useQuery({
    queryKey: ['job-history'],
    queryFn: () => fetchJobHistory(50),
    refetchInterval: 30000,
    select: (data) => data.history,
  });

  // Fetch market calendar
  const calendarQuery = useQuery({
    queryKey: ['market-calendar'],
    queryFn: fetchMarketCalendar,
    refetchInterval: 60000, // Poll every minute
  });

  // Run job mutation
  const runJobMutation = useMutation({
    mutationFn: ({ jobId, options }: { jobId: string; options?: { forceRun?: boolean; skipMarketCheck?: boolean } }) =>
      runJob(jobId, options),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      queryClient.invalidateQueries({ queryKey: ['job-history'] });
    },
  });

  // Toggle job enabled/disabled mutation
  const toggleJobMutation = useMutation({
    mutationFn: ({ jobId, enabled }: { jobId: string; enabled: boolean }) =>
      toggleJob(jobId, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
  });

  // Computed values
  const marketStatus = calendarQuery.data?.marketStatus ?? null;
  const upcomingEvents = calendarQuery.data?.upcomingEvents ?? [];
  const today = calendarQuery.data?.today ?? '';

  return {
    // Data
    jobs: jobsQuery.data ?? [],
    history: historyQuery.data ?? [],
    marketStatus,
    upcomingEvents,
    today,
    calendar: calendarQuery.data?.calendar ?? [],

    // Loading states
    isLoading: jobsQuery.isLoading || historyQuery.isLoading,
    isLoadingCalendar: calendarQuery.isLoading,

    // Error states
    error: jobsQuery.error || historyQuery.error || calendarQuery.error,

    // Actions
    runJob: (jobId: string, options?: { forceRun?: boolean; skipMarketCheck?: boolean }) =>
      runJobMutation.mutateAsync({ jobId, options }),
    toggleJob: (jobId: string, enabled: boolean) =>
      toggleJobMutation.mutateAsync({ jobId, enabled }),

    // Mutation states
    isRunning: runJobMutation.isPending,
    isToggling: toggleJobMutation.isPending,

    // Refetch
    refetch: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      queryClient.invalidateQueries({ queryKey: ['job-history'] });
      queryClient.invalidateQueries({ queryKey: ['market-calendar'] });
    },

    // Snapshot helper
    fetchLatestSnapshot,
  };
}
