// server/lib/agent/memory.ts
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { Message, MessageRole } from './types';

const CACHE_TTL_MS = 60000; // 60 seconds default

export class AgentMemory {
  private db: Database.Database;

  constructor(dbPath: string = 'agent-memory.db') {
    this.db = new Database(dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
        summary TEXT
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata JSON,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
      );

      CREATE TABLE IF NOT EXISTS context_cache (
        conversation_id TEXT NOT NULL,
        cache_type TEXT NOT NULL,
        data JSON NOT NULL,
        cached_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (conversation_id, cache_type)
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_data JSON NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_audit_conv ON audit_log(conversation_id);
    `);
  }

  createConversation(userId: string): string {
    const id = uuidv4();
    this.db.prepare(`
      INSERT INTO conversations (id, user_id) VALUES (?, ?)
    `).run(id, userId);
    return id;
  }

  getOrCreateConversation(userId: string, existingId?: string): string {
    if (existingId) {
      const conv = this.db.prepare(`
        SELECT id FROM conversations WHERE id = ?
      `).get(existingId);
      if (conv) {
        this.db.prepare(`
          UPDATE conversations SET last_activity = CURRENT_TIMESTAMP WHERE id = ?
        `).run(existingId);
        return existingId;
      }
    }
    return this.createConversation(userId);
  }

  addMessage(
    conversationId: string,
    message: Omit<Message, 'id' | 'conversationId' | 'createdAt'>
  ): number {
    const result = this.db.prepare(`
      INSERT INTO messages (conversation_id, role, content, metadata)
      VALUES (?, ?, ?, ?)
    `).run(
      conversationId,
      message.role,
      message.content,
      message.metadata ? JSON.stringify(message.metadata) : null
    );

    // Update conversation activity
    this.db.prepare(`
      UPDATE conversations SET last_activity = CURRENT_TIMESTAMP WHERE id = ?
    `).run(conversationId);

    return result.lastInsertRowid as number;
  }

  getMessages(conversationId: string, limit: number = 50): Message[] {
    const rows = this.db.prepare(`
      SELECT id, conversation_id, role, content, metadata, created_at
      FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(conversationId, limit) as {
      id: number;
      conversation_id: string;
      role: string;
      content: string;
      metadata: string | null;
      created_at: string;
    }[];

    return rows.reverse().map(row => ({
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role as MessageRole,
      content: row.content,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: new Date(row.created_at),
    }));
  }

  getContext(conversationId: string, tokenBudget: number): string {
    const messages = this.getMessages(conversationId, 20);
    const context: string[] = [];
    let estimatedTokens = 0;

    // Add messages from newest to oldest until budget exhausted
    for (const msg of [...messages].reverse()) {
      const msgTokens = this.estimateTokens(msg.content);
      if (estimatedTokens + msgTokens > tokenBudget) break;

      const prefix = msg.role === 'user' ? 'User' :
                     msg.role === 'observation' ? 'Observation' : 'Assistant';
      context.unshift(`${prefix}: ${msg.content}`);
      estimatedTokens += msgTokens;
    }

    return context.join('\n\n');
  }

  private estimateTokens(text: string): number {
    // Rough estimate: ~4 chars per token
    return Math.ceil(text.length / 4);
  }

  cacheSnapshot(
    conversationId: string,
    cacheType: 'market' | 'positions',
    data: unknown,
    _ttlMs: number = CACHE_TTL_MS
  ): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO context_cache (conversation_id, cache_type, data, cached_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `).run(conversationId, cacheType, JSON.stringify(data));
  }

  getCachedSnapshot(
    conversationId: string,
    cacheType: string,
    maxAgeMs: number = CACHE_TTL_MS
  ): unknown | null {
    const row = this.db.prepare(`
      SELECT data, cached_at FROM context_cache
      WHERE conversation_id = ? AND cache_type = ?
    `).get(conversationId, cacheType) as { data: string; cached_at: string } | undefined;

    if (!row) return null;

    const cachedAt = new Date(row.cached_at).getTime();
    const now = Date.now();
    if (now - cachedAt > maxAgeMs) return null;

    return JSON.parse(row.data);
  }

  logAudit(
    conversationId: string,
    eventType: 'plan' | 'tool_call' | 'validation' | 'trade' | 'error',
    eventData: unknown
  ): void {
    this.db.prepare(`
      INSERT INTO audit_log (conversation_id, event_type, event_data)
      VALUES (?, ?, ?)
    `).run(conversationId, eventType, JSON.stringify(eventData));
  }

  cleanup(maxAgeHours: number = 24): void {
    const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString();

    this.db.prepare(`
      DELETE FROM messages WHERE conversation_id IN (
        SELECT id FROM conversations WHERE last_activity < ?
      )
    `).run(cutoff);

    this.db.prepare(`
      DELETE FROM context_cache WHERE conversation_id IN (
        SELECT id FROM conversations WHERE last_activity < ?
      )
    `).run(cutoff);

    this.db.prepare(`
      DELETE FROM conversations WHERE last_activity < ?
    `).run(cutoff);
  }

  close(): void {
    this.db.close();
  }
}

// Singleton instance
let memoryInstance: AgentMemory | null = null;

export function getAgentMemory(): AgentMemory {
  if (!memoryInstance) {
    memoryInstance = new AgentMemory();
  }
  return memoryInstance;
}
