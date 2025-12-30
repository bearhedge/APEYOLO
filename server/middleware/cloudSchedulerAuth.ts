/**
 * Cloud Scheduler Authentication Middleware
 *
 * Validates OIDC tokens from Google Cloud Scheduler.
 * Cloud Scheduler sends requests with Authorization: Bearer <OIDC_TOKEN>
 */

import { Request, Response, NextFunction } from 'express';
import * as jose from 'jose';

// Google's OIDC issuer
const GOOGLE_ISSUER = 'https://accounts.google.com';

// Expected service account email (set in environment)
const SCHEDULER_SERVICE_ACCOUNT = process.env.CLOUD_SCHEDULER_SERVICE_ACCOUNT || '';

// Expected audience (your Cloud Run service URL)
const EXPECTED_AUDIENCE = process.env.CLOUD_RUN_URL || 'https://apeyolo.com';

// Cache for Google's public keys (JWKS)
let cachedJWKS: jose.JWTVerifyGetKey | null = null;
let jwksCacheTime = 0;
const JWKS_CACHE_TTL = 3600000; // 1 hour

/**
 * Get Google's public keys for JWT verification
 */
async function getGoogleJWKS(): Promise<jose.JWTVerifyGetKey> {
  const now = Date.now();

  if (cachedJWKS && (now - jwksCacheTime) < JWKS_CACHE_TTL) {
    return cachedJWKS;
  }

  cachedJWKS = jose.createRemoteJWKSet(
    new URL('https://www.googleapis.com/oauth2/v3/certs')
  );
  jwksCacheTime = now;

  return cachedJWKS;
}

/**
 * Middleware to authenticate Cloud Scheduler requests
 *
 * Validates:
 * 1. Authorization header has Bearer token
 * 2. Token is valid JWT signed by Google
 * 3. Token issuer is accounts.google.com
 * 4. Token audience matches our service URL
 * 5. Token email matches expected service account (if configured)
 */
export async function requireCloudScheduler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn('[CloudSchedulerAuth] Missing or invalid Authorization header');
    res.status(401).json({ error: 'Missing Authorization header' });
    return;
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix

  try {
    const JWKS = await getGoogleJWKS();

    const { payload } = await jose.jwtVerify(token, JWKS, {
      issuer: GOOGLE_ISSUER,
      audience: EXPECTED_AUDIENCE,
    });

    // Verify service account email if configured
    if (SCHEDULER_SERVICE_ACCOUNT && payload.email !== SCHEDULER_SERVICE_ACCOUNT) {
      console.warn(`[CloudSchedulerAuth] Token email mismatch: ${payload.email} !== ${SCHEDULER_SERVICE_ACCOUNT}`);
      res.status(403).json({ error: 'Invalid service account' });
      return;
    }

    console.log(`[CloudSchedulerAuth] Authenticated: ${payload.email}`);

    // Attach payload to request for downstream use
    (req as any).schedulerAuth = payload;

    next();
  } catch (error: any) {
    console.error('[CloudSchedulerAuth] Token verification failed:', error.message);
    res.status(401).json({ error: 'Invalid token' });
    return;
  }
}

/**
 * Optional: Skip auth in development mode
 * Use requireCloudSchedulerOrDev for endpoints that should work locally
 */
export async function requireCloudSchedulerOrDev(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // In development, allow requests without auth
  if (process.env.NODE_ENV === 'development') {
    console.log('[CloudSchedulerAuth] Development mode - skipping auth');
    next();
    return;
  }

  // In production, require proper auth
  return requireCloudScheduler(req, res, next);
}
