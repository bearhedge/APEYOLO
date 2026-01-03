/**
 * AutoRunToggle Component
 *
 * Toggle switch for enabling/disabling auto-run mode when AI accuracy >= 80%.
 * When auto-run is active, the AI automatically selects the direction based on its prediction.
 *
 * States:
 * - Locked (not eligible): Greyed out, shows progress message
 * - Unlocked but disabled: Shows toggle, user can enable
 * - Active (enabled): Shows toggle ON with warning about auto-selection
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, Unlock, Zap, AlertTriangle, Loader2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

interface AutoRunStatus {
  eligible: boolean;
  enabled: boolean;
  active: boolean;
  accuracy: number | null;
  predictionsCount: number;
}

interface AutoRunToggleProps {
  compact?: boolean;
  className?: string;
  onStatusChange?: (active: boolean) => void;
}

async function fetchAutoRunStatus(): Promise<AutoRunStatus> {
  const response = await fetch('/api/indicators/auto-run-status', {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error('Failed to fetch auto-run status');
  }
  return response.json();
}

async function toggleAutoRun(enabled: boolean): Promise<{ success: boolean; enabled: boolean; message: string }> {
  const response = await fetch('/api/indicators/auto-run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to toggle auto-run');
  }
  return response.json();
}

export function AutoRunToggle({ compact = false, className, onStatusChange }: AutoRunToggleProps) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: status, isLoading } = useQuery({
    queryKey: ['/api/indicators/auto-run-status'],
    queryFn: fetchAutoRunStatus,
    refetchInterval: 60000, // Refresh every minute
    staleTime: 30000,
  });

  const mutation = useMutation({
    mutationFn: toggleAutoRun,
    onSuccess: (data) => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['/api/indicators/auto-run-status'] });
      onStatusChange?.(data.enabled);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleToggle = (checked: boolean) => {
    setError(null);
    mutation.mutate(checked);
  };

  if (isLoading) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        <Loader2 className="w-4 h-4 animate-spin text-silver" />
        <span className="text-sm text-silver">Loading...</span>
      </div>
    );
  }

  if (!status) {
    return null;
  }

  // Compact mode - just the toggle with minimal info
  if (compact) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        {status.eligible ? (
          <>
            <Switch
              checked={status.enabled}
              onCheckedChange={handleToggle}
              disabled={mutation.isPending}
              className="data-[state=checked]:bg-electric"
            />
            {status.active && (
              <span className="flex items-center gap-1 text-xs text-electric">
                <Zap className="w-3 h-3" />
                Auto
              </span>
            )}
          </>
        ) : (
          <div className="flex items-center gap-1 text-xs text-silver">
            <Lock className="w-3 h-3" />
            <span>Locked</span>
          </div>
        )}
      </div>
    );
  }

  // Full mode with detailed info
  return (
    <div className={cn('p-4 rounded-lg border', className, {
      'bg-electric/10 border-electric/30': status.active,
      'bg-zinc-800/50 border-white/10': !status.active && status.eligible,
      'bg-zinc-900/50 border-white/5': !status.eligible,
    })}>
      {/* Header with toggle */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {status.eligible ? (
            <Unlock className="w-4 h-4 text-green-400" />
          ) : (
            <Lock className="w-4 h-4 text-silver" />
          )}
          <span className="font-medium">Auto-Run</span>
          {status.active && (
            <span className="px-1.5 py-0.5 text-xs font-medium bg-electric/20 text-electric rounded">
              ACTIVE
            </span>
          )}
        </div>
        <Switch
          checked={status.enabled}
          onCheckedChange={handleToggle}
          disabled={!status.eligible || mutation.isPending}
          className="data-[state=checked]:bg-electric"
        />
      </div>

      {/* Status message */}
      <div className="text-sm">
        {status.active ? (
          <div className="flex items-start gap-2 text-electric">
            <Zap className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium">AI will automatically select direction.</p>
              <p className="text-xs opacity-80 mt-0.5">You still approve trades before execution.</p>
            </div>
          </div>
        ) : status.eligible ? (
          <p className="text-silver">
            Auto-run available. Toggle to enable AI-driven direction selection.
          </p>
        ) : (
          <div className="text-silver">
            <p>Auto-run locked. Achieve 80% accuracy to unlock.</p>
            <p className="text-xs mt-1">
              Current: {status.accuracy !== null ? `${status.accuracy.toFixed(1)}%` : 'N/A'} ({status.predictionsCount}/50 predictions)
            </p>
          </div>
        )}
      </div>

      {/* Warning when active */}
      {status.active && (
        <div className="mt-3 p-2 bg-amber-500/10 border border-amber-500/20 rounded flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-amber-400">
            Auto-run is active. AI predictions will be auto-selected. You can still override before executing.
          </p>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="mt-2 p-2 bg-red-500/10 border border-red-500/20 rounded">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      {/* Loading state for mutation */}
      {mutation.isPending && (
        <div className="mt-2 flex items-center gap-2 text-xs text-silver">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Updating...</span>
        </div>
      )}
    </div>
  );
}

export default AutoRunToggle;
