import type {
  AccountInfo,
  OptionChainData,
  Position,
  Trade,
  InsertTrade,
} from "@shared/schema";
import type { BrokerProvider } from "./types";
import { SignJWT, importPKCS8 } from "jose";
import axios, { AxiosInstance } from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
import { randomUUID } from "crypto";
import { webcrypto as nodeWebcrypto } from 'node:crypto';
import { storage } from "../storage";

// Ensure WebCrypto is available for `jose` in Node (required for RS256, etc.)
// In some environments, globalThis.crypto is not defined by default.
// This shim is safe to run multiple times.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (!(globalThis as any).crypto) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).crypto = nodeWebcrypto as unknown as Crypto;
}

type SsoResult = { ok: boolean; status: number; body?: any; reqId?: string };

async function createSsoSession(baseUrl: string, accessToken: string): Promise<SsoResult> {
  const base = (baseUrl || 'https://api.ibkr.com').replace(/\/$/, '');
  const url = `${base}/gw/api/v1/sso-sessions`;
  const ip = process.env.IBKR_ALLOWED_IP;
  const username = process.env.IBKR_CREDENTIAL;
  const clientId = process.env.IBKR_CLIENT_ID;
  const kid = process.env.IBKR_CLIENT_KEY_ID;
  const privateKeyPem = process.env.IBKR_PRIVATE_KEY;

  if (!username || !clientId || !privateKeyPem || !kid) {
    return { ok: false, status: 400, body: 'Missing required env for SSO (credential/clientId/key/kid)' };
  }

  const now = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(privateKeyPem, 'RS256');
  // Strict minimal claims per Authentication.txt
  const claims: Record<string, any> = {
    credential: username,
    iss: clientId,
    iat: now,
    exp: now + 86400, // 24h window as specified
  };
  if (ip) claims.ip = ip;

  const signed = await new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' })
    .sign(key);

  const reqId = randomUUID();
  const res = await axios.post(url, signed, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/jwt' },
    validateStatus: () => true,
  });
  const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data || {});
  const snippet = text.slice(0, 200);
  const traceVal = (res.headers as any)['traceid'] || (res.headers as any)['x-traceid'] || (res.headers as any)['x-request-id'] || (res.headers as any)['x-correlation-id'];
  console.log(`[IBKR][SSO] status=${res.status} traceId=${traceVal ?? ''} body=${snippet}`);
  return { ok: res.status >= 200 && res.status < 300, status: res.status, body: res.data, reqId: traceVal || reqId };
}

type PhaseStatus = { status: number | null; ts: string; requestId?: string };
export type IbkrDiagnostics = {
  oauth: PhaseStatus;
  sso: PhaseStatus;
  validate: PhaseStatus;
  init: PhaseStatus;
};

type IbkrConfig = {
  baseUrl?: string;
  accountId?: string;
  env: "paper" | "live";
};

type OAuthToken = { access_token: string; expires_in: number };

class IbkrClient {
  private baseUrl: string;
  private accountId?: string;
  private env: "paper" | "live";
  private http!: AxiosInstance;
  private jar = new CookieJar();

  private accessToken: string | null = null;
  private accessTokenExpiryMs = 0;
  private ssoSessionId: string | null = null;
  private ssoAccessToken: string | null = null;
  private ssoAccessTokenExpiryMs = 0;  // Track SSO token expiry
  private lastInitTimeMs = 0;           // Track when init was last called
  private lastValidateTimeMs = 0;       // Track when validate was last called
  private sessionReady = false;
  private accountSelected = false;
  private last: IbkrDiagnostics = {
    oauth: { status: null, ts: "" },
    sso: { status: null, ts: "" },
    validate: { status: null, ts: "" },
    init: { status: null, ts: "" },
  };

  constructor(cfg: IbkrConfig) {
    this.baseUrl = cfg.baseUrl || "https://api.ibkr.com";
    this.accountId = cfg.accountId;
    this.env = cfg.env;
    // Axios client with cookie jar for CP API
    this.http = wrapper(axios.create({
      baseURL: 'https://api.ibkr.com',
      // @ts-ignore jar is supported via axios-cookiejar-support
      jar: this.jar,
      withCredentials: true,
      validateStatus: () => true,
      headers: { 'User-Agent': 'apeyolo/1.0' },
    }));
  }

  private async ensureAccountSelected(): Promise<void> {
    const acct = this.accountId || process.env.IBKR_ACCOUNT_ID || "";
    if (!acct || this.accountSelected) return;
    // CP endpoint - use cookie auth only, no Authorization header
    const resp = await this.http.post('/v1/api/iserver/account', { acctId: acct }, {
      headers: { 'Content-Type': 'application/json' },
    });
    console.log(`[IBKR][ensureAccountSelected] status=${resp.status} acctId=${acct}`);
    if (resp.status >= 200 && resp.status < 300) {
      this.accountSelected = true;
      // Brief delay to let account selection take effect
      await this.sleep(500);
    }
  }

  private now() {
    return Date.now();
  }

  private sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  private async signClientAssertion(): Promise<string> {
    const clientId = process.env.IBKR_CLIENT_ID;
    const clientKeyId = process.env.IBKR_CLIENT_KEY_ID; // kid
    const privateKeyPem = process.env.IBKR_PRIVATE_KEY;

    if (!clientId || !clientKeyId || !privateKeyPem) {
      throw new Error("IBKR OAuth env vars missing (IBKR_CLIENT_ID, IBKR_CLIENT_KEY_ID, IBKR_PRIVATE_KEY)");
    }

    const key = await importPKCS8(privateKeyPem, "RS256");
    const now = Math.floor(Date.now() / 1000);

    const jwt = await new SignJWT({
      iss: clientId,
      sub: clientId,
      aud: `${this.baseUrl}/oauth2/api/v1/token`,
      jti: randomUUID(),
      iat: now,
      exp: now + 60,
    })
      .setProtectedHeader({ alg: "RS256", kid: clientKeyId, typ: "JWT" })
      .sign(key);

    return jwt;
  }

  private async getOAuthToken(): Promise<string> {
    if (this.accessToken && this.accessTokenExpiryMs - 5_000 > this.now()) {
      return this.accessToken;
    }

    const clientId = process.env.IBKR_CLIENT_ID;
    if (!clientId) throw new Error("IBKR_CLIENT_ID missing");

    const clientAssertion = await this.signClientAssertion();

    const url = `${this.baseUrl}/oauth2/api/v1/token`;
    const scope = process.env.IBKR_SCOPE || process.env.IBKR_OAUTH_SCOPE || process.env.SCOPE || 'sso-sessions.write';
    const form = new URLSearchParams({
      grant_type: 'client_credentials',
      scope,
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: clientAssertion,
    });
    // Safe debug: only log keys, never values
    console.log('[IBKR][OAuth][requestKeys]', Array.from(form.keys()));

    const oauthReqId = randomUUID();
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      });

      this.last.oauth = { status: resp.status, ts: new Date().toISOString(), requestId: oauthReqId };
      if (!resp.ok) {
        let errorBody = "";
        try { errorBody = await resp.text(); } catch {}

        // Decode JWT payload (for debugging payload only — no private key)
        let jwtPayloadStr = "";
        try {
          const parts = clientAssertion.split(".");
          if (parts.length >= 2) {
            jwtPayloadStr = Buffer.from(parts[1], "base64url").toString("utf8");
          }
        } catch {}

        const snippet = (errorBody || "").slice(0, 500);
        // Structured console logs for debugging
        console.error("[IBKR][OAuth][status]", resp.status, "req=", oauthReqId);
        if (snippet) console.error("[IBKR][OAuth][errorBody]", snippet);
        if (jwtPayloadStr) console.error("[IBKR][OAuth][jwtPayload]", jwtPayloadStr);
        console.error("[IBKR][OAuth][result]", { error: "token_request_failed", status: resp.status, reqId: oauthReqId });

        await storage.createAuditLog({
          eventType: "IBKR_OAUTH_TOKEN",
          details: `FAILED http=${resp.status} req=${oauthReqId} body=${snippet}`,
          status: "FAILED",
        });
        throw new Error(`IBKR OAuth token request failed: ${resp.status}`);
      }

      const json = (await resp.json()) as OAuthToken;
      this.accessToken = json.access_token;
      this.accessTokenExpiryMs = this.now() + json.expires_in * 1000;

      await storage.createAuditLog({
        eventType: "IBKR_OAUTH_TOKEN",
        details: `OK http=${resp.status} req=${oauthReqId}`,
        status: "SUCCESS",
      });
      return this.accessToken;
    } catch (err) {
      // Network/transport-level failure (no HTTP response)
      // Decode JWT payload for context
      let jwtPayloadStr = "";
      try {
        const parts = clientAssertion.split(".");
        if (parts.length >= 2) {
          jwtPayloadStr = Buffer.from(parts[1], "base64url").toString("utf8");
        }
      } catch {}
      if (jwtPayloadStr) console.error("[IBKR][OAuth][jwtPayload]", jwtPayloadStr);
      console.error("[IBKR][OAuth][transportError]", String((err as any)?.message || err));
      await storage.createAuditLog({ eventType: "IBKR_OAUTH_TOKEN", details: "FAILED transport", status: "FAILED" });
      throw err;
    }
  }

  private async createSSOSession(token: string): Promise<void> {
    // Check if we have a valid SSO session that hasn't expired
    const now = Date.now();
    const hasValidSession = this.ssoSessionId &&
                           this.ssoAccessToken &&
                           this.ssoAccessTokenExpiryMs > now;

    if (hasValidSession) {
      console.log('[IBKR][SSO] Using existing valid session, expires in',
                  Math.round((this.ssoAccessTokenExpiryMs - now) / 1000), 'seconds');
      return;
    }

    // Clear old session if expired
    if (this.ssoAccessTokenExpiryMs && this.ssoAccessTokenExpiryMs <= now) {
      console.log('[IBKR][SSO] Previous session expired, creating new one');
      this.ssoSessionId = null;
      this.ssoAccessToken = null;
      this.ssoAccessTokenExpiryMs = 0;
    }

    // Build the SSO JWT (with optional IP claim)
    const ip = process.env.IBKR_ALLOWED_IP;
    const username = process.env.IBKR_CREDENTIAL;
    const clientId = process.env.IBKR_CLIENT_ID;
    const kid = process.env.IBKR_CLIENT_KEY_ID;
    const privateKeyPem = process.env.IBKR_PRIVATE_KEY;

    if (!username || !clientId || !privateKeyPem || !kid) {
      this.last.sso = { status: 400, ts: new Date().toISOString() };
      throw new Error('Missing required env for SSO (credential/clientId/key/kid)');
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const key = await importPKCS8(privateKeyPem, 'RS256');
    const claims: Record<string, any> = {
      credential: username,
      iss: clientId,
      iat: nowSeconds,
      exp: nowSeconds + 86400,
    };
    if (ip) claims.ip = ip;
    const signed = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' })
      .sign(key);

    // IMPORTANT: use the same axios instance (this.http) with the cookie jar
    const res = await this.http.post('/gw/api/v1/sso-sessions', signed, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/jwt' },
    });

    const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data || {});
    const snippet = text.slice(0, 200);
    const traceVal = (res.headers as any)['traceid'] || (res.headers as any)['x-traceid'] || (res.headers as any)['x-request-id'] || (res.headers as any)['x-correlation-id'];
    console.log(`[IBKR][SSO] status=${res.status} traceId=${traceVal ?? ''} body=${snippet}`);

    this.last.sso = { status: res.status, ts: new Date().toISOString(), requestId: traceVal };
    if (!(res.status >= 200 && res.status < 300)) {
      await storage.createAuditLog({ eventType: 'IBKR_SSO_SESSION', details: `FAILED http=${res.status} req=${traceVal ?? ''}`, status: 'FAILED' });
      throw new Error(`IBKR SSO session failed: ${res.status}`);
    }

    const body: any = res.data ?? {};
    // Capture any token fields if present; otherwise rely on cookies in jar
    this.ssoSessionId = body?.session_id || body?.sessionId || 'ok';
    this.ssoAccessToken = body?.access_token || body?.token || body?.bearer_token || body?.session_token || body?.sso_token || body?.authToken || body?.auth_token || null;

    // Set SSO token expiry (default to 9 minutes if not provided)
    const expiresIn = body?.expires_in || body?.expiresIn || 540; // 540 seconds = 9 minutes
    this.ssoAccessTokenExpiryMs = Date.now() + (expiresIn * 1000);

    if (!this.ssoAccessToken) {
      console.log('[IBKR][SSO][Cookie Mode]', 'No bearer token found, using cookies from jar');
    }

    console.log('[IBKR][SSO][Token]', {
      sessionId: this.ssoSessionId,
      hasToken: !!this.ssoAccessToken,
      tokenPrefix: this.ssoAccessToken ? this.ssoAccessToken.substring(0, 10) + '...' : 'none',
      authMode: this.ssoAccessToken ? 'bearer' : 'cookies',
      expiresIn: `${expiresIn}s`,
      expiresAt: new Date(this.ssoAccessTokenExpiryMs).toISOString(),
    });

    await storage.createAuditLog({ eventType: 'IBKR_SSO_SESSION', details: `OK http=${res.status} req=${traceVal ?? ''} hasToken=${!!this.ssoAccessToken}` , status: 'SUCCESS' });

    // Delay 3s after successful SSO per requirement
    await this.sleep(3000);
  }

  private async validateSso(): Promise<number> {
    // Try different auth strategies
    let headers: any = {};
    let attempt = 1;

    // First try: Use the SSO access token as Bearer
    if (this.ssoAccessToken) {
      headers = { 'Authorization': `Bearer ${this.ssoAccessToken}` };
      console.log('[IBKR][VALIDATE] Attempt 1: Using SSO Bearer token');
    } else if (this.accessToken) {
      // Fallback to OAuth token if SSO token not available
      console.log('[IBKR][VALIDATE] Attempt 1: Using OAuth token as fallback');
      headers = { 'Authorization': `Bearer ${this.accessToken}` };
    } else {
      // Try with just cookies, no Authorization header
      console.log('[IBKR][VALIDATE] Attempt 1: Using cookies only');
    }

    let r = await this.http.get('/v1/api/sso/validate', { headers });
    let text = typeof r.data === 'string' ? r.data : JSON.stringify(r.data || {});
    let snippet = text.slice(0, 200);
    const traceVal = (r.headers as any)['traceid'] || (r.headers as any)['x-traceid'] || (r.headers as any)['x-request-id'] || (r.headers as any)['x-correlation-id'];

    // If first attempt fails with 401 and we have SSO token, try using OAuth token instead
    if (r.status === 401 && this.ssoAccessToken && this.accessToken) {
      console.log('[IBKR][VALIDATE] Attempt 1 failed with 401, trying OAuth token instead of SSO token');
      headers = { 'Authorization': `Bearer ${this.accessToken}` };
      r = await this.http.get('/v1/api/sso/validate', { headers });
      text = typeof r.data === 'string' ? r.data : JSON.stringify(r.data || {});
      snippet = text.slice(0, 200);
      attempt = 2;
    }

    // If still failing, try without any auth header (cookies only)
    if (r.status === 401 && attempt < 3) {
      console.log('[IBKR][VALIDATE] Attempt 2 failed with 401, trying cookies only');
      r = await this.http.get('/v1/api/sso/validate', { headers: {} });
      text = typeof r.data === 'string' ? r.data : JSON.stringify(r.data || {});
      snippet = text.slice(0, 200);
      attempt = 3;
    }

    this.last.validate = { status: r.status, ts: new Date().toISOString(), requestId: traceVal };

    console.log(`[IBKR][VALIDATE] status=${r.status} traceId=${traceVal ?? ''} body=${snippet} attempt=${attempt}`);

    if (r.status >= 200 && r.status < 300) {
      await storage.createAuditLog({ eventType: "IBKR_SSO_VALIDATE", details: `OK http=${r.status} req=${traceVal ?? ''} attempt=${attempt}`, status: "SUCCESS" });
    } else {
      await storage.createAuditLog({ eventType: "IBKR_SSO_VALIDATE", details: `FAILED http=${r.status} req=${traceVal ?? ''} body=${snippet} attempt=${attempt}`, status: "FAILED" });
    }
    return r.status;
  }

  private async tickle(): Promise<number> {
    // Use whatever auth method is available
    let headers: any = {};

    if (this.ssoAccessToken) {
      headers = this.authHeaders();
    } else if (this.accessToken) {
      headers = { 'Authorization': `Bearer ${this.accessToken}` };
    }
    // Otherwise use cookies only

    const r = await this.http.get('/v1/api/tickle', { headers });
    const traceVal = (r.headers as any)['traceid'] || (r.headers as any)['x-traceid'] || (r.headers as any)['x-request-id'] || (r.headers as any)['x-correlation-id'];
    console.log(`[IBKR][TICKLE] status=${r.status} traceId=${traceVal ?? ''}`);
    return r.status;
  }

  private async initBrokerageWithSso(): Promise<void> {
    if (this.sessionReady) return;

    const doInit = async () => {
      // Use whatever auth method is available
      let headers: any = { 'Content-Type': 'application/json' };

      if (this.ssoAccessToken) {
        headers = { ...this.authHeaders(), 'Content-Type': 'application/json' };
      } else if (this.accessToken) {
        console.log('[IBKR][INIT] Using OAuth token as fallback');
        headers = { 'Authorization': `Bearer ${this.accessToken}`, 'Content-Type': 'application/json' };
      } else {
        console.log('[IBKR][INIT] Attempting init with cookies only');
      }

      const r = await this.http.post(
        '/v1/api/iserver/auth/ssodh/init',
        { publish: true, compete: true },
        { headers }
      );
      const bodyText = typeof r.data === 'string' ? r.data : JSON.stringify(r.data || {});
      const snippet = bodyText.slice(0, 200);
      const traceVal = (r.headers as any)['traceid'] || (r.headers as any)['x-traceid'] || (r.headers as any)['x-request-id'] || (r.headers as any)['x-correlation-id'];
      this.last.init = { status: r.status, ts: new Date().toISOString(), requestId: traceVal };
      console.log(`[IBKR][INIT] status=${r.status} traceId=${traceVal ?? ''} body=${snippet}`);
      if (r.status >= 200 && r.status < 300) {
        await storage.createAuditLog({ eventType: "IBKR_INIT", details: `OK http=${r.status} req=${traceVal ?? ''}`, status: "SUCCESS" });
      } else {
        await storage.createAuditLog({ eventType: "IBKR_INIT", details: `FAILED http=${r.status} req=${traceVal ?? ''} body=${snippet}`, status: "FAILED" });
      }
      return r;
    };

    // First attempt
    let res = await doInit();
    const bodyStr1 = typeof res.data === 'string' ? res.data : JSON.stringify(res.data || {});

    // Handle 410 Gone - session is completely stale
    if (res.status === 410) {
      console.error('[IBKR][INIT] Received 410 Gone - SSO session is stale, clearing cache and forcing refresh');
      // Clear all cached session data
      this.accessToken = null;
      this.accessTokenExpiryMs = 0;
      this.ssoAccessToken = null;
      this.ssoAccessTokenExpiryMs = 0;
      this.ssoSessionId = null;
      this.sessionReady = false;
      this.lastInitTimeMs = 0;
      this.lastValidateTimeMs = 0;

      // Create a specific error for 410 that ensureReady can catch
      const error = new Error(`SSO session expired (410) - refresh required`);
      (error as any).statusCode = 410;
      (error as any).requiresRefresh = true;
      throw error;
    }

    if (res.status === 500 && /failed to generate sso dh token/i.test(bodyStr1)) {
      // Wait, tickle, and retry once
      await this.sleep(3000);
      await this.tickle();
      res = await doInit();

      // Check for 410 on retry as well
      if (res.status === 410) {
        console.error('[IBKR][INIT] Received 410 Gone on retry - SSO session is stale');
        const error = new Error(`SSO session expired (410) - refresh required`);
        (error as any).statusCode = 410;
        (error as any).requiresRefresh = true;
        throw error;
      }
    }

    if (!(res.status >= 200 && res.status < 300)) {
      throw new Error(`IBKR init failed: ${res.status}`);
    }
    this.sessionReady = true;
  }

  private async keepaliveSession(): Promise<void> {
    // Only tickle if session is older than 4 minutes
    if (this.lastInitTimeMs && Date.now() - this.lastInitTimeMs > 240_000) {
      try {
        await this.tickle();
        this.lastInitTimeMs = Date.now();
        console.log(`[IBKR][keepalive] Session refreshed via tickle`);
      } catch (err) {
        // Tickle failed, force re-init on next ensureReady()
        console.error(`[IBKR][keepalive] Tickle failed:`, err);
        this.sessionReady = false;
        this.last.init.status = null;
      }
    }
  }

  private async ensureReady(retry = true, forceRefresh = false): Promise<void> {
    try {
      // Force refresh will skip cache checks and reinitialize everything
      if (forceRefresh) {
        console.log('[IBKR] Force refresh requested - clearing session cache');
        this.accessToken = null;
        this.accessTokenExpiryMs = 0;
        this.ssoAccessToken = null;
        this.ssoAccessTokenExpiryMs = 0;
        this.ssoSessionId = null;
        this.sessionReady = false;
        this.lastInitTimeMs = 0;
        this.lastValidateTimeMs = 0;
      }

      // Better expiry checking - OAuth tokens expire in 10 minutes, sessions in ~9 minutes
      const now = Date.now();
      const tokenValid = this.accessToken && this.accessTokenExpiryMs - 5_000 > now;
      const ssoValid = this.ssoAccessToken &&
                       this.ssoAccessTokenExpiryMs > now &&
                       this.lastInitTimeMs &&
                       (now - this.lastInitTimeMs < 540_000); // 9 minutes
      const sessionValid = this.sessionReady &&
                          this.last.validate.status === 200 &&
                          this.last.init.status === 200;

      if (tokenValid && ssoValid && sessionValid && !forceRefresh) {
        // Everything is still fresh, just maintain session
        await this.keepaliveSession();
        return;
      }

      const oauth = await this.getOAuthToken();
      await this.createSSOSession(oauth);
      // After SSO, a 3s delay is already applied in createSSOSession()

      // Validate (idempotent), handle 401/403 once by resetting and retrying flow
      const v = await this.validateSso();
      this.lastValidateTimeMs = Date.now();
      if ((v === 401 || v === 403) && retry) {
        this.ssoAccessToken = null;
        this.ssoSessionId = null;
        return this.ensureReady(false);
      }
      if (v !== 200) throw new Error(`validate ${this.last.validate.status}`);

      // Wait 2s after validate
      await this.sleep(2000);

      // Tickle once before init
      await this.tickle();

      await this.initBrokerageWithSso();

      // Establish gateway connection for trading
      await this.establishGateway();

      this.lastInitTimeMs = Date.now();
      return;
    } catch (err: any) {
      const msg = String(err?.message || err);

      // Handle 410 Gone specifically - requires full refresh
      if (err?.statusCode === 410 || err?.requiresRefresh || msg.includes("410")) {
        console.log('[IBKR] Caught 410 error - attempting full refresh');
        // Clear everything and retry with force refresh
        this.accessToken = null;
        this.accessTokenExpiryMs = 0;
        this.ssoSessionId = null;
        this.ssoAccessToken = null;
        this.ssoAccessTokenExpiryMs = 0;
        this.sessionReady = false;
        this.lastInitTimeMs = 0;
        this.lastValidateTimeMs = 0;

        if (retry) {
          console.log('[IBKR] Retrying with force refresh after 410');
          await this.sleep(1000); // Brief delay before retry
          return this.ensureReady(false, true); // Retry with forceRefresh
        }
      }

      // Handle 401/403 authentication errors
      if (retry && (msg.includes("401") || msg.includes("403"))) {
        console.log('[IBKR] Caught 401/403 error - clearing auth and retrying');
        this.accessToken = null;
        this.accessTokenExpiryMs = 0;
        this.ssoSessionId = null;
        this.ssoAccessToken = null;
        this.sessionReady = false;
        return this.ensureReady(false);
      }

      throw err;
    }
  }

  private authHeaders() {
    if (!this.ssoAccessToken) throw new Error('No SSO bearer');
    return {
      Authorization: `Bearer ${this.ssoAccessToken}`,
    } as Record<string, string>;
  }

  async getAccount(): Promise<AccountInfo> {
    await this.ensureReady();
    await this.ensureAccountSelected();
    const accountId = this.accountId || process.env.IBKR_ACCOUNT_ID || "";
    try {
      // CP endpoint - use cookie auth only, no Authorization header
      const resp = await this.http.get(`/v1/api/portfolio/${encodeURIComponent(accountId)}/summary`);
      const bodySnippet = typeof resp.data === 'string' ? resp.data.slice(0, 200) : JSON.stringify(resp.data || {}).slice(0, 200);
      console.log(`[IBKR][getAccount] status=${resp.status} body=${bodySnippet}`);
      if (resp.status !== 200) throw new Error(`status ${resp.status}`);
      const data = resp.data as any;
      // IBKR returns nested objects with 'amount' field
      const getValue = (field: any): number => {
        if (typeof field === 'number') return field;
        if (field?.amount !== undefined) return Number(field.amount);
        if (field?.value !== undefined) return Number(field.value);
        return 0;
      };
      const info: AccountInfo = {
        accountNumber: accountId || "",
        buyingPower: getValue(data?.availablefunds || data?.AvailableFunds),
        portfolioValue: getValue(data?.equitywithloanvalue || data?.EquityWithLoanValue || data?.netLiquidation),
        netDelta: getValue(data?.netdelta || data?.NetDelta),
        dayPnL: getValue(data?.daytradesremaining || data?.DayTradesRemaining),
        marginUsed: getValue(data?.initialmargin || data?.InitialMargin),
      };
      return info;
    } catch {
      // Fallback to zeros if IBKR request fails
      return {
        accountNumber: accountId || "",
        buyingPower: 0,
        portfolioValue: 0,
        netDelta: 0,
        dayPnL: 0,
        marginUsed: 0,
      };
    }
  }

  async getPositions(): Promise<Position[]> {
    await this.ensureReady();
    await this.ensureAccountSelected();
    const accountId = this.accountId || process.env.IBKR_ACCOUNT_ID || "";
    try {
      // CP endpoint - use cookie auth only, no Authorization header
      const resp = await this.http.get(`/v1/api/portfolio/${encodeURIComponent(accountId)}/positions`);
      const bodySnippet = typeof resp.data === 'string' ? resp.data.slice(0, 200) : JSON.stringify(resp.data || {}).slice(0, 200);
      console.log(`[IBKR][getPositions] status=${resp.status} body=${bodySnippet}`);
      if (resp.status !== 200) throw new Error(`status ${resp.status}`);
      const items = (resp.data as any[]) || [];
      // Minimal mapping: only map options legs we can infer; return empty if unknown
      const positions: Position[] = (items || [])
        .filter((p) => p?.assetClass === "OPT")
        .map((p) => ({
          id: String(p?.conid || randomUUID()),
          symbol: String(p?.symbol || p?.localSymbol || ""),
          strategy: "put_credit",
          sellStrike: "0",
          buyStrike: "0",
          expiration: new Date(),
          quantity: Number(p?.position || 0),
          openCredit: "0",
          currentValue: String(Number(p?.marketPrice || 0) * 100),
          delta: String(Number(p?.delta || 0)),
          marginRequired: "0",
          openedAt: new Date(),
          status: "open",
        }));
      return positions;
    } catch {
      return [];
    }
  }

  // Establish gateway/bridge connection for trading
  private async establishGateway(): Promise<void> {
    console.log('[IBKR][Gateway] Establishing gateway connection...');
    try {
      // Call reauthenticate endpoint to establish gateway
      const reauthUrl = '/v1/api/iserver/reauthenticate';
      const reauthResp = await this.http.post(reauthUrl, {}, {
        headers: this.authHeaders()
      });
      console.log(`[IBKR][Gateway] Reauthenticate status=${reauthResp.status}`);

      // Call auth/status to check gateway status
      const statusUrl = '/v1/api/iserver/auth/status';
      const statusResp = await this.http.post(statusUrl, {}, {
        headers: this.authHeaders()
      });
      console.log(`[IBKR][Gateway] Auth status=${statusResp.status} authenticated=${statusResp.data?.authenticated} connected=${statusResp.data?.connected}`);

      // Small delay to let gateway establish
      await this.sleep(2000);
    } catch (err) {
      console.error('[IBKR][Gateway] Failed to establish gateway:', err);
    }
  }

  private async resolveConid(symbol: string): Promise<number | null> {
    await this.ensureAccountSelected();
    const url = `/v1/api/iserver/secdef/search`;
    const parse = (data: any): number | null => {
      if (!data) return null;
      if (Array.isArray(data)) {
        for (const it of data) {
          // IBKR returns conid as string, not number
          if (it?.conid) return parseInt(it.conid, 10);
          if (it?.contract?.conid) return parseInt(it.contract.conid, 10);
        }
      }
      const sections = data?.sections;
      if (Array.isArray(sections)) {
        for (const sec of sections) {
          const res = parse(sec?.results || sec?.contracts || sec);
          if (res !== null) return res;
        }
      }
      return null;
    };
    try {
      // CP endpoint - use cookie auth only, no Authorization header
      const resp = await this.http.get(`${url}?symbol=${encodeURIComponent(symbol)}&name=${encodeURIComponent(symbol)}&secType=STK`);
      const bodySnippet = typeof resp.data === 'string' ? resp.data.slice(0, 200) : JSON.stringify(resp.data || {}).slice(0, 200);
      console.log(`[IBKR][resolveConid] attempt1 status=${resp.status} body=${bodySnippet}`);

      // If we get "no bridge" error, try to establish gateway
      if (resp.status === 400 && bodySnippet.includes('no bridge')) {
        console.log('[IBKR][resolveConid] Got "no bridge" error, establishing gateway...');
        await this.establishGateway();
        // Retry after establishing gateway
        const retryResp = await this.http.get(`${url}?symbol=${encodeURIComponent(symbol)}&name=${encodeURIComponent(symbol)}&secType=STK`);
        const retrySnippet = typeof retryResp.data === 'string' ? retryResp.data.slice(0, 200) : JSON.stringify(retryResp.data || {}).slice(0, 200);
        console.log(`[IBKR][resolveConid] retry after gateway status=${retryResp.status} body=${retrySnippet}`);
        if (retryResp.status === 200) {
          const c = parse(retryResp.data);
          if (typeof c === 'number') return c;
        }
      }
      // If we get "not authenticated" error, re-authenticate
      else if (resp.status === 401 && bodySnippet.includes('not authenticated')) {
        console.log('[IBKR][resolveConid] Got "not authenticated" error, re-authenticating...');
        await this.ensureReady();
        // Retry after re-authentication
        const retryResp = await this.http.get(`${url}?symbol=${encodeURIComponent(symbol)}&name=${encodeURIComponent(symbol)}&secType=STK`);
        const retrySnippet = typeof retryResp.data === 'string' ? retryResp.data.slice(0, 200) : JSON.stringify(retryResp.data || {}).slice(0, 200);
        console.log(`[IBKR][resolveConid] retry after re-auth status=${retryResp.status} body=${retrySnippet}`);
        if (retryResp.status === 200) {
          const c = parse(retryResp.data);
          if (typeof c === 'number') return c;
        }
      } else if (resp.status === 200) {
        const c = parse(resp.data);
        if (typeof c === 'number') return c;
      }
    } catch {}
    try {
      // CP endpoint - use cookie auth only, no Authorization header
      const resp2 = await this.http.get(`${url}?symbol=${encodeURIComponent(symbol)}`);
      const bodySnippet2 = typeof resp2.data === 'string' ? resp2.data.slice(0, 200) : JSON.stringify(resp2.data || {}).slice(0, 200);
      console.log(`[IBKR][resolveConid] attempt2 status=${resp2.status} body=${bodySnippet2}`);
      if (resp2.status === 200) return parse(resp2.data);
    } catch {}
    return null;
  }

  async getOptionChain(symbol: string, expiration?: string): Promise<OptionChainData> {
    await this.ensureReady();
    // Try to resolve underlying price via snapshot; fall back to 0
    let underlyingPrice = 0;
    try {
      const conid = await this.resolveConid(symbol);
      if (conid) {
        // CP endpoint - use cookie auth only, no Authorization header
        const snap = await this.http.get(`/v1/api/iserver/marketdata/snapshot?conids=${conid}`);
        if (snap.status === 200) {
          const data = (snap.data as any[]) || [];
          const last = data?.[0]?.["31"] ?? data?.[0]?.last;
          if (last != null) underlyingPrice = Number(last);
        }
      }
    } catch {
      // ignore
    }
    return {
      symbol,
      underlyingPrice,
      underlyingChange: 0,
      options: [],
    };
  }

  async getTrades(): Promise<Trade[]> {
    // Not implemented yet — could map from orders; return empty list to keep UI stable
    return [];
  }

  async placeOrder(_trade: InsertTrade): Promise<{ id?: string; status: string; raw?: any }> {
    // Minimal paper trading order using underlying conid, single-leg MKT
    const trade = _trade;
    await this.ensureReady();
    const accountId = this.accountId || process.env.IBKR_ACCOUNT_ID || "";
    if (!trade?.symbol || !accountId) {
      return { status: "rejected_400" };
    }
    // Resolve underlying conid
    const conid = await this.resolveConid(trade.symbol);
    if (!conid) {
      await storage.createAuditLog({ eventType: "IBKR_ORDER_SUBMIT", details: `FAILED http=0 reason=no_conid`, status: "FAILED" });
      return { status: "rejected_no_conid" };
    }

    const side = "SELL"; // single-leg placeholder for credit strategies
    const quantity = Math.max(1, Number(trade.quantity || 1));
    const body = {
      orders: [
        {
          acctId: accountId,
          conid,
          orderType: "MKT",
          side,
          tif: "DAY",
          quantity,
        },
      ],
    };

    const url = `/v1/api/iserver/account/${encodeURIComponent(accountId)}/orders`;
    const reqId = randomUUID();
    const resp = await this.http.post(url, body, { headers: { 'Content-Type': 'application/json' } });

    const http = resp.status;
    const raw: any = resp.data;

    if (!(resp.status >= 200 && resp.status < 300)) {
      let snippet = "";
      try { snippet = typeof raw === 'string' ? raw.slice(0,200) : JSON.stringify(raw).slice(0,200); } catch {}
      await storage.createAuditLog({ eventType: "IBKR_ORDER_SUBMIT", details: `FAILED http=${http} req=${reqId} body=${snippet}`, status: "FAILED" });
      console.error(`[IBKR][${reqId}] POST /v1/api/iserver/account/{acct}/orders -> ${http} ${snippet}`);
      return { status: `rejected_${http}`, raw };
    }

    // Try to extract an order id
    let orderId: string | undefined = undefined;
    try {
      const arr = Array.isArray(raw) ? raw : raw?.orders || raw?.data || [];
      const first = Array.isArray(arr) ? arr[0] : undefined;
      orderId = String(first?.id || first?.orderId || first?.c_oid || "").trim() || undefined;
    } catch {}

    await storage.createAuditLog({ eventType: "IBKR_ORDER_SUBMIT", details: `OK http=${http} req=${reqId} orderId=${orderId ?? 'n/a'}`, status: "SUCCESS" });
    return { id: orderId, status: "submitted", raw };
  }

  getDiagnostics(): IbkrDiagnostics {
    return this.last;
  }

  // Force refresh the authentication pipeline
  async forceRefresh(): Promise<void> {
    console.log('[IBKR] Force refresh initiated');
    await this.ensureReady(true, true);
  }

  async placeStockOrder(
    symbol: string,
    side: 'BUY' | 'SELL',
    quantity: number,
    opts?: { orderType?: 'MKT'|'LMT'; limitPrice?: number; tif?: 'DAY'|'GTC'; outsideRth?: boolean }
  ): Promise<{ id?: string; status: string; raw?: any }> {
    await this.ensureReady();
    await this.ensureAccountSelected();
    const accountId = this.accountId || process.env.IBKR_ACCOUNT_ID || "";
    if (!symbol || !accountId || !quantity || quantity <= 0) {
      return { status: "rejected_400" };
    }
    const conid = await this.resolveConid(symbol);
    if (!conid) {
      await storage.createAuditLog({ eventType: "IBKR_ORDER_SUBMIT", details: `FAILED http=0 reason=no_conid`, status: "FAILED" });
      return { status: "rejected_no_conid" };
    }

    const orderType = opts?.orderType ?? 'MKT';
    const tif = opts?.tif ?? 'DAY';
    const outsideRTH = !!opts?.outsideRth;

    const order: any = {
      acctId: accountId,
      conid,
      orderType,
      side,
      tif,
      quantity: Math.floor(quantity),
      outsideRTH,
    };
    if (orderType === 'LMT') {
      order.price = Number(opts?.limitPrice ?? NaN);
    }

    const body = { orders: [ order ] };
    const url2 = `/v1/api/iserver/account/${encodeURIComponent(accountId)}/orders`;
    const reqId2 = randomUUID();
    // CP endpoint - use cookie auth only, no Authorization header
    const resp2 = await this.http.post(url2, body, { headers: { 'Content-Type': 'application/json' } });
    const http2 = resp2.status;
    const raw2: any = resp2.data;
    if (!(resp2.status >= 200 && resp2.status < 300)) {
      let snippet = "";
      try { snippet = typeof raw2 === 'string' ? raw2.slice(0,200) : JSON.stringify(raw2).slice(0,200); } catch {}
      await storage.createAuditLog({ eventType: "IBKR_ORDER_SUBMIT", details: `FAILED http=${http2} req=${reqId2} body=${snippet}` , status: "FAILED" });
      console.error(`[IBKR][${reqId2}] POST /v1/api/iserver/account/{acct}/orders -> ${http2} ${snippet}`);
      return { status: `rejected_${http2}`, raw: raw2 };
    }
    let orderId2: string | undefined = undefined;
    try {
      const arr = Array.isArray(raw2) ? raw2 : raw2?.orders || raw2?.data || [];
      const first = Array.isArray(arr) ? arr[0] : undefined;
      // IBKR returns order_id field
      orderId2 = String(first?.order_id || first?.id || first?.orderId || first?.c_oid || "").trim() || undefined;
    } catch {}
    await storage.createAuditLog({ eventType: "IBKR_ORDER_SUBMIT", details: `OK http=${http2} req=${reqId2} orderId=${orderId2 ?? 'n/a'}` , status: "SUCCESS" });
    return { id: orderId2, status: "submitted", raw: raw2 };
  }

  async getOpenOrders(): Promise<any[]> {
    await this.ensureReady();
    await this.ensureAccountSelected();

    // Get all open orders - need to pass filters to include all active order states
    // IBKR filters: Submitted, PreSubmitted, PendingSubmit, Filled, Cancelled, PendingCancel
    // We want active orders that can be cancelled
    const filters = 'Submitted,PreSubmitted,PendingSubmit,PendingCancel,Working';
    const ordersUrl = `/v1/api/iserver/account/orders?filters=${encodeURIComponent(filters)}`;
    const reqId3 = randomUUID();

    console.log(`[IBKR][${reqId3}] Fetching open orders with filters: ${filters}`);

    // CP endpoint - use cookie auth only, no Authorization header
    const resp3 = await this.http.get(ordersUrl);
    const http3 = resp3.status;

    // Log the raw response for debugging
    console.log(`[IBKR][${reqId3}] GET /v1/api/iserver/account/orders response status: ${http3}`);
    console.log(`[IBKR][${reqId3}] Response data:`, JSON.stringify(resp3.data).slice(0, 500));

    if (!(resp3.status >= 200 && resp3.status < 300)) {
      let snippet = "";
      try { snippet = (typeof resp3.data === 'string' ? resp3.data : JSON.stringify(resp3.data || {})).slice(0,200); } catch {}
      console.error(`[IBKR][${reqId3}] GET /v1/api/iserver/account/orders -> ${http3} ${snippet}`);
      return [];
    }

    try {
      const data = resp3.data;
      const list = Array.isArray(data) ? data : (data?.orders || data?.data || []);
      console.log(`[IBKR][${reqId3}] Found ${list.length} open orders`);

      // Log each order for debugging
      list.forEach((order: any, i: number) => {
        console.log(`[IBKR][${reqId3}] Order ${i + 1}:`, {
          orderId: order.orderId || order.id,
          status: order.status,
          symbol: order.ticker || order.symbol,
          quantity: order.size || order.quantity,
          side: order.side
        });
      });

      return list;
    } catch (error) {
      console.error(`[IBKR][${reqId3}] Error parsing orders response:`, error);
      return [];
    }
  }

  async cancelOrder(orderId: string): Promise<{ success: boolean; message?: string }> {
    console.log(`[IBKR] Canceling order ${orderId}...`);

    await this.ensureReady();

    const accountId = this.accountId || 'DU9807013';
    const cancelUrl = `/v1/api/iserver/account/${accountId}/order/${orderId}`;

    try {
      const resp = await this.http.delete(cancelUrl);
      console.log(`[IBKR][cancelOrder] DELETE ${cancelUrl} -> ${resp.status}`);

      if (resp.status >= 200 && resp.status < 300) {
        return { success: true, message: `Order ${orderId} cancelled` };
      } else {
        const errorMsg = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data || {});
        return { success: false, message: errorMsg };
      }
    } catch (err) {
      console.error(`[IBKR][cancelOrder] Error canceling order ${orderId}:`, err);
      return { success: false, message: err.message || 'Unknown error' };
    }
  }

  async cancelAllOrders(): Promise<{ success: boolean; cleared: number; errors: string[] }> {
    console.log('[IBKR] Fetching and canceling all open orders...');

    try {
      await this.ensureReady();

      const openOrders = await this.getOpenOrders();
      console.log(`[IBKR] Found ${openOrders.length} open orders to cancel`);

      if (openOrders.length === 0) {
        console.log('[IBKR] No open orders found - nothing to cancel');
        // Return success: false to indicate no orders were cleared (preventing false positive)
        return { success: false, cleared: 0, errors: ['No open orders found'] };
      }

      const errors: string[] = [];
      let cleared = 0;

      for (const order of openOrders) {
        const orderId = order.orderId || order.id;
        if (!orderId) {
          console.error('[IBKR] Order missing ID:', order);
          errors.push('Order missing ID');
          continue;
        }

        console.log(`[IBKR] Attempting to cancel order ${orderId}...`);
        const result = await this.cancelOrder(orderId);

        if (result.success) {
          cleared++;
          console.log(`[IBKR] Successfully cancelled order ${orderId}`);
        } else {
          const errorMsg = `Failed to cancel ${orderId}: ${result.message}`;
          console.error(`[IBKR] ${errorMsg}`);
          errors.push(errorMsg);
        }

        // Small delay between cancellations to avoid overwhelming the API
        await this.sleep(500);
      }

      console.log(`[IBKR] Cancel operation completed: cleared=${cleared}, errors=${errors.length}`);

      // Only return success:true if we actually cleared some orders
      return {
        success: cleared > 0 && errors.length === 0,
        cleared,
        errors: errors.length > 0 ? errors : (cleared === 0 ? ['No orders were successfully cancelled'] : [])
      };
    } catch (err) {
      console.error('[IBKR][cancelAllOrders] Error:', err);
      return {
        success: false,
        cleared: 0,
        errors: [err.message || 'Unknown error occurred while cancelling orders']
      };
    }
  }
}

// Provider factory and diagnostics access
let activeClient: IbkrClient | null = null;
export function getIbkrDiagnostics(): IbkrDiagnostics {
  return activeClient
    ? activeClient.getDiagnostics()
    : { oauth: { status: null, ts: "" }, sso: { status: null, ts: "" }, validate: { status: null, ts: "" }, init: { status: null, ts: "" } };
}

export function createIbkrProvider(config: IbkrConfig): BrokerProvider {
  const client = new IbkrClient(config);
  activeClient = client;
  return {
    getAccount: () => client.getAccount(),
    getPositions: () => client.getPositions(),
    getOptionChain: (symbol: string, expiration?: string) => client.getOptionChain(symbol, expiration),
    getTrades: () => client.getTrades(),
    placeOrder: (trade: InsertTrade) => client.placeOrder(trade),
  };
}

// Utility for testing paper stock orders (e.g., BUY 1 SPY)
export async function placePaperStockOrder(params: { symbol: string; side: 'BUY' | 'SELL'; quantity: number; orderType?: 'MKT'|'LMT'; limitPrice?: number; tif?: 'DAY'|'GTC'; outsideRth?: boolean }) {
  if (!activeClient) throw new Error('IBKR client not initialized');
  return activeClient.placeStockOrder(params.symbol, params.side, params.quantity, {
    orderType: params.orderType,
    limitPrice: params.limitPrice,
    tif: params.tif,
    outsideRth: params.outsideRth,
  });
}

export async function listPaperOpenOrders() {
  if (!activeClient) throw new Error('IBKR client not initialized');
  return activeClient.getOpenOrders();
}

export async function clearAllPaperOrders() {
  if (!activeClient) throw new Error('IBKR client not initialized');
  return activeClient.cancelAllOrders();
}

// Ensure IBKR client is ready and return latest diagnostics
export async function ensureIbkrReady(): Promise<IbkrDiagnostics> {
  if (!activeClient) throw new Error('IBKR client not initialized');
  // @ts-ignore ensureReady is defined on IbkrClient
  if (typeof (activeClient as any).ensureReady === 'function') {
    // Await readiness bootstrap (OAuth → SSO → validate → etc.)
    await (activeClient as any).ensureReady();
  }
  return activeClient.getDiagnostics();
}
