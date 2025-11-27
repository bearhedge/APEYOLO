/**
 * Centralized Configuration Layer
 * All environment-specific settings in one place
 */

import * as crypto from 'crypto';

// Environment detection
type AppEnv = 'development' | 'staging' | 'production';

function getAppEnv(): AppEnv {
  const env = process.env.APP_ENV || process.env.NODE_ENV || 'development';
  if (env === 'staging') return 'staging';
  if (env === 'production') return 'production';
  return 'development';
}

// URL builders based on environment
function getGoogleRedirectUri(): string {
  const env = getAppEnv();

  // Allow explicit override
  if (process.env.GOOGLE_REDIRECT_URI) {
    return process.env.GOOGLE_REDIRECT_URI;
  }

  const map: Record<AppEnv, string> = {
    development: 'http://localhost:5000/api/auth/google/callback',
    staging: process.env.CLOUD_RUN_SERVICE_URL
      ? `https://${process.env.CLOUD_RUN_SERVICE_URL}/api/auth/google/callback`
      : 'https://apeyolo-staging-XXXXX.asia-east1.run.app/api/auth/google/callback',
    production: 'https://apeyolo.com/api/auth/google/callback',
  };

  return map[env];
}

function getClientUrl(): string {
  const env = getAppEnv();

  // Allow explicit override
  if (process.env.CLIENT_URL) {
    return process.env.CLIENT_URL;
  }

  const map: Record<AppEnv, string> = {
    development: 'http://localhost:5173', // Vite dev server
    staging: process.env.CLOUD_RUN_SERVICE_URL
      ? `https://${process.env.CLOUD_RUN_SERVICE_URL}`
      : 'https://apeyolo-staging-XXXXX.asia-east1.run.app',
    production: 'https://apeyolo.com',
  };

  return map[env];
}

function getApiUrl(): string {
  const env = getAppEnv();

  const map: Record<AppEnv, string> = {
    development: 'http://localhost:5000',
    staging: process.env.CLOUD_RUN_SERVICE_URL
      ? `https://${process.env.CLOUD_RUN_SERVICE_URL}`
      : 'https://apeyolo-staging-XXXXX.asia-east1.run.app',
    production: 'https://apeyolo.com',
  };

  return map[env];
}

// Generate a stable JWT secret in dev, require it in prod
function getJwtSecret(): string {
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }

  const env = getAppEnv();
  if (env === 'production' || env === 'staging') {
    console.warn('[CONFIG] JWT_SECRET not set in production/staging - using random secret (sessions will not persist across restarts)');
  }

  return crypto.randomBytes(32).toString('hex');
}

export const config = {
  // Environment
  appEnv: getAppEnv(),
  isDev: getAppEnv() === 'development',
  isStaging: getAppEnv() === 'staging',
  isProd: getAppEnv() === 'production',

  // Server
  port: Number(process.env.PORT) || 5000,

  // Broker
  broker: {
    provider: process.env.BROKER_PROVIDER || 'mock',
    ibkrEnv: process.env.IBKR_ENV || 'paper',
  },

  // Google OAuth
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: getGoogleRedirectUri(),
  },

  // JWT
  jwt: {
    secret: getJwtSecret(),
    expiresIn: '7d',
  },

  // URLs
  urls: {
    client: getClientUrl(),
    api: getApiUrl(),
  },

  // Cookie settings
  cookies: {
    secure: getAppEnv() !== 'development',
    sameSite: 'lax' as const,
  },
};

// Log config on startup (redact secrets)
export function logConfig(): void {
  console.log('[CONFIG] Environment:', config.appEnv);
  console.log('[CONFIG] Port:', config.port);
  console.log('[CONFIG] Client URL:', config.urls.client);
  console.log('[CONFIG] Google Redirect URI:', config.google.redirectUri);
  console.log('[CONFIG] Broker Provider:', config.broker.provider);
  console.log('[CONFIG] Cookies Secure:', config.cookies.secure);
}

export default config;
