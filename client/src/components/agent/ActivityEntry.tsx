/**
 * ActivityEntry - Individual entry in the activity feed
 *
 * Renders different types of agent activities:
 * - action: Tool being called (with spinner)
 * - result: Formatted tool result
 * - thinking: DeepSeek reasoning (always visible)
 * - error: Error message
 */

import { Loader2, CheckCircle, XCircle, Brain, Zap, AlertTriangle, User, Bot } from 'lucide-react';

export type ActivityType = 'action' | 'result' | 'thinking' | 'error' | 'info' | 'user-message' | 'assistant-message';

export interface ActivityEntryData {
  id: string;
  type: ActivityType;
  timestamp: Date;
  tool?: string;
  content: string;
  data?: any;
  status?: 'running' | 'done' | 'error';
}

interface ActivityEntryProps {
  entry: ActivityEntryData;
}

export function ActivityEntry({ entry }: ActivityEntryProps) {
  const { type, tool, content, status, timestamp } = entry;

  // Format timestamp
  const timeStr = timestamp.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  // Render based on type
  switch (type) {
    case 'action':
      return (
        <div className="flex items-start gap-3 py-2">
          <div className="flex-shrink-0 mt-0.5">
            {status === 'running' ? (
              <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
            ) : status === 'done' ? (
              <CheckCircle className="w-4 h-4 text-green-400" />
            ) : (
              <XCircle className="w-4 h-4 text-red-400" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-white">{content}</span>
              {tool && (
                <span className="text-xs font-mono bg-white/10 px-1.5 py-0.5 rounded text-silver">
                  {tool}
                </span>
              )}
            </div>
            <span className="text-xs text-silver/60">{timeStr}</span>
          </div>
        </div>
      );

    case 'result':
      return (
        <div className="py-2 pl-7">
          <div className="bg-black/30 rounded-lg p-3 border border-white/5">
            <div className="flex items-center gap-2 mb-1">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-xs font-medium text-silver">Result</span>
            </div>
            <div className="text-sm text-white font-mono whitespace-pre-wrap">
              {content}
            </div>
          </div>
        </div>
      );

    case 'thinking':
      return (
        <div className="py-2">
          <div className="bg-blue-500/5 rounded-lg p-3 border border-blue-500/20">
            <div className="flex items-center gap-2 mb-2">
              <Brain className="w-4 h-4 text-blue-400" />
              <span className="text-xs font-medium text-blue-400">Thinking</span>
              <span className="text-xs text-silver/60">{timeStr}</span>
            </div>
            <div className="text-sm text-silver whitespace-pre-wrap font-mono leading-relaxed">
              {content}
            </div>
          </div>
        </div>
      );

    case 'error':
      return (
        <div className="py-2">
          <div className="bg-red-500/10 rounded-lg p-3 border border-red-500/20">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              <span className="text-sm text-red-400">{content}</span>
            </div>
          </div>
        </div>
      );

    case 'user-message':
      return (
        <div className="py-2 flex justify-end">
          <div className="max-w-[80%] bg-blue-600/20 rounded-lg p-3 border border-blue-500/30">
            <div className="flex items-center gap-2 mb-1">
              <User className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-xs font-medium text-blue-400">You</span>
              <span className="text-xs text-silver/60">{timeStr}</span>
            </div>
            <div className="text-sm text-white whitespace-pre-wrap">
              {content}
            </div>
          </div>
        </div>
      );

    case 'assistant-message':
      return (
        <div className="py-2">
          <div className="max-w-[80%] bg-white/5 rounded-lg p-3 border border-white/10">
            <div className="flex items-center gap-2 mb-1">
              <Bot className="w-3.5 h-3.5 text-green-400" />
              <span className="text-xs font-medium text-green-400">Agent</span>
              <span className="text-xs text-silver/60">{timeStr}</span>
              {status === 'running' && (
                <Loader2 className="w-3 h-3 text-silver animate-spin" />
              )}
            </div>
            <div className="text-sm text-white whitespace-pre-wrap">
              {content || '...'}
            </div>
          </div>
        </div>
      );

    case 'info':
    default:
      return (
        <div className="py-2 pl-7">
          <div className="text-sm text-silver">{content}</div>
          <span className="text-xs text-silver/60">{timeStr}</span>
        </div>
      );
  }
}
