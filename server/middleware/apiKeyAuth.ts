/**
 * API Key Authentication Middleware
 *
 * Authenticates requests using API keys for TWS Relay connections.
 */

import { Request, Response, NextFunction } from 'express';
import { db } from '../db';
import { apiKeys } from '@shared/schema';
import { eq } from 'drizzle-orm';

declare global {
  namespace Express {
    interface Request {
      apiKeyUserId?: string;
    }
  }
}

export async function apiKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing API key' });
    return;
  }

  const key = authHeader.slice(7);

  if (!key || key.length < 32) {
    res.status(401).json({ error: 'Invalid API key format' });
    return;
  }

  try {
    if (!db) {
      res.status(503).json({ error: 'Database not available' });
      return;
    }

    const [apiKey] = await db.select({
      id: apiKeys.id,
      userId: apiKeys.userId,
    }).from(apiKeys)
      .where(eq(apiKeys.key, key))
      .limit(1);

    if (!apiKey) {
      res.status(401).json({ error: 'Invalid API key' });
      return;
    }

    db.update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, apiKey.id))
      .then(() => {})
      .catch((err) => console.error('[ApiKeyAuth] Failed to update lastUsedAt:', err));

    req.apiKeyUserId = apiKey.userId;
    next();
  } catch (error: any) {
    console.error('[ApiKeyAuth] Authentication error:', error.message);
    res.status(500).json({ error: 'Authentication failed' });
    return;
  }
}

export async function validateApiKeyFromQuery(apiKey: string): Promise<string | null> {
  if (!apiKey || apiKey.length < 32) {
    return null;
  }

  try {
    if (!db) {
      return null;
    }

    const [result] = await db.select({
      id: apiKeys.id,
      userId: apiKeys.userId,
    }).from(apiKeys)
      .where(eq(apiKeys.key, apiKey))
      .limit(1);

    if (!result) {
      return null;
    }

    db.update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, result.id))
      .then(() => {})
      .catch((err) => console.error('[ApiKeyAuth] Failed to update lastUsedAt:', err));

    return result.userId;
  } catch (error: any) {
    console.error('[ApiKeyAuth] Query validation error:', error.message);
    return null;
  }
}
