/**
 * QuickActionsBar - Primary operation buttons
 *
 * Replaces the chat text input with actionable buttons.
 * "Task First, Chat Second" - primary interaction through actions.
 */

import { useState } from 'react';
import { BarChart3, Search, Briefcase, MessageSquare, Square, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import type { StrategyPreference } from '@shared/types/engine';

export type OperationType = 'analyze' | 'propose' | 'positions' | 'custom';

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
}

export function QuickActionsBar({
  onAction,
  isProcessing,
  canOperate,
  onStop,
  strategy = 'strangle',
  onStrategyChange,
}: QuickActionsBarProps) {
  const [customDialogOpen, setCustomDialogOpen] = useState(false);
  const [customMessage, setCustomMessage] = useState('');

  const handleCustomSubmit = () => {
    if (customMessage.trim()) {
      onAction('custom', { message: customMessage.trim() });
      setCustomMessage('');
      setCustomDialogOpen(false);
    }
  };

  const handleFindTrade = () => {
    onAction('propose', { strategy });
  };

  return (
    <>
      <div className="border-t border-white/10 bg-charcoal p-4">
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

          {/* Custom request button */}
          <Button
            onClick={() => setCustomDialogOpen(true)}
            disabled={!canOperate || isProcessing}
            variant="ghost"
            className="h-12 px-4 text-silver hover:text-white hover:bg-white/5"
          >
            <MessageSquare className="w-4 h-4 mr-2" />
            Custom
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

      {/* Custom request dialog */}
      <Dialog open={customDialogOpen} onOpenChange={setCustomDialogOpen}>
        <DialogContent className="bg-charcoal border-white/10">
          <DialogHeader>
            <DialogTitle>Custom Request</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Textarea
              placeholder="Ask the agent anything..."
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              className="min-h-[120px] bg-black/30 border-white/10 resize-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleCustomSubmit();
                }
              }}
            />
            <p className="text-xs text-silver mt-2">
              Press Enter to send, Shift+Enter for new line
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setCustomDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCustomSubmit}
              disabled={!customMessage.trim()}
            >
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
