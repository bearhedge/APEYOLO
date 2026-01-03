import { useQuery } from '@tanstack/react-query';
import { Brain, TrendingUp, TrendingDown, Lock, Unlock, Target, Users, UserX } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { AutoRunToggle } from './AutoRunToggle';

interface AccuracyStats {
  totalPredictions: number;
  correctPredictions: number;
  accuracy: number;
  last50Accuracy: number | null;
  overrideStats: {
    overrideCount: number;
    overrideCorrectCount: number;
    overrideAccuracy: number | null;
  };
  agreementStats: {
    agreedCount: number;
    agreedCorrectCount: number;
    agreedAccuracy: number | null;
  };
  autoRunEligible: boolean;
}

async function fetchAccuracyStats(): Promise<AccuracyStats> {
  const response = await fetch('/api/indicators/accuracy', {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error('Failed to fetch accuracy stats');
  }
  return response.json();
}

export function AccuracyDashboard() {
  const { data: stats, isLoading, error } = useQuery({
    queryKey: ['/api/indicators/accuracy'],
    queryFn: fetchAccuracyStats,
    refetchInterval: 60000, // Refresh every minute
  });

  if (isLoading) {
    return (
      <Card className="bg-charcoal border-white/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5" />
            AI Prediction Accuracy
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-white/5 rounded w-1/2" />
            <div className="h-4 bg-white/5 rounded w-3/4" />
            <div className="h-4 bg-white/5 rounded w-2/3" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !stats) {
    return (
      <Card className="bg-charcoal border-white/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5" />
            AI Prediction Accuracy
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-silver text-sm">Unable to load accuracy stats</p>
        </CardContent>
      </Card>
    );
  }

  const AUTO_RUN_THRESHOLD = 80;
  const progressToAutoRun = stats.last50Accuracy !== null
    ? Math.min(100, (stats.last50Accuracy / AUTO_RUN_THRESHOLD) * 100)
    : 0;

  // Calculate how many more correct predictions needed for auto-run
  const predictionsNeeded = stats.last50Accuracy !== null && stats.last50Accuracy < AUTO_RUN_THRESHOLD
    ? Math.ceil((AUTO_RUN_THRESHOLD - stats.last50Accuracy) * 0.5) // Rough estimate
    : 0;

  return (
    <Card className="bg-charcoal border-white/10">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5" />
            AI Prediction Accuracy
          </div>
          {/* Auto-run status badge */}
          <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${
            stats.autoRunEligible
              ? 'bg-green-500/20 text-green-400 border border-green-500/30'
              : 'bg-zinc-800 text-silver border border-white/10'
          }`}>
            {stats.autoRunEligible ? (
              <>
                <Unlock className="w-4 h-4" />
                Auto-run Unlocked
              </>
            ) : (
              <>
                <Lock className="w-4 h-4" />
                Auto-run Locked
              </>
            )}
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Main accuracy display */}
        <div className="text-center">
          <div className="text-5xl font-bold tabular-nums mb-1">
            {stats.accuracy.toFixed(1)}%
          </div>
          <p className="text-silver text-sm">
            AI suggested {stats.totalPredictions} times, correct {stats.correctPredictions} times
          </p>
        </div>

        {/* Progress toward auto-run */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-silver">Progress to Auto-run ({AUTO_RUN_THRESHOLD}% required)</span>
            <span className="font-medium tabular-nums">
              {stats.last50Accuracy !== null ? `${stats.last50Accuracy.toFixed(1)}%` : 'N/A'}
            </span>
          </div>
          <Progress
            value={progressToAutoRun}
            className="h-3"
          />
          {!stats.autoRunEligible && stats.totalPredictions < 50 && (
            <p className="text-xs text-silver">
              Need at least 50 predictions for auto-run eligibility ({stats.totalPredictions}/50)
            </p>
          )}
          {!stats.autoRunEligible && stats.totalPredictions >= 50 && predictionsNeeded > 0 && (
            <p className="text-xs text-silver">
              Approximately {predictionsNeeded} more correct predictions needed
            </p>
          )}
        </div>

        {/* Auto-Run Toggle */}
        <AutoRunToggle />

        {/* Agreement vs Override comparison */}
        <div className="grid grid-cols-2 gap-4">
          {/* When user followed AI */}
          <div className="p-4 bg-dark-gray rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-4 h-4 text-blue-400" />
              <span className="text-sm font-medium">Followed AI</span>
            </div>
            <div className="text-2xl font-bold tabular-nums mb-1">
              {stats.agreementStats.agreedAccuracy !== null
                ? `${stats.agreementStats.agreedAccuracy.toFixed(1)}%`
                : 'N/A'}
            </div>
            <p className="text-xs text-silver">
              {stats.agreementStats.agreedCorrectCount} / {stats.agreementStats.agreedCount} correct
            </p>
          </div>

          {/* When user overrode AI */}
          <div className="p-4 bg-dark-gray rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <UserX className="w-4 h-4 text-amber-400" />
              <span className="text-sm font-medium">Overrode AI</span>
            </div>
            <div className="text-2xl font-bold tabular-nums mb-1">
              {stats.overrideStats.overrideAccuracy !== null
                ? `${stats.overrideStats.overrideAccuracy.toFixed(1)}%`
                : 'N/A'}
            </div>
            <p className="text-xs text-silver">
              {stats.overrideStats.overrideCorrectCount} / {stats.overrideStats.overrideCount} correct
            </p>
          </div>
        </div>

        {/* Insight about following vs overriding */}
        {stats.agreementStats.agreedAccuracy !== null && stats.overrideStats.overrideAccuracy !== null && (
          <div className={`p-3 rounded-lg border ${
            stats.agreementStats.agreedAccuracy > stats.overrideStats.overrideAccuracy
              ? 'bg-blue-500/10 border-blue-500/20'
              : stats.overrideStats.overrideAccuracy > stats.agreementStats.agreedAccuracy
                ? 'bg-amber-500/10 border-amber-500/20'
                : 'bg-white/5 border-white/10'
          }`}>
            <div className="flex items-center gap-2">
              {stats.agreementStats.agreedAccuracy > stats.overrideStats.overrideAccuracy ? (
                <>
                  <TrendingUp className="w-4 h-4 text-blue-400" />
                  <span className="text-sm">
                    Following AI yields {(stats.agreementStats.agreedAccuracy - stats.overrideStats.overrideAccuracy).toFixed(1)}% better results
                  </span>
                </>
              ) : stats.overrideStats.overrideAccuracy > stats.agreementStats.agreedAccuracy ? (
                <>
                  <Target className="w-4 h-4 text-amber-400" />
                  <span className="text-sm">
                    Your overrides outperform AI by {(stats.overrideStats.overrideAccuracy - stats.agreementStats.agreedAccuracy).toFixed(1)}%
                  </span>
                </>
              ) : (
                <>
                  <TrendingDown className="w-4 h-4 text-silver" />
                  <span className="text-sm text-silver">
                    Equal performance when following or overriding AI
                  </span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Empty state */}
        {stats.totalPredictions === 0 && (
          <div className="text-center py-4">
            <p className="text-silver text-sm">
              No predictions recorded yet. Start trading to build your accuracy history.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
