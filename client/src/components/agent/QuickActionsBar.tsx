/**
 * QuickActionsBar - Primary operation buttons
 *
 * Replaces the chat text input with actionable buttons.
 * "Task First, Chat Second" - primary interaction through actions.
 * Includes AI direction suggestion to help guide strategy selection.
 */

import { BarChart3, Search, Briefcase, Square, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DirectionSuggestion } from '@/components/DirectionSuggestion';
import type { StrategyPreference } from '@shared/types/engine';

// Direction type from the prediction API
type DirectionType = 'PUT' | 'CALL' | 'STRANGLE' | 'NO_TRADE';

export type OperationType = 'analyze' | 'propose' | 'positions';

// Strategy display labels
const STRATEGY_LABELS: Record<StrategyPreference, string> = {
  'strangle': 'Strangle',
  'put-only': 'PUT Only',
  'call-only': 'CALL Only',
};

interface QuickActionsBarProps {
  onAction: (action: OperationType, options?: { message?: string; strategy?: StrategyPreference }) => void;
  isProcessing: boolean;
  canOperate: boolean;
  onStop?: () => void;
  strategy?: StrategyPreference;
  onStrategyChange?: (strategy: StrategyPreference) => void;
  symbol?: string;
  showSuggestion?: boolean;
}

export function QuickActionsBar({
  onAction,
  isProcessing,
  canOperate,
  onStop,
  strategy = 'strangle',
  onStrategyChange,
  symbol = 'SPY',
  showSuggestion = true,
}: QuickActionsBarProps) {
  const handleFindTrade = () => {
    onAction('propose', { strategy });
  };

  // Map direction prediction to strategy preference
  const handleSuggestionClick = (direction: DirectionType) => {
    if (!onStrategyChange) return;

    switch (direction) {
      case 'PUT':
        onStrategyChange('put-only');
        break;
      case 'CALL':
        onStrategyChange('call-only');
        break;
      case 'STRANGLE':
        onStrategyChange('strangle');
        break;
    }
  };

  // Map current strategy to direction for tracking
  const selectedDirection: DirectionType | null = strategy === 'put-only' ? 'PUT' :
    strategy === 'call-only' ? 'CALL' :
    strategy === 'strangle' ? 'STRANGLE' : null;

  return (
      <div className="border-t border-white/10 bg-charcoal p-4">
        {/* AI Direction Suggestion - shown above action buttons */}
        {showSuggestion && canOperate && (
          <div className="mb-3">
            <DirectionSuggestion
              symbol={symbol}
              onSuggestionClick={handleSuggestionClick}
              selectedDirection={selectedDirection}
              compact={false}
            />
          </div>
        )}

        <div className="flex items-center gap-3">
          {/* Analyze Market button */}
          <Button
            onClick={() => onAction('analyze')}
            disabled={!canOperate || isProcessing}
            variant="outline"
            className="flex-1 h-12 bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 disabled:opacity-50"
          >
            <BarChart3 className="w-4 h-4 mr-2" />
            Analyze Market
          </Button>

          {/* Find Trade button with strategy selector */}
          <div className="flex-1 flex items-center gap-0">
            <Button
              onClick={handleFindTrade}
              disabled={!canOperate || isProcessing}
              variant="outline"
              className="flex-1 h-12 bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 disabled:opacity-50 rounded-r-none border-r-0"
            >
              <Search className="w-4 h-4 mr-2" />
              Find Trade
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  disabled={!canOperate || isProcessing}
                  variant="outline"
                  className="h-12 px-3 bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 disabled:opacity-50 rounded-l-none"
                >
                  <span className="text-xs mr-1">{STRATEGY_LABELS[strategy]}</span>
                  <ChevronDown className="w-3 h-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-charcoal border-white/10">
                <DropdownMenuItem
                  onClick={() => onStrategyChange?.('strangle')}
                  className={strategy === 'strangle' ? 'bg-white/10' : ''}
                >
                  Strangle (PUT + CALL)
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onStrategyChange?.('put-only')}
                  className={strategy === 'put-only' ? 'bg-white/10' : ''}
                >
                  PUT Only (Bullish)
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onStrategyChange?.('call-only')}
                  className={strategy === 'call-only' ? 'bg-white/10' : ''}
                >
                  CALL Only (Bearish)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Positions button */}
          <Button
            onClick={() => onAction('positions')}
            disabled={!canOperate || isProcessing}
            variant="outline"
            className="flex-1 h-12 bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 disabled:opacity-50"
          >
            <Briefcase className="w-4 h-4 mr-2" />
            Positions
          </Button>

          {/* Stop button - only visible when processing */}
          {isProcessing && onStop && (
            <Button
              onClick={onStop}
              variant="destructive"
              className="h-12 px-4"
            >
              <Square className="w-4 h-4 mr-2" />
              Stop
            </Button>
          )}
        </div>

        {/* Disabled state message */}
        {!canOperate && (
          <p className="text-xs text-amber-400/80 mt-2 text-center">
            Connect LLM and IBKR to enable operations
          </p>
        )}
      </div>
  );
}
