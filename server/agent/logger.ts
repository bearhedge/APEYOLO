import { db } from '../db';
import { agentLogs } from '@shared/schema';
import { EventEmitter } from 'events';

// Ape-themed log types with display configuration
export const LOG_TYPES = {
  BANANA_TIME:   { label: 'BANANA TIME',   color: 'green' },
  APE_BRAIN:     { label: 'APE BRAIN',     color: 'cyan' },
  GRABBING_DATA: { label: 'GRABBING DATA', color: 'yellow' },
  FOUND_BANANA:  { label: 'FOUND BANANA',  color: 'white' },
  SWING_TIME:    { label: 'SWING TIME',    color: 'magenta' },
  NO_SWING:      { label: 'NO SWING',      color: 'gray' },
  BAD_BANANA:    { label: 'BAD BANANA',    color: 'red' },
  DANGER_BRANCH: { label: 'DANGER BRANCH', color: 'orange' },
  BACK_TO_TREE:  { label: 'BACK TO TREE',  color: 'green' },
} as const;

export type LogType = keyof typeof LOG_TYPES;

// SSE event types for streaming
export interface LogEvent {
  type: 'start' | 'append';
  logType?: LogType;
  text: string;
  timestamp?: string;
  sessionId?: string;
}

// EventEmitter for real-time streaming to UI
export const agentEvents = new EventEmitter();

// Set max listeners higher to avoid warnings when multiple SSE clients connect
agentEvents.setMaxListeners(50);

export class AgentLogger {
  private currentSessionId: string | null = null;

  setSessionId(sessionId: string): void {
    this.currentSessionId = sessionId;
  }

  /**
   * Start a new log block with timestamp and tag
   */
  start(logType: LogType, text: string): void {
    const timestamp = this.formatTime(new Date());
    const config = LOG_TYPES[logType];

    // Console log with formatted output
    console.log(`[Agent] ${timestamp} [${config.label}] ${text}`);

    // Store in DB if available
    this.storeLog(logType, text);

    // Emit for real-time UI
    const event: LogEvent = {
      type: 'start',
      logType,
      text,
      timestamp,
      sessionId: this.currentSessionId || undefined,
    };
    agentEvents.emit('log', event);
  }

  /**
   * Append text to current log block (no new timestamp or tag)
   */
  append(text: string): void {
    // Console log continuation
    process.stdout.write(text);

    // Emit for real-time UI
    const event: LogEvent = {
      type: 'append',
      text,
    };
    agentEvents.emit('log', event);
  }

  /**
   * Legacy log method for backwards compatibility
   */
  async log(entry: { sessionId: string; type: string; message: string }): Promise<void> {
    // Map old types to new types
    const typeMap: Record<string, LogType> = {
      'WAKE': 'BANANA_TIME',
      'THINK': 'APE_BRAIN',
      'TOOL': 'GRABBING_DATA',
      'DATA': 'FOUND_BANANA',
      'OBSERVE': 'FOUND_BANANA',
      'DECIDE': 'SWING_TIME',
      'ACTION': 'SWING_TIME',
      'SLEEP': 'BACK_TO_TREE',
      'ERROR': 'BAD_BANANA',
      'ESCALATE': 'DANGER_BRANCH',
    };

    const newType = typeMap[entry.type] || 'FOUND_BANANA';
    this.currentSessionId = entry.sessionId;
    this.start(newType, entry.message);
  }

  private async storeLog(logType: LogType, message: string): Promise<void> {
    if (!db || !this.currentSessionId) return;

    try {
      await db.insert(agentLogs).values({
        sessionId: this.currentSessionId,
        timestamp: new Date(),
        type: logType,
        message,
      });
    } catch (error: any) {
      console.error(`[Agent] Failed to store log: ${error.message}`);
    }
  }

  private formatTime(d: Date): string {
    return d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: 'America/New_York',
    });
  }
}

// Singleton instance
export const logger = new AgentLogger();
