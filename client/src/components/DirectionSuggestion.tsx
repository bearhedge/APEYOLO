/**
 * DirectionSuggestion Component
 *
 * Displays the AI's recommended direction (PUT/CALL/STRANGLE) with confidence level.
 * Part of the RLHF integration - shows prediction before user selects direction.
 *
 * Features:
 * - Fetches prediction from /api/indicators/:symbol/predict
 * - Color-coded badge for direction (green=CALL, red=PUT, purple=STRANGLE)
 * - Confidence level display
 * - Expandable reasoning section showing indicator signals and historical accuracy
 * - Tracks when user agrees/disagrees with suggestion
 */

import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, Brain, History, BarChart3, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

// Types matching the API response
export type DirectionType = 'PUT' | 'CALL' | 'STRANGLE' | 'NO_TRADE';

interface DirectionPrediction {
  direction: DirectionType;
  confidence: number;
  reasoning: {
    indicatorSignal: string;
    indicatorConfidence: number;
    historicalAccuracy: number | null;
    matchingPatterns: number;
  };
  predictionId?: string;
}

interface DirectionSuggestionProps {
  symbol?: string;
  onSuggestionClick?: (direction: DirectionType) => void;
  selectedDirection?: DirectionType | null;
  compact?: boolean;
  className?: string;
}

// Direction styling configuration
const directionConfig: Record<DirectionType, {
  label: string;
  Icon: typeof TrendingUp;
  bgColor: string;
  textColor: string;
  borderColor: string;
  description: string;
}> = {
  CALL: {
    label: 'CALL',
    Icon: TrendingDown,
    bgColor: 'bg-green-500/15',
    textColor: 'text-green-400',
    borderColor: 'border-green-500/30',
    description: 'Sell CALL - bearish on underlying',
  },
  PUT: {
    label: 'PUT',
    Icon: TrendingUp,
    bgColor: 'bg-red-500/15',
    textColor: 'text-red-400',
    borderColor: 'border-red-500/30',
    description: 'Sell PUT - bullish on underlying',
  },
  STRANGLE: {
    label: 'STRANGLE',
    Icon: Minus,
    bgColor: 'bg-purple-500/15',
    textColor: 'text-purple-400',
    borderColor: 'border-purple-500/30',
    description: 'Sell both PUT and CALL - neutral',
  },
  NO_TRADE: {
    label: 'NO TRADE',
    Icon: AlertCircle,
    bgColor: 'bg-zinc-500/15',
    textColor: 'text-zinc-400',
    borderColor: 'border-zinc-500/30',
    description: 'Conditions not favorable',
  },
};

// Confidence color based on level
function getConfidenceColor(confidence: number): string {
  if (confidence >= 75) return 'text-green-400';
  if (confidence >= 50) return 'text-yellow-400';
  return 'text-red-400';
}

// Confidence bar color
function getConfidenceBarColor(confidence: number): string {
  if (confidence >= 75) return 'bg-green-500';
  if (confidence >= 50) return 'bg-yellow-500';
  return 'bg-red-500';
}

export function DirectionSuggestion({
  symbol = 'SPY',
  onSuggestionClick,
  selectedDirection,
  compact = false,
  className,
}: DirectionSuggestionProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [lastPredictionId, setLastPredictionId] = useState<string | null>(null);

  // Fetch prediction from API
  const {
    data: prediction,
    isLoading,
    error,
    refetch,
  } = useQuery<DirectionPrediction>({
    queryKey: ['direction-prediction', symbol],
    queryFn: async () => {
      const response = await fetch(`/api/indicators/${symbol}/predict`, {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Failed to fetch prediction');
      }
      return response.json();
    },
    staleTime: 30000, // Refetch every 30 seconds
    refetchInterval: 30000,
    retry: 2,
  });

  // Update prediction with user's choice
  const updateUserChoice = useCallback(async (predictionId: string | undefined, userChoice: DirectionType, aiSuggestion: DirectionType) => {
    if (!predictionId) return;

    try {
      await fetch(`/api/indicators/predictions/${predictionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          userChoice,
          agreedWithAi: userChoice === aiSuggestion,
        }),
      });
      console.log(`[DirectionSuggestion] Updated prediction ${predictionId}: user chose ${userChoice}, agreed=${userChoice === aiSuggestion}`);
    } catch (err) {
      console.error('[DirectionSuggestion] Failed to update user choice:', err);
    }
  }, []);

  // Track when user selects a direction that agrees/disagrees with AI
  useEffect(() => {
    if (selectedDirection && prediction && lastPredictionId !== prediction.predictionId) {
      // User has made a selection - update the prediction record
      updateUserChoice(prediction.predictionId, selectedDirection, prediction.direction);
      setLastPredictionId(prediction.predictionId || null);
    }
  }, [selectedDirection, prediction, lastPredictionId, updateUserChoice]);

  // Handle click on suggestion badge
  const handleSuggestionClick = () => {
    if (prediction && onSuggestionClick && prediction.direction !== 'NO_TRADE') {
      onSuggestionClick(prediction.direction);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className={cn('flex items-center gap-2 px-3 py-2 rounded-lg bg-charcoal border border-white/10', className)}>
        <Loader2 className="w-4 h-4 animate-spin text-silver" />
        <span className="text-sm text-silver">Analyzing...</span>
      </div>
    );
  }

  // Error state
  if (error || !prediction) {
    return (
      <div className={cn('flex items-center gap-2 px-3 py-2 rounded-lg bg-charcoal border border-white/10', className)}>
        <AlertCircle className="w-4 h-4 text-red-400" />
        <span className="text-sm text-silver">Unable to get AI suggestion</span>
        <button
          onClick={() => refetch()}
          className="text-xs text-blue-400 hover:text-blue-300 ml-auto"
        >
          Retry
        </button>
      </div>
    );
  }

  const config = directionConfig[prediction.direction];
  const { Icon } = config;

  // Compact mode - just the badge
  if (compact) {
    return (
      <button
        onClick={handleSuggestionClick}
        disabled={prediction.direction === 'NO_TRADE'}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all',
          config.bgColor,
          config.borderColor,
          prediction.direction !== 'NO_TRADE' && 'hover:opacity-80 cursor-pointer',
          prediction.direction === 'NO_TRADE' && 'opacity-60 cursor-not-allowed',
          className
        )}
      >
        <Brain className="w-3.5 h-3.5 text-silver" />
        <Icon className={cn('w-4 h-4', config.textColor)} />
        <span className={cn('text-sm font-medium', config.textColor)}>
          {config.label}
        </span>
        <span className={cn('text-xs', getConfidenceColor(prediction.confidence))}>
          {prediction.confidence}%
        </span>
      </button>
    );
  }

  // Full mode with expandable reasoning
  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <div className={cn(
        'rounded-lg border transition-all',
        config.bgColor,
        config.borderColor,
        className
      )}>
        {/* Header - always visible */}
        <div className="flex items-center justify-between p-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Brain className="w-4 h-4 text-silver" />
              <span className="text-xs text-silver font-medium">AI SUGGESTS</span>
            </div>

            <button
              onClick={handleSuggestionClick}
              disabled={prediction.direction === 'NO_TRADE'}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 rounded-md transition-all',
                'bg-white/5 border border-white/10',
                prediction.direction !== 'NO_TRADE' && 'hover:bg-white/10 cursor-pointer',
                prediction.direction === 'NO_TRADE' && 'opacity-60 cursor-not-allowed'
              )}
            >
              <Icon className={cn('w-5 h-5', config.textColor)} />
              <span className={cn('font-semibold', config.textColor)}>
                SELL {config.label}
              </span>
            </button>

            {/* Confidence indicator */}
            <div className="flex items-center gap-2">
              <div className="w-16 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all', getConfidenceBarColor(prediction.confidence))}
                  style={{ width: `${prediction.confidence}%` }}
                />
              </div>
              <span className={cn('text-sm font-mono', getConfidenceColor(prediction.confidence))}>
                {prediction.confidence}%
              </span>
            </div>
          </div>

          {/* Expand toggle */}
          <CollapsibleTrigger asChild>
            <button className="p-1.5 hover:bg-white/10 rounded transition-colors">
              {isExpanded ? (
                <ChevronUp className="w-4 h-4 text-silver" />
              ) : (
                <ChevronDown className="w-4 h-4 text-silver" />
              )}
            </button>
          </CollapsibleTrigger>
        </div>

        {/* Expandable reasoning section */}
        <CollapsibleContent>
          <div className="px-3 pb-3 pt-0 border-t border-white/5">
            <div className="pt-3 space-y-3">
              {/* Indicator signal */}
              <div className="flex items-start gap-2">
                <BarChart3 className="w-4 h-4 text-silver mt-0.5" />
                <div>
                  <p className="text-xs text-silver font-medium mb-1">Indicator Signal</p>
                  <p className="text-sm">
                    <span className={cn(
                      'font-medium',
                      prediction.reasoning.indicatorSignal === 'CALL' ? 'text-green-400' :
                      prediction.reasoning.indicatorSignal === 'PUT' ? 'text-red-400' :
                      prediction.reasoning.indicatorSignal === 'STRANGLE' ? 'text-purple-400' :
                      'text-zinc-400'
                    )}>
                      {prediction.reasoning.indicatorSignal}
                    </span>
                    <span className="text-silver ml-2">
                      ({prediction.reasoning.indicatorConfidence}% confidence)
                    </span>
                  </p>
                </div>
              </div>

              {/* Historical accuracy */}
              <div className="flex items-start gap-2">
                <History className="w-4 h-4 text-silver mt-0.5" />
                <div>
                  <p className="text-xs text-silver font-medium mb-1">Historical Performance</p>
                  {prediction.reasoning.historicalAccuracy !== null ? (
                    <p className="text-sm">
                      <span className={cn('font-medium', getConfidenceColor(prediction.reasoning.historicalAccuracy))}>
                        {prediction.reasoning.historicalAccuracy.toFixed(0)}% accuracy
                      </span>
                      <span className="text-silver ml-2">
                        from {prediction.reasoning.matchingPatterns} similar patterns
                      </span>
                    </p>
                  ) : (
                    <p className="text-sm text-silver">
                      Insufficient historical data ({prediction.reasoning.matchingPatterns} patterns)
                    </p>
                  )}
                </div>
              </div>

              {/* Description */}
              <p className="text-xs text-silver italic pl-6">
                {config.description}
              </p>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export default DirectionSuggestion;
