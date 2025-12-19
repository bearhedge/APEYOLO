/**
 * QuickActionsBar - Primary operation buttons
 *
 * Replaces the chat text input with actionable buttons.
 * "Task First, Chat Second" - primary interaction through actions.
 */

import { useState } from 'react';
import { BarChart3, Search, Briefcase, MessageSquare, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

export type OperationType = 'analyze' | 'propose' | 'positions' | 'custom';

interface QuickActionsBarProps {
  onAction: (action: OperationType, customMessage?: string) => void;
  isProcessing: boolean;
  canOperate: boolean;
  onStop?: () => void;
}

export function QuickActionsBar({
  onAction,
  isProcessing,
  canOperate,
  onStop,
}: QuickActionsBarProps) {
  const [customDialogOpen, setCustomDialogOpen] = useState(false);
  const [customMessage, setCustomMessage] = useState('');

  const handleCustomSubmit = () => {
    if (customMessage.trim()) {
      onAction('custom', customMessage.trim());
      setCustomMessage('');
      setCustomDialogOpen(false);
    }
  };

  const actions = [
    {
      id: 'analyze' as const,
      label: 'Analyze Market',
      icon: BarChart3,
      description: 'Fetch market data and assess conditions',
    },
    {
      id: 'propose' as const,
      label: 'Find Trade',
      icon: Search,
      description: 'Run engine and find trading opportunity',
    },
    {
      id: 'positions' as const,
      label: 'Positions',
      icon: Briefcase,
      description: 'Check current portfolio',
    },
  ];

  return (
    <>
      <div className="border-t border-white/10 bg-charcoal p-4">
        <div className="flex items-center gap-3">
          {/* Main action buttons */}
          {actions.map((action) => (
            <Button
              key={action.id}
              onClick={() => onAction(action.id)}
              disabled={!canOperate || isProcessing}
              variant="outline"
              className="flex-1 h-12 bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 disabled:opacity-50"
            >
              <action.icon className="w-4 h-4 mr-2" />
              {action.label}
            </Button>
          ))}

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
