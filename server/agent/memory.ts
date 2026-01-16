import { db } from '../db';
import { agentObservations } from '@shared/schema';
import { desc, eq } from 'drizzle-orm';
import { AgentContext, Observation, TriageResult, Decision } from './types';

export class AgentMemory {
  // In-memory cache for quick access (last N observations)
  private cache: Observation[] = [];
  private maxCacheSize = 20;

  async storeObservation(
    sessionId: string,
    context: AgentContext,
    triageResult?: TriageResult,
    decision?: Decision
  ): Promise<void> {
    const observation: Observation = {
      sessionId,
      timestamp: new Date(),
      context,
      triageResult,
      decision,
    };

    // Add to in-memory cache
    this.cache.unshift(observation);
    if (this.cache.length > this.maxCacheSize) {
      this.cache.pop();
    }

    // Persist to database
    if (db) {
      try {
        await db.insert(agentObservations).values({
          sessionId,
          timestamp: observation.timestamp,
          spyPrice: context.spyPrice,
          vixLevel: context.vixLevel,
          positions: context.currentPosition ? [context.currentPosition] : [],
          context: {
            ...context,
            triageResult,
            decision,
          },
        });
      } catch (error: any) {
        console.error('[AgentMemory] Failed to store observation:', error.message);
      }
    }
  }

  async getRecent(count: number = 5): Promise<Observation[]> {
    // First try cache
    if (this.cache.length >= count) {
      return this.cache.slice(0, count);
    }

    // Otherwise load from database
    if (db) {
      try {
        const rows = await db
          .select()
          .from(agentObservations)
          .orderBy(desc(agentObservations.timestamp))
          .limit(count);

        return rows.map(row => ({
          sessionId: row.sessionId,
          timestamp: row.timestamp,
          context: row.context as AgentContext,
          triageResult: (row.context as any)?.triageResult,
          decision: (row.context as any)?.decision,
        }));
      } catch (error: any) {
        console.error('[AgentMemory] Failed to fetch observations:', error.message);
      }
    }

    return this.cache.slice(0, count);
  }

  async getSessionObservations(sessionId: string): Promise<Observation[]> {
    // Check cache first
    const cached = this.cache.filter(o => o.sessionId === sessionId);
    if (cached.length > 0) {
      return cached;
    }

    // Load from database
    if (db) {
      try {
        const rows = await db
          .select()
          .from(agentObservations)
          .where(eq(agentObservations.sessionId, sessionId))
          .orderBy(desc(agentObservations.timestamp));

        return rows.map(row => ({
          sessionId: row.sessionId,
          timestamp: row.timestamp,
          context: row.context as AgentContext,
          triageResult: (row.context as any)?.triageResult,
          decision: (row.context as any)?.decision,
        }));
      } catch (error: any) {
        console.error('[AgentMemory] Failed to fetch session observations:', error.message);
      }
    }

    return [];
  }

  // Get today's trading activity
  async getTodayStats(): Promise<{ trades: number; pnl: number }> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Count decisions that resulted in trades
    const todayObservations = this.cache.filter(o =>
      o.timestamp >= today && o.decision?.action === 'TRADE'
    );

    // For now, return from cache. Full implementation would query trades table.
    return {
      trades: todayObservations.length,
      pnl: 0, // Would come from positions/trades table
    };
  }

  clearCache(): void {
    this.cache = [];
  }
}

// Singleton
export const memory = new AgentMemory();
