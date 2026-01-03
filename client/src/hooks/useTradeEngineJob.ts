import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface TradeEngineJob {
  id: string;
  name: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  schedule: string;
}

interface JobResponse {
  ok: boolean;
  job: TradeEngineJob;
}

async function fetchTradeEngineJob(): Promise<TradeEngineJob> {
  const response = await fetch('/api/jobs/trade-engine', {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error('Failed to fetch trade-engine job');
  }
  const data: JobResponse = await response.json();
  return data.job;
}

async function setTradeEngineEnabled(enabled: boolean): Promise<TradeEngineJob> {
  const response = await fetch('/api/jobs/trade-engine', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) {
    throw new Error('Failed to update trade-engine job');
  }
  const data: JobResponse = await response.json();
  return data.job;
}

export function useTradeEngineJob() {
  const queryClient = useQueryClient();

  const { data: job, isLoading, error } = useQuery({
    queryKey: ['trade-engine-job'],
    queryFn: fetchTradeEngineJob,
    staleTime: 30000,
  });

  const mutation = useMutation({
    mutationFn: setTradeEngineEnabled,
    onSuccess: (updatedJob) => {
      queryClient.setQueryData(['trade-engine-job'], updatedJob);
    },
  });

  return {
    job,
    isLoading,
    error,
    isEnabled: job?.enabled ?? false,
    setEnabled: mutation.mutate,
    isUpdating: mutation.isPending,
  };
}
