// @ts-nocheck
// TODO: Fix jwt.sign type issue with expiresIn option
/**
 * Google OAuth Authentication Routes
 * Handles Google OAuth flow for user authentication
 */

console.log('[AUTH] Loading auth.ts module');

import { Request, Response, Router, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from './config.js';

console.log('[AUTH] After config import, config.google.clientId:', config.google.clientId ? 'SET' : 'NOT SET');
import { db } from './db.js';
import { users } from '@shared/schema';
import { eq } from 'drizzle-orm';

// Express Request extension for typed user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string;
        picture?: string;
      };
    }
  }
}

const router = Router();

// Google OAuth URLs
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USER_INFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

/**
 * Initiates Google OAuth flow
 * Redirects user to Google consent screen
 */
router.get('/google', (req: Request, res: Response) => {
  // Use env directly instead of config object
  const clientId = process.env.GOOGLE_CLIENT_ID || config.google.clientId;
  if (!clientId) {
    return res.status(500).json({ error: 'Google OAuth not configured' });
  }

  const state = crypto.randomBytes(16).toString('hex');

  // Store state in session for CSRF protection
  res.cookie('oauth_state', state, {
    httpOnly: true,
    secure: config.cookies.secure,
    sameSite: config.cookies.sameSite,
    maxAge: 10 * 60 * 1000 // 10 minutes
  });

  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: state,
    access_type: 'offline',
    prompt: 'consent'
  });

  res.redirect(`${GOOGLE_AUTH_URL}?${params}`);
});

/**
 * Google OAuth callback
 * Exchanges code for tokens and creates/updates user
 */
router.get('/google/callback', async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;
    const storedState = req.cookies.oauth_state;

    // Verify state for CSRF protection
    if (!state || state !== storedState) {
      return res.redirect(`${config.urls.client}/onboarding?error=invalid_state`);
    }

    // Clear state cookie
    res.clearCookie('oauth_state');

    if (!code) {
      return res.redirect(`${config.urls.client}/onboarding?error=no_code`);
    }

    // Exchange code for tokens
    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: code as string,
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
        redirect_uri: config.google.redirectUri,
        grant_type: 'authorization_code'
      })
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      console.error('Token exchange failed:', error);
      return res.redirect(`${config.urls.client}/onboarding?error=token_exchange_failed`);
    }

    const tokens = await tokenResponse.json();

    // Get user info from Google
    const userResponse = await fetch(GOOGLE_USER_INFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });

    if (!userResponse.ok) {
      console.error('Failed to get user info');
      return res.redirect(`${config.urls.client}/onboarding?error=user_info_failed`);
    }

    const googleUser = await userResponse.json();

    // Lookup or create user in database
    let userId: string;

    if (db) {
      // Try to find existing user by Google ID
      const existingUsers = await db
        .select()
        .from(users)
        .where(eq(users.googleId, googleUser.sub))
        .limit(1);

      if (existingUsers.length > 0) {
        // User exists, update their info
        const existingUser = existingUsers[0];
        userId = existingUser.id;

        // Update profile info if changed
        await db
          .update(users)
          .set({
            name: googleUser.name,
            picture: googleUser.picture,
            updatedAt: new Date(),
          })
          .where(eq(users.id, userId));

        console.log(`[Auth] User logged in: ${googleUser.email} (ID: ${userId})`);
      } else {
        // Check if user exists by email (could have been created differently)
        const emailUsers = await db
          .select()
          .from(users)
          .where(eq(users.email, googleUser.email))
          .limit(1);

        if (emailUsers.length > 0) {
          // Link Google ID to existing email account
          userId = emailUsers[0].id;
          await db
            .update(users)
            .set({
              googleId: googleUser.sub,
              name: googleUser.name,
              picture: googleUser.picture,
              updatedAt: new Date(),
            })
            .where(eq(users.id, userId));

          console.log(`[Auth] Linked Google to existing user: ${googleUser.email} (ID: ${userId})`);
        } else {
          // Create new user
          const newUsers = await db
            .insert(users)
            .values({
              email: googleUser.email,
              name: googleUser.name,
              picture: googleUser.picture,
              googleId: googleUser.sub,
            })
            .returning();

          userId = newUsers[0].id;
          console.log(`[Auth] New user created: ${googleUser.email} (ID: ${userId})`);
        }
      }
    } else {
      // Fallback for development without database
      userId = crypto.randomUUID();
      console.warn('[Auth] Database not available, using temporary user ID');
    }

    // Create JWT token
    const token = jwt.sign(
      {
        userId,
        email: googleUser.email,
        name: googleUser.name,
        picture: googleUser.picture
      },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    // Set JWT as httpOnly cookie
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: config.cookies.secure,
      sameSite: config.cookies.sameSite,
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    // Redirect directly to the dashboard after successful login
    // IBKR setup can be completed later in Settings
    res.redirect(`${config.urls.client}/agent`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.redirect(`${config.urls.client}/onboarding?error=auth_failed`);
  }
});

/**
 * Get current user info
 */
router.get('/user', async (req: Request, res: Response) => {
  try {
    const token = req.cookies.auth_token;

    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const decoded = jwt.verify(token, config.jwt.secret) as any;

    // TODO: Get user data from database when PostgreSQL is set up
    // For now, returning the data from the JWT token
    res.json({
      id: decoded.userId,
      email: decoded.email,
      name: decoded.name,
      picture: decoded.picture
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
});

/**
 * Logout - clear auth cookie
 */
router.post('/logout', (req: Request, res: Response) => {
  res.clearCookie('auth_token');
  res.json({ success: true });
});

/**
 * Check OAuth configuration status
 */
router.get('/status', (req: Request, res: Response) => {
  const isConfigured = !!(config.google.clientId && config.google.clientSecret);
  res.json({
    configured: isConfigured,
    hasClientId: !!config.google.clientId,
    hasClientSecret: !!config.google.clientSecret,
    redirectUri: config.google.redirectUri,
    appEnv: config.appEnv,
    message: isConfigured
      ? 'Google OAuth is configured and ready'
      : 'Google OAuth credentials are missing. Please check GOOGLE_OAUTH_SETUP.md'
  });
});

/**
 * Check if user is authenticated (middleware)
 * Attaches user object to req.user with id, email, name, picture
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies.auth_token;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret) as {
      userId: string;
      email: string;
      name: string;
      picture?: string;
    };

    // Attach user to request with typed interface
    req.user = {
      id: decoded.userId,
      email: decoded.email,
      name: decoded.name,
      picture: decoded.picture,
    };

    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

export default router;
