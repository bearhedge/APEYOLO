import { db } from '../db';
import { agentLogs } from '@shared/schema';
import { EventEmitter } from 'events';

// Log entry types
export type LogType = 'WAKE' | 'DATA' | 'THINK' | 'TOOL' | 'OBSERVE' | 'ESCALATE' | 'DECIDE' | 'ACTION' | 'SLEEP' | 'ERROR';

export interface LogEntry {
  sessionId: string;
  type: LogType;
  message: string;
}

// EventEmitter for real-time streaming to UI
export const agentEvents = new EventEmitter();

// Set max listeners higher to avoid warnings when multiple SSE clients connect
agentEvents.setMaxListeners(50);

export class AgentLogger {
  async log(entry: LogEntry): Promise<void> {
    const timestamp = new Date();
    const formatted = `${this.formatTime(timestamp)} | ${entry.type.padEnd(8)} | ${entry.message}`;

    // Console log
    console.log(`[Agent] ${formatted}`);

    // Store in DB if available
    if (db) {
      try {
        await db.insert(agentLogs).values({
          sessionId: entry.sessionId,
          timestamp,
          type: entry.type,
          message: entry.message,
        });
      } catch (error: any) {
        console.error(`[Agent] Failed to store log: ${error.message}`);
      }
    }

    // Emit for real-time UI
    agentEvents.emit('log', {
      timestamp: timestamp.toISOString(),
      sessionId: entry.sessionId,
      type: entry.type,
      message: entry.message,
      formatted,
    });
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
