// server/agent/memory/service.ts
// Database-backed memory service for CodeAct agent
import { db } from '../../db';
import { agentMemory, agentCodeActEvents } from '@shared/schema';
import { eq, desc } from 'drizzle-orm';

export class AgentMemoryService {
  // File-like memory operations
  async read(key: string): Promise<string | null> {
    if (!db) {
      console.warn('[AgentMemory] Database not available');
      return null;
    }
    const result = await db.select()
      .from(agentMemory)
      .where(eq(agentMemory.key, key))
      .limit(1);
    return result[0]?.content ?? null;
  }

  async write(key: string, content: string): Promise<void> {
    if (!db) {
      console.warn('[AgentMemory] Database not available');
      return;
    }
    await db.insert(agentMemory)
      .values({ key, content, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: agentMemory.key,
        set: { content, updatedAt: new Date() }
      });
  }

  async append(key: string, content: string): Promise<void> {
    const existing = await this.read(key);
    const newContent = existing ? `${existing}\n${content}` : content;
    await this.write(key, newContent);
  }

  // Event stream operations
  async logEvent(sessionId: string, type: string, content: string, metadata?: any): Promise<void> {
    if (!db) {
      console.warn('[AgentMemory] Database not available');
      return;
    }
    await db.insert(agentCodeActEvents).values({
      sessionId,
      type,
      content,
      metadata,
      timestamp: new Date(),
    });
  }

  async getRecentEvents(limit: number = 50): Promise<any[]> {
    if (!db) {
      return [];
    }
    return db.select()
      .from(agentCodeActEvents)
      .orderBy(desc(agentCodeActEvents.timestamp))
      .limit(limit);
  }

  async getSessionEvents(sessionId: string): Promise<any[]> {
    if (!db) {
      return [];
    }
    return db.select()
      .from(agentCodeActEvents)
      .where(eq(agentCodeActEvents.sessionId, sessionId))
      .orderBy(agentCodeActEvents.timestamp);
  }
}

export const memoryService = new AgentMemoryService();
