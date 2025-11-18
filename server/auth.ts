/**
 * Google OAuth Authentication Routes
 * Handles Google OAuth flow for user authentication
 */

import { Request, Response, Router } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const router = Router();

// Configuration
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/auth/google/callback';
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

// Google OAuth URLs
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USER_INFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

/**
 * Initiates Google OAuth flow
 * Redirects user to Google consent screen
 */
router.get('/google', (req: Request, res: Response) => {
  if (!GOOGLE_CLIENT_ID) {
    return res.status(500).json({ error: 'Google OAuth not configured' });
  }

  const state = crypto.randomBytes(16).toString('hex');

  // Store state in session for CSRF protection
  res.cookie('oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000 // 10 minutes
  });

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
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
      return res.redirect(`${CLIENT_URL}/onboarding?error=invalid_state`);
    }

    // Clear state cookie
    res.clearCookie('oauth_state');

    if (!code) {
      return res.redirect(`${CLIENT_URL}/onboarding?error=no_code`);
    }

    // Exchange code for tokens
    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: code as string,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code'
      })
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      console.error('Token exchange failed:', error);
      return res.redirect(`${CLIENT_URL}/onboarding?error=token_exchange_failed`);
    }

    const tokens = await tokenResponse.json();

    // Get user info from Google
    const userResponse = await fetch(GOOGLE_USER_INFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });

    if (!userResponse.ok) {
      console.error('Failed to get user info');
      return res.redirect(`${CLIENT_URL}/onboarding?error=user_info_failed`);
    }

    const googleUser = await userResponse.json();

    // TODO: Replace with actual database operations when PostgreSQL is set up
    // For now, using in-memory storage for development
    let userId = crypto.randomUUID();

    // Store user data in memory for development
    // This will be replaced with proper database storage
    const userData = {
      id: userId,
      email: googleUser.email,
      name: googleUser.name,
      picture: googleUser.picture,
      googleId: googleUser.sub
    };

    // Create JWT token
    const token = jwt.sign(
      {
        userId,
        email: googleUser.email,
        name: googleUser.name,
        picture: googleUser.picture
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Set JWT as httpOnly cookie
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    // Redirect to onboarding step 2
    res.redirect(`${CLIENT_URL}/onboarding?step=2`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.redirect(`${CLIENT_URL}/onboarding?error=auth_failed`);
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

    const decoded = jwt.verify(token, JWT_SECRET) as any;

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
  const isConfigured = !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
  res.json({
    configured: isConfigured,
    hasClientId: !!GOOGLE_CLIENT_ID,
    hasClientSecret: !!GOOGLE_CLIENT_SECRET,
    redirectUri: GOOGLE_REDIRECT_URI,
    message: isConfigured
      ? 'Google OAuth is configured and ready'
      : 'Google OAuth credentials are missing. Please check GOOGLE_OAUTH_SETUP.md'
  });
});

/**
 * Check if user is authenticated (middleware)
 */
export function requireAuth(req: Request, res: Response, next: Function) {
  const token = req.cookies.auth_token;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    (req as any).user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

export default router;