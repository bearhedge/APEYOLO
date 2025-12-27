/**
 * ActivityLog - Manus-style event visibility
 *
 * Shows all orchestrator events in a chronological list.
 * Entries are collapsed by default, expandable for details.
 */

import { useState } from 'react';
import { useAgentStore } from '@/lib/agentStore';
import { ChevronDown, ChevronRight } from 'lucide-react';

export function ActivityLog() {
  const { activityLog } = useAgentStore();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

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
      default: return '·';
    }
  };

  const getIconColor = (eventType: string) => {
    switch (eventType) {
      case 'tool_done': return 'text-green-400';
      case 'tool_error': return 'text-red-400';
      case 'tool_start': return 'text-blue-400';
      case 'state_change': return 'text-amber-400';
      default: return 'text-silver/50';
    }
  };

  return (
    <div className="space-y-1 text-sm font-mono max-h-64 overflow-y-auto">
      {activityLog.length === 0 ? (
        <div className="text-silver/50 text-center py-4">
          No activity yet
        </div>
      ) : (
        activityLog.map((entry) => (
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
              {entry.summary && (
                <span className="text-silver/50 text-xs flex-shrink-0">{entry.summary}</span>
              )}
            </div>
            {entry.isExpandable && expandedIds.has(entry.id) && entry.details && (
              <div className="ml-6 mt-1 p-2 bg-white/5 text-xs text-silver overflow-x-auto rounded">
                <pre className="whitespace-pre-wrap break-words">
                  {JSON.stringify(entry.details.result, null, 2)?.slice(0, 500)}
                  {JSON.stringify(entry.details.result, null, 2)?.length > 500 ? '...' : ''}
                </pre>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
