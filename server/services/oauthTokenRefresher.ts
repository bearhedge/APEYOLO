/**
 * Proactive OAuth Token Refresher
 *
 * Polls every 30 seconds, refreshes when < 2 minutes remain.
 * Coordinates with WebSocket to update session token.
 *
 * This prevents tokens from expiring while the user is idle,
 * ensuring seamless continuation of market data streaming.
 */

import { ensureIbkrReady, getIbkrSessionToken, getIbkrTokenExpiry } from '../broker/ibkr';
import { getIbkrWebSocketManager } from '../broker/ibkrWebSocket';

const POLL_INTERVAL_MS = 30_000;        // Check every 30 seconds
const REFRESH_THRESHOLD_MS = 120_000;   // Refresh when < 2 min remain
const MAX_CONSECUTIVE_FAILURES = 3;
const MAX_LOG_ENTRIES = 50;

let refreshInterval: NodeJS.Timeout | null = null;
let consecutiveFailures = 0;
let lastCheckTime: Date | null = null;
let isRefreshing = false;

// ============================================
// Token Refresh Log Buffer
// ============================================

export interface RefreshLogEntry {
  timestamp: Date;
  type: 'check' | 'refresh_start' | 'refresh_success' | 'refresh_error' | 'ws_updated';
  message: string;
  oauthRemaining?: string;
  ssoRemaining?: string;
}

const logBuffer: RefreshLogEntry[] = [];

function addLogEntry(entry: Omit<RefreshLogEntry, 'timestamp'>): void {
  const fullEntry: RefreshLogEntry = { ...entry, timestamp: new Date() };
  logBuffer.push(fullEntry);
  if (logBuffer.length > MAX_LOG_ENTRIES) {
    logBuffer.shift();
  }
  // Broadcast to WebSocket clients (function injected from routes.ts)
  if (typeof (global as any).broadcastTokenRefreshLog === 'function') {
    (global as any).broadcastTokenRefreshLog(fullEntry);
  }
}

/**
 * Get all refresh log entries (for initial fetch)
 */
export function getRefreshLogs(): RefreshLogEntry[] {
  return [...logBuffer];
}

/**
 * Start the proactive token refresher
 * Safe to call multiple times - will no-op if already running
 */
export function startTokenRefresher(): void {
  if (refreshInterval) {
    console.log('[OAuthRefresher] Already running, skipping start');
    return;
  }

  console.log(`[OAuthRefresher] Starting proactive token refresh (poll=${POLL_INTERVAL_MS / 1000}s, threshold=${REFRESH_THRESHOLD_MS / 1000 / 60}min)`);

  // Initial check after a short delay
  setTimeout(() => {
    checkAndRefresh().catch(err => {
      console.error('[OAuthRefresher] Initial check failed:', err.message);
    });
  }, 5000);

  // Start periodic polling
  refreshInterval = setInterval(() => {
    checkAndRefresh().catch(err => {
      console.error('[OAuthRefresher] Periodic check failed:', err.message);
    });
  }, POLL_INTERVAL_MS);
}

/**
 * Stop the token refresher
 */
export function stopTokenRefresher(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
    console.log('[OAuthRefresher] Stopped');
  }
  consecutiveFailures = 0;
  lastCheckTime = null;
  isRefreshing = false;
}

/**
 * Get current refresher status for debugging
 */
export function getRefresherStatus(): {
  running: boolean;
  lastCheck: Date | null;
  failures: number;
  isRefreshing: boolean;
} {
  return {
    running: refreshInterval !== null,
    lastCheck: lastCheckTime,
    failures: consecutiveFailures,
    isRefreshing,
  };
}

/**
 * Format milliseconds as human-readable duration (e.g., "8m32s")
 */
function formatDuration(ms: number): string {
  if (ms <= 0) return 'expired';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m${seconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Check token expiry and refresh if needed
 */
async function checkAndRefresh(): Promise<void> {
  // Prevent concurrent refresh attempts
  if (isRefreshing) {
    console.log('[OAuthRefresher] Refresh already in progress, skipping');
    return;
  }

  lastCheckTime = new Date();

  try {
    // Get current token expiry times
    const { oauthExpiresAt, ssoExpiresAt } = getIbkrTokenExpiry();

    // If no tokens exist, nothing to refresh
    if (oauthExpiresAt === 0 && ssoExpiresAt === 0) {
      // Not an error - just means IBKR isn't connected yet
      return;
    }

    const now = Date.now();
    const oauthRemaining = oauthExpiresAt - now;
    const ssoRemaining = ssoExpiresAt - now;

    const oauthDurationStr = formatDuration(oauthRemaining);
    const ssoDurationStr = formatDuration(ssoRemaining);

    console.log(`[OAuthRefresher] Token check: OAuth=${oauthDurationStr}, SSO=${ssoDurationStr}`);

    // Log the token check
    addLogEntry({
      type: 'check',
      message: `Token check: OAuth=${oauthDurationStr}, SSO=${ssoDurationStr}`,
      oauthRemaining: oauthDurationStr,
      ssoRemaining: ssoDurationStr,
    });

    // Check if either token is expiring soon
    const needsRefresh = oauthRemaining < REFRESH_THRESHOLD_MS || ssoRemaining < REFRESH_THRESHOLD_MS;

    if (!needsRefresh) {
      // Tokens are fine, reset failure counter
      consecutiveFailures = 0;
      return;
    }

    // Determine which token is triggering refresh
    const reason = oauthRemaining < REFRESH_THRESHOLD_MS
      ? `OAuth expiring (${oauthDurationStr}), refreshing...`
      : `SSO expiring (${ssoDurationStr}), refreshing...`;

    console.log(`[OAuthRefresher] ${reason}`);

    // Log refresh start
    addLogEntry({
      type: 'refresh_start',
      message: reason,
      oauthRemaining: oauthDurationStr,
      ssoRemaining: ssoDurationStr,
    });

    isRefreshing = true;

    try {
      // Force refresh OAuth + SSO tokens
      await ensureIbkrReady(true);

      // Get new session token
      const newSessionToken = await getIbkrSessionToken();

      // Update WebSocket with new session token
      const wsManager = getIbkrWebSocketManager();
      if (wsManager && newSessionToken) {
        wsManager.updateSessionToken(newSessionToken);
        console.log('[OAuthRefresher] WebSocket session token updated');

        // Log WebSocket update
        addLogEntry({
          type: 'ws_updated',
          message: 'WebSocket session updated',
        });
      }

      // Log new token status
      const newExpiry = getIbkrTokenExpiry();
      const newOauthRemaining = newExpiry.oauthExpiresAt - Date.now();
      const newSsoRemaining = newExpiry.ssoExpiresAt - Date.now();
      const newOauthDurationStr = formatDuration(newOauthRemaining);
      const newSsoDurationStr = formatDuration(newSsoRemaining);

      console.log(`[OAuthRefresher] Refresh complete: OAuth=${newOauthDurationStr}, SSO=${newSsoDurationStr}`);

      // Log refresh success
      addLogEntry({
        type: 'refresh_success',
        message: `Refresh complete: OAuth=${newOauthDurationStr}, SSO=${newSsoDurationStr}`,
        oauthRemaining: newOauthDurationStr,
        ssoRemaining: newSsoDurationStr,
      });

      // Reset failure counter on success
      consecutiveFailures = 0;

    } finally {
      isRefreshing = false;
    }

  } catch (err: any) {
    isRefreshing = false;
    consecutiveFailures++;

    const errorMsg = `Refresh error (attempt ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}): ${err.message}`;
    console.error(`[OAuthRefresher] ${errorMsg}`);

    // Log refresh error
    addLogEntry({
      type: 'refresh_error',
      message: errorMsg,
    });

    // After max failures, log warning but don't crash
    // The existing reconnect logic in WebSocket manager will handle fallback
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      console.warn(`[OAuthRefresher] Max consecutive failures (${MAX_CONSECUTIVE_FAILURES}) reached. Will continue polling but refresh may require manual intervention.`);
      // Don't stop the refresher - keep trying in case the issue resolves
    }
  }
}
