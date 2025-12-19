/**
 * ActivityFeed - Structured log of agent operations
 *
 * Replaces the chat interface with a task-oriented activity log.
 * Shows what the agent is doing, not a conversation.
 */

import { useEffect, useRef } from 'react';
import { ActivityEntry, type ActivityEntryData } from './ActivityEntry';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ActivityFeedProps {
  activities: ActivityEntryData[];
  isProcessing?: boolean;
  emptyMessage?: string;
}

export function ActivityFeed({
  activities,
  isProcessing = false,
  emptyMessage = 'Ready to operate. Use the buttons below to start.',
}: ActivityFeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new activities arrive
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activities.length]);

  if (activities.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-white/5 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-silver/40"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
          </div>
          <p className="text-silver text-sm">{emptyMessage}</p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1" ref={scrollRef}>
      <div className="p-4 space-y-1">
        {activities.map((activity) => (
          <ActivityEntry key={activity.id} entry={activity} />
        ))}

        {/* Processing indicator */}
        {isProcessing && (
          <div className="flex items-center gap-2 py-2 text-silver">
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <span className="text-xs">Processing...</span>
          </div>
        )}

        {/* Scroll anchor */}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
