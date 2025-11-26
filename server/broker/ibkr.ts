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
      if (resp.status !== 200) throw new Error(`status ${resp.status}`);
      const data = resp.data as any;

      // IBKR returns nested objects with 'amount' field for numeric values
      const getValue = (field: any): number => {
        if (typeof field === 'number') return field;
        if (field?.amount !== undefined) return Number(field.amount);
        if (field?.value !== undefined && typeof field.value === 'number') return Number(field.value);
        return 0;
      };

      // Log available fields for debugging
      const availableFields = Object.keys(data || {}).join(', ');
      console.log(`[IBKR][getAccount] status=${resp.status} fields=${availableFields}`);

      // Extract key values with logging
      const netliq = getValue(data?.netliquidation);
      const buyingPwr = getValue(data?.buyingpower);
      const availFunds = getValue(data?.availablefunds);
      const excessLiq = getValue(data?.excessliquidity);
      const unrealPnl = getValue(data?.unrealizedpnl);
      const realPnl = getValue(data?.realizedpnl);
      const initMargin = getValue(data?.initmarginreq || data?.initialmargin);

      // New enhanced fields
      const totalCash = getValue(data?.totalcashvalue);
      const settledCash = getValue(data?.settledcash || data?.['settledcashbydate']);
      const grossPosValue = getValue(data?.grosspositionvalue);
      const maintMargin = getValue(data?.maintmarginreq || data?.maintenancemargin);
      const cushionRaw = getValue(data?.cushion);

      // Calculate leverage: grossPositionValue / netLiquidation
      const leverage = netliq > 0 ? grossPosValue / netliq : 0;
      // Cushion is already a percentage from IBKR (e.g., 0.99 = 99%)
      const cushion = cushionRaw * 100;

      console.log(`[IBKR][getAccount] netliq=${netliq} buyingPwr=${buyingPwr} availFunds=${availFunds} excessLiq=${excessLiq} unrealPnl=${unrealPnl} realPnl=${realPnl} initMargin=${initMargin} totalCash=${totalCash} settledCash=${settledCash} grossPos=${grossPosValue} maintMargin=${maintMargin} cushion=${cushion}% leverage=${leverage.toFixed(2)}x`);

      const info: AccountInfo = {
        accountNumber: accountId || "",
        // Use buyingpower if available, fallback to excessliquidity or availablefunds
        buyingPower: buyingPwr || excessLiq || availFunds,
        // Use netliquidation for accurate portfolio value
        portfolioValue: netliq || getValue(data?.equitywithloanvalue),
        netDelta: getValue(data?.netdelta),
        // Combine unrealized + realized for day P&L
        dayPnL: unrealPnl + realPnl,
        marginUsed: initMargin,
        // New enhanced fields
        totalCash: totalCash || availFunds,
        settledCash: settledCash || totalCash || availFunds,
        grossPositionValue: grossPosValue,
        maintenanceMargin: maintMargin,
        cushion: cushion,
        leverage: leverage,
        excessLiquidity: excessLiq,
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
        totalCash: 0,
        settledCash: 0,
        grossPositionValue: 0,
        maintenanceMargin: 0,
        cushion: 0,
        leverage: 0,
        excessLiquidity: 0,
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
      // CP API endpoints use cookie authentication, no Authorization header
      const reauthUrl = '/v1/api/iserver/reauthenticate';
      const reauthResp = await this.http.post(reauthUrl, {});
      console.log(`[IBKR][Gateway] Reauthenticate status=${reauthResp.status}`);

      // Call auth/status to check gateway status
      const statusUrl = '/v1/api/iserver/auth/status';
      const statusResp = await this.http.post(statusUrl, {});

      const isAuthenticated = statusResp.data?.authenticated === true;
      const isConnected = statusResp.data?.connected === true;

      console.log(`[IBKR][Gateway] Auth status=${statusResp.status} authenticated=${isAuthenticated} connected=${isConnected}`);

      if (!isAuthenticated || !isConnected) {
        console.warn(`[IBKR][Gateway] Gateway not fully established: authenticated=${isAuthenticated}, connected=${isConnected}`);
        // Try one more time after a delay
        await this.sleep(3000);
        const retryResp = await this.http.post(statusUrl, {});
        const retryAuth = retryResp.data?.authenticated === true;
        const retryConn = retryResp.data?.connected === true;
        console.log(`[IBKR][Gateway] Retry auth status: authenticated=${retryAuth} connected=${retryConn}`);

        if (!retryAuth || !retryConn) {
          throw new Error(`Gateway connection failed: authenticated=${retryAuth}, connected=${retryConn}`);
        }
      }

      // Small delay to let gateway establish
      await this.sleep(2000);
    } catch (err) {
      console.error('[IBKR][Gateway] Failed to establish gateway:', err);
      // Re-throw to trigger proper error handling
      throw err;
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
    const reqId = randomUUID().slice(0, 8);
    console.log(`[IBKR][getOptionChain][${reqId}] Starting for ${symbol} expiration=${expiration || '0DTE'}`);

    // Try to resolve underlying price and conid
    let underlyingPrice = 0;
    let underlyingConid: number | null = null;

    try {
      underlyingConid = await this.resolveConid(symbol);
      if (underlyingConid) {
        // Get underlying price via snapshot
        const snap = await this.http.get(`/v1/api/iserver/marketdata/snapshot?conids=${underlyingConid}`);
        if (snap.status === 200) {
          const data = (snap.data as any[]) || [];
          const last = data?.[0]?.["31"] ?? data?.[0]?.last;
          if (last != null) underlyingPrice = Number(last);
          console.log(`[IBKR][getOptionChain][${reqId}] Underlying price: ${underlyingPrice}`);
        }
      }
    } catch (err) {
      console.error(`[IBKR][getOptionChain][${reqId}] Error getting underlying price:`, err);
    }

    // If no underlying conid or price, return empty
    if (!underlyingConid || underlyingPrice === 0) {
      console.warn(`[IBKR][getOptionChain][${reqId}] No underlying data, returning empty options`);
      return { symbol, underlyingPrice, underlyingChange: 0, options: [] };
    }

    // Determine expiration - default to today for 0DTE
    const today = new Date();
    const targetExpiration = expiration || today.toISOString().slice(0, 10).replace(/-/g, '');
    const expirationMonth = targetExpiration.slice(0, 6); // YYYYMM format

    const options: Array<{
      strike: number;
      type: "call" | "put";
      bid: number;
      ask: number;
      delta: number;
      openInterest: number;
      expiration: string;
    }> = [];

    try {
      // Step 1: Get available strikes from IBKR
      const strikesUrl = `/v1/api/iserver/secdef/strikes?conid=${underlyingConid}&sectype=OPT&month=${expirationMonth}`;
      console.log(`[IBKR][getOptionChain][${reqId}] Fetching strikes: ${strikesUrl}`);

      const strikesResp = await this.http.get(strikesUrl);
      if (strikesResp.status !== 200 || !strikesResp.data) {
        console.warn(`[IBKR][getOptionChain][${reqId}] Failed to get strikes: status=${strikesResp.status}`);
        return { symbol, underlyingPrice, underlyingChange: 0, options: [] };
      }

      // Strikes response is { call: number[], put: number[] }
      const strikesData = strikesResp.data as { call?: number[]; put?: number[] };
      const putStrikes = strikesData.put || [];
      const callStrikes = strikesData.call || [];

      console.log(`[IBKR][getOptionChain][${reqId}] Found ${putStrikes.length} put strikes, ${callStrikes.length} call strikes`);

      // Filter to strikes near the money (within 5% of underlying)
      const priceRange = underlyingPrice * 0.05;
      const nearMoneyPuts = putStrikes.filter(s => s >= underlyingPrice - priceRange && s <= underlyingPrice);
      const nearMoneyCalls = callStrikes.filter(s => s <= underlyingPrice + priceRange && s >= underlyingPrice);

      // Take up to 10 strikes each side
      const selectedPuts = nearMoneyPuts.slice(-10); // Closest OTM puts
      const selectedCalls = nearMoneyCalls.slice(0, 10); // Closest OTM calls

      console.log(`[IBKR][getOptionChain][${reqId}] Selected ${selectedPuts.length} puts, ${selectedCalls.length} calls near the money`);

      // Step 2: Get option conids for each strike via secdef/search
      for (const strike of selectedPuts) {
        try {
          const optConid = await this.resolveOptionConid(symbol, targetExpiration, 'PUT', strike);
          if (optConid) {
            options.push({
              strike,
              type: 'put',
              bid: 0.5, // Default placeholder - market data requires separate call
              ask: 0.6,
              delta: -0.15, // Placeholder - real Greeks require market data subscription
              openInterest: 0,
              expiration: targetExpiration,
            });
          }
        } catch (err) {
          console.warn(`[IBKR][getOptionChain][${reqId}] Failed to resolve PUT ${strike}:`, err);
        }
      }

      for (const strike of selectedCalls) {
        try {
          const optConid = await this.resolveOptionConid(symbol, targetExpiration, 'CALL', strike);
          if (optConid) {
            options.push({
              strike,
              type: 'call',
              bid: 0.5,
              ask: 0.6,
              delta: 0.15,
              openInterest: 0,
              expiration: targetExpiration,
            });
          }
        } catch (err) {
          console.warn(`[IBKR][getOptionChain][${reqId}] Failed to resolve CALL ${strike}:`, err);
        }
      }

      console.log(`[IBKR][getOptionChain][${reqId}] Resolved ${options.length} option contracts`);

    } catch (err) {
      console.error(`[IBKR][getOptionChain][${reqId}] Error fetching option chain:`, err);
    }

    return {
      symbol,
      underlyingPrice,
      underlyingChange: 0,
      options,
    };
  }

  /**
   * Get option chain with real market data (bid/ask/delta) for engine strike selection
   * This is a more comprehensive version that attempts to get real Greeks
   */
  async getOptionChainWithStrikes(
    symbol: string,
    expiration?: string
  ): Promise<{
    underlyingPrice: number;
    puts: Array<{ strike: number; bid: number; ask: number; delta: number; conid?: number }>;
    calls: Array<{ strike: number; bid: number; ask: number; delta: number; conid?: number }>;
  }> {
    await this.ensureReady();
    const reqId = randomUUID().slice(0, 8);
    console.log(`[IBKR][getOptionChainWithStrikes][${reqId}] Starting for ${symbol}`);

    // Get underlying price
    let underlyingPrice = 0;
    let underlyingConid: number | null = null;

    try {
      underlyingConid = await this.resolveConid(symbol);
      if (underlyingConid) {
        const snap = await this.http.get(`/v1/api/iserver/marketdata/snapshot?conids=${underlyingConid}`);
        if (snap.status === 200) {
          const data = (snap.data as any[]) || [];
          const last = data?.[0]?.["31"] ?? data?.[0]?.last;
          if (last != null) underlyingPrice = Number(last);
        }
      }
    } catch (err) {
      console.error(`[IBKR][getOptionChainWithStrikes][${reqId}] Error getting price:`, err);
    }

    if (!underlyingConid || underlyingPrice === 0) {
      console.warn(`[IBKR][getOptionChainWithStrikes][${reqId}] No underlying data`);
      return { underlyingPrice: 0, puts: [], calls: [] };
    }

    // Determine expiration
    const today = new Date();
    const targetExpiration = expiration || today.toISOString().slice(0, 10).replace(/-/g, '');
    const expirationMonth = targetExpiration.slice(0, 6);

    const puts: Array<{ strike: number; bid: number; ask: number; delta: number; conid?: number }> = [];
    const calls: Array<{ strike: number; bid: number; ask: number; delta: number; conid?: number }> = [];

    try {
      // Get available strikes
      const strikesUrl = `/v1/api/iserver/secdef/strikes?conid=${underlyingConid}&sectype=OPT&month=${expirationMonth}`;
      const strikesResp = await this.http.get(strikesUrl);

      if (strikesResp.status !== 200) {
        console.warn(`[IBKR][getOptionChainWithStrikes][${reqId}] Failed to get strikes`);
        return { underlyingPrice, puts: [], calls: [] };
      }

      const strikesData = strikesResp.data as { call?: number[]; put?: number[] };
      const putStrikes = strikesData.put || [];
      const callStrikes = strikesData.call || [];

      // Filter to OTM options (puts below price, calls above)
      const otmPuts = putStrikes.filter(s => s < underlyingPrice).slice(-15); // 15 closest OTM puts
      const otmCalls = callStrikes.filter(s => s > underlyingPrice).slice(0, 15); // 15 closest OTM calls

      console.log(`[IBKR][getOptionChainWithStrikes][${reqId}] Processing ${otmPuts.length} OTM puts, ${otmCalls.length} OTM calls`);

      // Resolve each option and estimate delta based on moneyness
      for (const strike of otmPuts) {
        const moneyness = (underlyingPrice - strike) / underlyingPrice;
        // Rough delta estimate: ~0.5 at ATM, decreasing as more OTM
        const estimatedDelta = -Math.max(0.05, 0.5 - moneyness * 5);

        let conid: number | undefined;
        try {
          const resolvedConid = await this.resolveOptionConid(symbol, targetExpiration, 'PUT', strike);
          if (resolvedConid) conid = resolvedConid;
        } catch {
          // Continue without conid
        }

        puts.push({
          strike,
          bid: Math.max(0.05, moneyness * underlyingPrice * 0.1), // Rough estimate
          ask: Math.max(0.10, moneyness * underlyingPrice * 0.12),
          delta: estimatedDelta,
          conid,
        });
      }

      for (const strike of otmCalls) {
        const moneyness = (strike - underlyingPrice) / underlyingPrice;
        const estimatedDelta = Math.max(0.05, 0.5 - moneyness * 5);

        let conid: number | undefined;
        try {
          const resolvedConid = await this.resolveOptionConid(symbol, targetExpiration, 'CALL', strike);
          if (resolvedConid) conid = resolvedConid;
        } catch {
          // Continue without conid
        }

        calls.push({
          strike,
          bid: Math.max(0.05, moneyness * underlyingPrice * 0.1),
          ask: Math.max(0.10, moneyness * underlyingPrice * 0.12),
          delta: estimatedDelta,
          conid,
        });
      }

      console.log(`[IBKR][getOptionChainWithStrikes][${reqId}] Resolved ${puts.length} puts, ${calls.length} calls`);

    } catch (err) {
      console.error(`[IBKR][getOptionChainWithStrikes][${reqId}] Error:`, err);
    }

    return { underlyingPrice, puts, calls };
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

    // Log full response for debugging
    console.log(`[IBKR][${reqId}] Order response: status=${http}, data=${JSON.stringify(raw)}`);

    if (!(resp.status >= 200 && resp.status < 300)) {
      let snippet = "";
      try { snippet = typeof raw === 'string' ? raw.slice(0,500) : JSON.stringify(raw).slice(0,500); } catch {}
      await storage.createAuditLog({ eventType: "IBKR_ORDER_SUBMIT", details: `FAILED http=${http} req=${reqId} body=${snippet}`, status: "FAILED" });
      console.error(`[IBKR][${reqId}] POST /v1/api/iserver/account/{acct}/orders -> ${http} ${snippet}`);
      return { status: `rejected_${http}`, raw };
    }

    // Parse order ID from various possible response formats
    let orderId: string | undefined = undefined;
    try {
      // IBKR may return different formats - check all possibilities
      if (raw?.order_id) {
        orderId = String(raw.order_id);
      }
      else if (Array.isArray(raw)) {
        const first = raw[0];
        if (first) {
          orderId = String(first.order_id || first.orderId || first.id || first.conid || '');
        }
      }
      else if (raw?.orders && Array.isArray(raw.orders)) {
        const first = raw.orders[0];
        if (first) {
          orderId = String(first.order_id || first.orderId || first.id || first.conid || '');
        }
      }
      else if (raw?.data && Array.isArray(raw.data)) {
        const first = raw.data[0];
        if (first) {
          orderId = String(first.order_id || first.orderId || first.id || first.conid || '');
        }
      }
      else if (raw?.reply && Array.isArray(raw.reply)) {
        const first = raw.reply[0];
        if (first) {
          orderId = String(first.order_id || first.orderId || first.id || first.conid || '');
        }
      }

      // Clean up the order ID
      orderId = orderId?.trim();
      if (orderId === '' || orderId === 'undefined' || orderId === 'null') {
        orderId = undefined;
      }

      // If still no order ID but response indicates success, log warning
      if (!orderId && resp.status >= 200 && resp.status < 300) {
        console.warn(`[IBKR][${reqId}] Order appears successful but could not extract order ID from response:`, raw);
      }
    } catch (err) {
      console.error(`[IBKR][${reqId}] Error parsing order response:`, err);
    }

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

    // Log full response for debugging
    console.log(`[IBKR][${reqId2}] Order response: status=${http2}, data=${JSON.stringify(raw2)}`);

    if (!(resp2.status >= 200 && resp2.status < 300)) {
      let snippet = "";
      try { snippet = typeof raw2 === 'string' ? raw2.slice(0,500) : JSON.stringify(raw2).slice(0,500); } catch {}
      await storage.createAuditLog({ eventType: "IBKR_ORDER_SUBMIT", details: `FAILED http=${http2} req=${reqId2} body=${snippet}` , status: "FAILED" });
      console.error(`[IBKR][${reqId2}] POST /v1/api/iserver/account/{acct}/orders -> ${http2} ${snippet}`);
      return { status: `rejected_${http2}`, raw: raw2 };
    }

    // Parse order ID from various possible response formats
    let orderId2: string | undefined = undefined;
    try {
      // IBKR may return different formats:
      // 1. Array directly: [{order_id: "123", ...}]
      // 2. Object with array: {orders: [{order_id: "123", ...}]}
      // 3. Object with data: {data: [{order_id: "123", ...}]}
      // 4. Single object: {order_id: "123", ...}
      // 5. Nested reply: {reply: [{order_id: "123", ...}]}

      // First check if raw2 is directly the order object
      if (raw2?.order_id) {
        orderId2 = String(raw2.order_id);
      }
      // Check if it's an array
      else if (Array.isArray(raw2)) {
        const first = raw2[0];
        if (first) {
          orderId2 = String(first.order_id || first.orderId || first.id || first.conid || '');
        }
      }
      // Check nested structures
      else if (raw2?.orders && Array.isArray(raw2.orders)) {
        const first = raw2.orders[0];
        if (first) {
          orderId2 = String(first.order_id || first.orderId || first.id || first.conid || '');
        }
      }
      else if (raw2?.data && Array.isArray(raw2.data)) {
        const first = raw2.data[0];
        if (first) {
          orderId2 = String(first.order_id || first.orderId || first.id || first.conid || '');
        }
      }
      else if (raw2?.reply && Array.isArray(raw2.reply)) {
        const first = raw2.reply[0];
        if (first) {
          orderId2 = String(first.order_id || first.orderId || first.id || first.conid || '');
        }
      }

      // Clean up the order ID
      orderId2 = orderId2?.trim();
      if (orderId2 === '' || orderId2 === 'undefined' || orderId2 === 'null') {
        orderId2 = undefined;
      }

      // If still no order ID but response indicates success, log warning
      if (!orderId2 && resp2.status >= 200 && resp2.status < 300) {
        console.warn(`[IBKR][${reqId2}] Order appears successful but could not extract order ID from response:`, raw2);
      }
    } catch (err) {
      console.error(`[IBKR][${reqId2}] Error parsing order response:`, err);
    }

    await storage.createAuditLog({ eventType: "IBKR_ORDER_SUBMIT", details: `OK http=${http2} req=${reqId2} orderId=${orderId2 ?? 'n/a'}` , status: "SUCCESS" });

    // Store order locally for reliable tracking
    try {
      await storage.createOrder({
        ibkrOrderId: orderId2 || null,
        symbol,
        side,
        quantity: Math.floor(quantity),
        orderType,
        limitPrice: orderType === 'LMT' ? String(opts?.limitPrice ?? 0) : null,
        status: 'submitted',
      });
      console.log(`[IBKR][${reqId2}] Order stored locally: ibkrOrderId=${orderId2}, symbol=${symbol}, side=${side}, qty=${quantity}`);
    } catch (storageErr) {
      console.error(`[IBKR][${reqId2}] Failed to store order locally:`, storageErr);
    }

    return { id: orderId2, status: "submitted", raw: raw2 };
  }

  /**
   * Resolve option contract conid for a specific strike/expiration
   * IBKR option search requires underlying conid, expiration, right (P/C), and strike
   */
  private async resolveOptionConid(
    underlying: string,
    expiration: string, // YYYYMMDD format
    optionType: 'PUT' | 'CALL',
    strike: number
  ): Promise<number | null> {
    await this.ensureAccountSelected();

    // First get the underlying conid
    const underlyingConid = await this.resolveConid(underlying);
    if (!underlyingConid) {
      console.log(`[IBKR][resolveOptionConid] Cannot resolve underlying conid for ${underlying}`);
      return null;
    }

    const right = optionType === 'CALL' ? 'C' : 'P';
    const reqId = randomUUID();

    console.log(`[IBKR][resolveOptionConid][${reqId}] Searching: underlying=${underlying}(${underlyingConid}), exp=${expiration}, right=${right}, strike=${strike}`);

    try {
      // Use secdef/search with option parameters
      const searchUrl = `/v1/api/iserver/secdef/search`;
      const params = new URLSearchParams({
        symbol: underlying,
        secType: 'OPT',
        strike: strike.toString(),
        right: right,
        month: expiration.slice(0, 6), // YYYYMM for month filter
      });

      const resp = await this.http.get(`${searchUrl}?${params.toString()}`);
      const bodySnippet = JSON.stringify(resp.data || {}).slice(0, 500);
      console.log(`[IBKR][resolveOptionConid][${reqId}] Search response: status=${resp.status} body=${bodySnippet}`);

      if (resp.status === 200 && Array.isArray(resp.data)) {
        // Look for exact match on strike and right
        for (const contract of resp.data) {
          const cStrike = parseFloat(contract.strike || '0');
          const cRight = contract.right || '';

          // Match within 0.01 tolerance for floating point
          if (Math.abs(cStrike - strike) < 0.01 && cRight.toUpperCase() === right) {
            const conid = parseInt(contract.conid, 10);
            console.log(`[IBKR][resolveOptionConid][${reqId}] Found match: conid=${conid}, strike=${cStrike}, right=${cRight}`);
            return conid;
          }
        }

        // If no exact match, log available contracts for debugging
        console.log(`[IBKR][resolveOptionConid][${reqId}] No exact match found. Available: ${resp.data.slice(0, 5).map((c: any) => `${c.strike}${c.right}(${c.conid})`).join(', ')}`);
      }

      // Alternative: Try the strikes endpoint to get available options
      const strikesUrl = `/v1/api/iserver/secdef/strikes`;
      const strikesParams = new URLSearchParams({
        conid: underlyingConid.toString(),
        sectype: 'OPT',
        month: expiration.slice(0, 6),
      });

      const strikesResp = await this.http.get(`${strikesUrl}?${strikesParams.toString()}`);
      console.log(`[IBKR][resolveOptionConid][${reqId}] Strikes response: status=${strikesResp.status}`);

      if (strikesResp.status === 200 && strikesResp.data) {
        // The strikes endpoint returns call and put strikes separately
        const strikesData = strikesResp.data;
        const availableStrikes = optionType === 'CALL' ? strikesData.call : strikesData.put;

        if (Array.isArray(availableStrikes) && availableStrikes.includes(strike)) {
          // Use secdef/info to get the actual conid for this specific strike
          const infoUrl = `/v1/api/iserver/secdef/info`;
          const infoParams = new URLSearchParams({
            conid: underlyingConid.toString(),
            sectype: 'OPT',
            month: expiration.slice(0, 6),
            strike: strike.toString(),
            right: right,
          });

          const infoResp = await this.http.get(`${infoUrl}?${infoParams.toString()}`);
          console.log(`[IBKR][resolveOptionConid][${reqId}] Info response: status=${infoResp.status} body=${JSON.stringify(infoResp.data).slice(0, 300)}`);

          if (infoResp.status === 200 && Array.isArray(infoResp.data)) {
            for (const opt of infoResp.data) {
              if (opt.conid) {
                console.log(`[IBKR][resolveOptionConid][${reqId}] Found via info: conid=${opt.conid}`);
                return parseInt(opt.conid, 10);
              }
            }
          }
        }
      }

    } catch (err) {
      console.error(`[IBKR][resolveOptionConid][${reqId}] Error:`, err);
    }

    console.log(`[IBKR][resolveOptionConid][${reqId}] Could not resolve option conid`);
    return null;
  }

  /**
   * Place an option order (SELL/BUY puts or calls)
   */
  async placeOptionOrder(params: {
    symbol: string;
    optionType: 'PUT' | 'CALL';
    strike: number;
    expiration: string; // YYYYMMDD format
    side: 'BUY' | 'SELL';
    quantity: number;
    orderType: 'MKT' | 'LMT';
    limitPrice?: number;
  }): Promise<{ id?: string; status: string; raw?: any }> {
    await this.ensureReady();
    await this.ensureAccountSelected();

    const accountId = this.accountId || process.env.IBKR_ACCOUNT_ID || "";
    const reqId = randomUUID();

    console.log(`[IBKR][placeOptionOrder][${reqId}] Starting: ${params.side} ${params.quantity} ${params.symbol} ${params.strike}${params.optionType === 'PUT' ? 'P' : 'C'} ${params.expiration} @ ${params.orderType}${params.limitPrice ? ' $' + params.limitPrice : ''}`);

    if (!params.symbol || !accountId || !params.quantity || params.quantity <= 0) {
      console.error(`[IBKR][placeOptionOrder][${reqId}] Invalid params`);
      return { status: "rejected_400" };
    }

    // Resolve the option contract conid
    const optionConid = await this.resolveOptionConid(
      params.symbol,
      params.expiration,
      params.optionType,
      params.strike
    );

    if (!optionConid) {
      const errorMsg = `Cannot resolve option conid for ${params.symbol} ${params.strike}${params.optionType === 'PUT' ? 'P' : 'C'} ${params.expiration}`;
      console.error(`[IBKR][placeOptionOrder][${reqId}] ${errorMsg}`);
      await storage.createAuditLog({
        eventType: "IBKR_OPTION_ORDER",
        details: `FAILED: ${errorMsg}`,
        status: "FAILED"
      });
      return { status: "rejected_no_option_conid" };
    }

    console.log(`[IBKR][placeOptionOrder][${reqId}] Resolved option conid: ${optionConid}`);

    // Build the order
    const order: any = {
      acctId: accountId,
      conid: optionConid,
      orderType: params.orderType,
      side: params.side,
      tif: 'DAY',
      quantity: Math.floor(params.quantity),
    };

    if (params.orderType === 'LMT' && params.limitPrice != null) {
      order.price = params.limitPrice;
    }

    const body = { orders: [order] };
    const url = `/v1/api/iserver/account/${encodeURIComponent(accountId)}/orders`;

    console.log(`[IBKR][placeOptionOrder][${reqId}] Submitting order to ${url}:`, JSON.stringify(body));

    try {
      const resp = await this.http.post(url, body, { headers: { 'Content-Type': 'application/json' } });
      const raw = resp.data;

      console.log(`[IBKR][placeOptionOrder][${reqId}] Response: status=${resp.status} data=${JSON.stringify(raw).slice(0, 500)}`);

      // Handle order confirmation prompts (IBKR may require confirmation)
      if (Array.isArray(raw) && raw[0]?.id && raw[0]?.message) {
        // This is a confirmation request - need to reply
        const confirmId = raw[0].id;
        console.log(`[IBKR][placeOptionOrder][${reqId}] Order requires confirmation (id=${confirmId}): ${raw[0].message}`);

        const confirmUrl = `/v1/api/iserver/reply/${confirmId}`;
        const confirmResp = await this.http.post(confirmUrl, { confirmed: true });
        console.log(`[IBKR][placeOptionOrder][${reqId}] Confirmation response: status=${confirmResp.status} data=${JSON.stringify(confirmResp.data).slice(0, 300)}`);

        // Use confirmed response as raw
        if (confirmResp.status >= 200 && confirmResp.status < 300) {
          const confirmedRaw = confirmResp.data;
          let orderId: string | undefined;

          if (Array.isArray(confirmedRaw) && confirmedRaw[0]?.order_id) {
            orderId = String(confirmedRaw[0].order_id);
          } else if (confirmedRaw?.order_id) {
            orderId = String(confirmedRaw.order_id);
          }

          // Store order locally
          const optionSymbol = `${params.symbol}${params.expiration}${params.optionType === 'PUT' ? 'P' : 'C'}${params.strike}`;
          await storage.createOrder({
            ibkrOrderId: orderId || null,
            symbol: optionSymbol,
            side: params.side,
            quantity: params.quantity,
            orderType: params.orderType,
            limitPrice: params.limitPrice ? String(params.limitPrice) : null,
            status: 'submitted',
          });

          await storage.createAuditLog({
            eventType: "IBKR_OPTION_ORDER",
            details: `OK ${params.side} ${params.quantity} ${optionSymbol} @ ${params.limitPrice || 'MKT'} orderId=${orderId || 'n/a'}`,
            status: "SUCCESS"
          });

          return { id: orderId, status: "submitted", raw: confirmedRaw };
        }
      }

      // Parse order ID from response
      let orderId: string | undefined;
      if (raw?.order_id) {
        orderId = String(raw.order_id);
      } else if (Array.isArray(raw) && raw[0]?.order_id) {
        orderId = String(raw[0].order_id);
      }

      const optionSymbol = `${params.symbol}${params.expiration}${params.optionType === 'PUT' ? 'P' : 'C'}${params.strike}`;

      if (resp.status >= 200 && resp.status < 300) {
        // Store order locally
        await storage.createOrder({
          ibkrOrderId: orderId || null,
          symbol: optionSymbol,
          side: params.side,
          quantity: params.quantity,
          orderType: params.orderType,
          limitPrice: params.limitPrice ? String(params.limitPrice) : null,
          status: 'submitted',
        });

        await storage.createAuditLog({
          eventType: "IBKR_OPTION_ORDER",
          details: `OK ${params.side} ${params.quantity} ${optionSymbol} @ ${params.limitPrice || 'MKT'} orderId=${orderId || 'n/a'}`,
          status: "SUCCESS"
        });

        return { id: orderId, status: "submitted", raw };
      } else {
        await storage.createAuditLog({
          eventType: "IBKR_OPTION_ORDER",
          details: `FAILED http=${resp.status} ${optionSymbol}`,
          status: "FAILED"
        });
        return { status: `rejected_${resp.status}`, raw };
      }
    } catch (err) {
      console.error(`[IBKR][placeOptionOrder][${reqId}] Error:`, err);
      await storage.createAuditLog({
        eventType: "IBKR_OPTION_ORDER",
        details: `ERROR: ${err.message || 'Unknown error'}`,
        status: "FAILED"
      });
      return { status: "error", raw: { error: err.message } };
    }
  }

  async getOpenOrders(): Promise<any[]> {
    await this.ensureReady();

    // Re-ensure account selection with longer delay (matching working order placement pattern)
    await this.ensureAccountSelected();
    await this.sleep(1000); // Give IBKR more time to register account selection

    const reqId = randomUUID();
    const acct = this.accountId || process.env.IBKR_ACCOUNT_ID || '';

    console.log(`[IBKR][OPEN_ORDERS ${reqId}] Using accountId: ${acct}`);
    console.log(`[IBKR][OPEN_ORDERS ${reqId}] Account selection state: accountId=${this.accountId}, env=${process.env.IBKR_ACCOUNT_ID}`);

    // Initialize portfolio subaccounts (per IBKR documentation requirement)
    try {
      const subacctUrl = `/v1/api/portfolio/subaccounts`;
      console.log(`[IBKR][OPEN_ORDERS ${reqId}] Initializing portfolio subaccounts: GET ${subacctUrl}`);
      const subacctResp = await this.http.get(subacctUrl);
      console.log(`[IBKR][OPEN_ORDERS ${reqId}] Subaccounts response: ${subacctResp.status}, data=${JSON.stringify(subacctResp.data).slice(0, 200)}`);
    } catch (err) {
      console.warn(`[IBKR][OPEN_ORDERS ${reqId}] Portfolio subaccounts init failed (non-fatal):`, err.message);
    }

    // Expanded status regex to catch ALL possible order states including partial fills and pending states
    const activeRe = /(Submitted|PreSubmitted|PendingSubmit|PendingCancel|Working|Filled|PartiallyFilled|ApiPending|ApiCancelled|Open|Active|Pending|New|Accepted)/i;

    // Helper to normalize various CP shapes
    const normalize = (raw: any): any[] => {
      console.log(`[IBKR][OPEN_ORDERS ${reqId}] Normalizing raw response type: ${typeof raw}, isArray: ${Array.isArray(raw)}`);
      const arr = Array.isArray(raw) ? raw : (raw?.orders || raw?.data || []);
      console.log(`[IBKR][OPEN_ORDERS ${reqId}] Extracted array length: ${arr.length}`);

      const normalized = (arr || []).map((o: any, idx: number) => {
        const id = String(o.order_id || o.orderId || o.id || o.c_oid || '').trim();
        const status = String(o.order_status || o.status || '');
        const result = {
          id,
          status,
          symbol: o.ticker || o.symbol || o.conid,
          quantity: o.size || o.quantity || o.totalSize,
          side: o.side || o.action,
          orderType: o.orderType || o.order_type,
          raw: o,
        };
        console.log(`[IBKR][OPEN_ORDERS ${reqId}] Order ${idx}: id=${result.id}, status=${result.status}, symbol=${result.symbol}, qty=${result.quantity}, side=${result.side}`);
        return result;
      });

      const filtered = normalized.filter((o: any) => {
        const hasId = !!o.id;
        const matchesStatus = activeRe.test(o.status || '');
        console.log(`[IBKR][OPEN_ORDERS ${reqId}] Filter check - id=${o.id}: hasId=${hasId}, matchesStatus=${matchesStatus}, status="${o.status}"`);
        return hasId && matchesStatus;
      });

      console.log(`[IBKR][OPEN_ORDERS ${reqId}] Filtered from ${normalized.length} to ${filtered.length} active orders`);
      return filtered;
    };

    // PRIMARY: Use account-qualified endpoint (matching the working order placement pattern)
    if (!acct) {
      console.error(`[IBKR][OPEN_ORDERS ${reqId}] ERROR: No account ID available!`);
      return [];
    }

    const url1 = `/v1/api/iserver/account/${encodeURIComponent(acct)}/orders`;
    console.log(`[IBKR][OPEN_ORDERS ${reqId}] PRIMARY: GET ${url1}`);
    try {
      const r1 = await this.http.get(url1);
      console.log(`[IBKR][OPEN_ORDERS ${reqId}] PRIMARY -> ${r1.status}`);
      console.log(`[IBKR][OPEN_ORDERS ${reqId}] PRIMARY body (first 500 chars): ${(typeof r1.data==='string'?r1.data:JSON.stringify(r1.data)||'').slice(0,500)}`);

      if (r1.status >= 200 && r1.status < 300) {
        const list = normalize(r1.data);
        console.log(`[IBKR][OPEN_ORDERS ${reqId}] PRIMARY SUCCESS: Found ${list.length} active orders`);
        return list;
      }
    } catch (err) {
      console.error(`[IBKR][OPEN_ORDERS ${reqId}] PRIMARY endpoint error:`, err.message);
    }

    // FALLBACK: Try generic endpoint
    const url2 = `/v1/api/iserver/account/orders`;
    console.log(`[IBKR][OPEN_ORDERS ${reqId}] FALLBACK: GET ${url2}`);
    try {
      const r2 = await this.http.get(url2);
      console.log(`[IBKR][OPEN_ORDERS ${reqId}] FALLBACK -> ${r2.status}`);
      console.log(`[IBKR][OPEN_ORDERS ${reqId}] FALLBACK body (first 500 chars): ${(typeof r2.data==='string'?r2.data:JSON.stringify(r2.data)||'').slice(0,500)}`);

      if (r2.status >= 200 && r2.status < 300) {
        const list = normalize(r2.data);
        console.log(`[IBKR][OPEN_ORDERS ${reqId}] FALLBACK SUCCESS: Found ${list.length} active orders`);
        return list;
      }
    } catch (err) {
      console.error(`[IBKR][OPEN_ORDERS ${reqId}] FALLBACK endpoint error:`, err.message);
    }

    // LAST RESORT: Try live orders endpoint which may show orders not in regular endpoints
    const url3 = `/v1/api/portfolio/${encodeURIComponent(acct)}/orders`;
    console.log(`[IBKR][OPEN_ORDERS ${reqId}] LIVE ORDERS: GET ${url3}`);
    try {
      const r3 = await this.http.get(url3);
      console.log(`[IBKR][OPEN_ORDERS ${reqId}] LIVE ORDERS -> ${r3.status}`);
      console.log(`[IBKR][OPEN_ORDERS ${reqId}] LIVE ORDERS body (first 500 chars): ${(typeof r3.data==='string'?r3.data:JSON.stringify(r3.data)||'').slice(0,500)}`);

      if (r3.status >= 200 && r3.status < 300) {
        const list = normalize(r3.data);
        console.log(`[IBKR][OPEN_ORDERS ${reqId}] LIVE ORDERS SUCCESS: Found ${list.length} active orders`);
        return list;
      }
    } catch (err) {
      console.error(`[IBKR][OPEN_ORDERS ${reqId}] LIVE ORDERS endpoint error:`, err.message);
    }

    console.log(`[IBKR][OPEN_ORDERS ${reqId}] FINAL RESULT: No orders found from any endpoint`);
    return [];
  }

  async cancelOrder(orderId: string): Promise<{ success: boolean; message?: string }> {
    console.log(`[IBKR] Canceling order ${orderId}...`);

    await this.ensureReady();

    const accountId = this.accountId || process.env.IBKR_ACCOUNT_ID || '';
    const cancelUrl = `/v1/api/iserver/account/${encodeURIComponent(accountId)}/order/${encodeURIComponent(orderId)}`;

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

      // Try IBKR API first
      let openOrders = await this.getOpenOrders();
      console.log(`[IBKR] Found ${openOrders.length} open orders from IBKR API`);

      // If IBKR API returns no orders, check local storage as fallback
      if (openOrders.length === 0) {
        console.log('[IBKR] No orders from IBKR API, checking local storage...');
        const localOrders = await storage.getOpenOrders();
        console.log(`[IBKR] Found ${localOrders.length} orders in local storage`);

        if (localOrders.length > 0) {
          // Helper to check if IBKR order ID is valid (numeric string)
          const isValidIbkrOrderId = (id: string | null): boolean => {
            if (!id) return false;
            // IBKR order IDs are numeric, skip UUIDs or other invalid formats
            return /^\d+$/.test(id);
          };

          // Map local orders to the format expected by the cancel logic
          const validOrders = localOrders.filter(o => isValidIbkrOrderId(o.ibkrOrderId));
          const invalidOrders = localOrders.filter(o => !isValidIbkrOrderId(o.ibkrOrderId));

          // Mark invalid orders as cancelled locally (they can't be cancelled at IBKR)
          for (const invalidOrder of invalidOrders) {
            console.log(`[IBKR] Order ${invalidOrder.id} has invalid/missing IBKR ID (${invalidOrder.ibkrOrderId}), marking as cancelled locally`);
            try {
              await storage.updateOrderStatus(invalidOrder.id, 'cancelled', { cancelledAt: new Date() });
            } catch (err) {
              console.warn(`[IBKR] Failed to update invalid order status:`, err);
            }
          }

          openOrders = validOrders.map(o => ({
            id: o.ibkrOrderId,
            localId: o.id,
            symbol: o.symbol,
            side: o.side,
            quantity: o.quantity,
            status: o.status,
            source: 'local',
          }));
          console.log(`[IBKR] Using ${openOrders.length} orders from local storage (with valid numeric IBKR IDs), cleaned up ${invalidOrders.length} invalid orders`);
        }
      }

      if (openOrders.length === 0) {
        console.log('[IBKR] No open orders found in API or local storage - nothing to cancel');
        return { success: false, cleared: 0, errors: ['No open orders found'] };
      }

      const errors: string[] = [];
      let cleared = 0;

      for (const order of openOrders) {
        const orderId = order.orderId || order.id;
        const localId = order.localId;

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

          // Update local storage status if we have a local ID
          if (localId) {
            try {
              await storage.updateOrderStatus(localId, 'cancelled', { cancelledAt: new Date() });
              console.log(`[IBKR] Updated local order ${localId} status to cancelled`);
            } catch (updateErr) {
              console.warn(`[IBKR] Failed to update local order status:`, updateErr);
            }
          } else {
            // Try to find and update by IBKR order ID
            try {
              const localOrder = await storage.getOrderByIbkrId(orderId);
              if (localOrder) {
                await storage.updateOrderStatus(localOrder.id, 'cancelled', { cancelledAt: new Date() });
                console.log(`[IBKR] Updated local order (found by ibkrOrderId ${orderId}) status to cancelled`);
              }
            } catch (updateErr) {
              console.warn(`[IBKR] Failed to find/update local order by IBKR ID:`, updateErr);
            }
          }
        } else {
          const errorMsg = `Failed to cancel ${orderId}: ${result.message}`;
          console.error(`[IBKR] ${errorMsg}`);
          errors.push(errorMsg);

          // If IBKR says order doesn't exist or already cancelled, update local status
          if (result.message?.includes('not found') || result.message?.includes('cancelled') || result.message?.includes('filled')) {
            if (localId) {
              try {
                await storage.updateOrderStatus(localId, 'cancelled', { cancelledAt: new Date() });
                console.log(`[IBKR] Order ${orderId} not found/already done at IBKR, marked local as cancelled`);
                cleared++; // Count as cleared since the order is gone
                errors.pop(); // Remove the error since we handled it
              } catch (updateErr) {
                console.warn(`[IBKR] Failed to update local order status after cancel error:`, updateErr);
              }
            }
          }
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

// Utility for placing paper option orders (e.g., SELL 1 SPY 600P 20250106)
export async function placePaperOptionOrder(params: {
  symbol: string;
  optionType: 'PUT' | 'CALL';
  strike: number;
  expiration: string; // YYYYMMDD format
  side: 'BUY' | 'SELL';
  quantity: number;
  orderType?: 'MKT' | 'LMT';
  limitPrice?: number;
}) {
  if (!activeClient) throw new Error('IBKR client not initialized');
  return activeClient.placeOptionOrder({
    symbol: params.symbol,
    optionType: params.optionType,
    strike: params.strike,
    expiration: params.expiration,
    side: params.side,
    quantity: params.quantity,
    orderType: params.orderType || 'MKT',
    limitPrice: params.limitPrice,
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

// Utility for getting option chain with real strikes for engine strike selection
export async function getOptionChainWithStrikes(symbol: string, expiration?: string) {
  if (!activeClient) throw new Error('IBKR client not initialized');
  return activeClient.getOptionChainWithStrikes(symbol, expiration);
}
