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
import { storage } from "../storage";

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
  private sessionReady = false;
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
    if (this.ssoSessionId) return;
    const r = await createSsoSession(this.baseUrl, token);
    this.last.sso = { status: r.status, ts: new Date().toISOString(), requestId: r.reqId };
    if (!r.ok) {
      await storage.createAuditLog({ eventType: "IBKR_SSO_SESSION", details: `FAILED http=${r.status} req=${r.reqId}`, status: "FAILED" });
      throw new Error(`IBKR SSO session failed: ${r.status}`);
    }
    // Capture both session id and SSO bearer if present
    const body: any = r.body ?? {};
    this.ssoSessionId = body?.session_id || "ok";
    this.ssoAccessToken = body?.access_token || null;
    await storage.createAuditLog({ eventType: "IBKR_SSO_SESSION", details: `OK http=${r.status} req=${r.reqId}`, status: "SUCCESS" });
    // Delay 3s after successful SSO per requirement
    await this.sleep(3000);
  }

  private async validateSso(): Promise<number> {
    if (!this.ssoAccessToken) throw new Error("IBKR SSO token missing");
    const r = await this.http.get('/v1/api/sso/validate', { headers: this.authHeaders() });
    const text = typeof r.data === 'string' ? r.data : JSON.stringify(r.data || {});
    const snippet = text.slice(0, 200);
    const traceVal = (r.headers as any)['traceid'] || (r.headers as any)['x-traceid'] || (r.headers as any)['x-request-id'] || (r.headers as any)['x-correlation-id'];
    this.last.validate = { status: r.status, ts: new Date().toISOString(), requestId: traceVal };
    console.log(`[IBKR][VALIDATE] status=${r.status} traceId=${traceVal ?? ''} body=${snippet}`);
    if (r.status >= 200 && r.status < 300) {
      await storage.createAuditLog({ eventType: "IBKR_SSO_VALIDATE", details: `OK http=${r.status} req=${traceVal ?? ''}`, status: "SUCCESS" });
    } else {
      await storage.createAuditLog({ eventType: "IBKR_SSO_VALIDATE", details: `FAILED http=${r.status} req=${traceVal ?? ''} body=${snippet}`, status: "FAILED" });
    }
    return r.status;
  }

  private async tickle(): Promise<number> {
    if (!this.ssoAccessToken) throw new Error("IBKR SSO token missing");
    const r = await this.http.get('/v1/api/tickle', { headers: this.authHeaders() });
    const traceVal = (r.headers as any)['traceid'] || (r.headers as any)['x-traceid'] || (r.headers as any)['x-request-id'] || (r.headers as any)['x-correlation-id'];
    console.log(`[IBKR][TICKLE] status=${r.status} traceId=${traceVal ?? ''}`);
    return r.status;
  }

  private async initBrokerageWithSso(): Promise<void> {
    if (this.sessionReady) return;
    if (!this.ssoAccessToken) throw new Error("IBKR SSO token missing");
    const doInit = async () => {
      const r = await this.http.post(
        '/v1/api/iserver/auth/ssodh/init',
        { publish: true, compete: true },
        { headers: { ...this.authHeaders(), 'Content-Type': 'application/json' } }
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
    if (res.status === 500 && /failed to generate sso dh token/i.test(bodyStr1)) {
      // Wait, tickle, and retry once
      await this.sleep(3000);
      await this.tickle();
      res = await doInit();
    }
    if (!(res.status >= 200 && res.status < 300)) {
      throw new Error(`IBKR init failed: ${res.status}`);
    }
    this.sessionReady = true;
  }

  private async ensureReady(retry = true): Promise<void> {
    try {
      // Short-circuit if we appear ready
      if (this.ssoAccessToken && this.last.validate.status === 200 && this.last.init.status === 200 && this.sessionReady) {
        return;
      }

      const oauth = await this.getOAuthToken();
      await this.createSSOSession(oauth);
      // After SSO, a 3s delay is already applied in createSSOSession()

      // Validate (idempotent), handle 401/403 once by resetting and retrying flow
      const v = await this.validateSso();
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
      return;
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (retry && (msg.includes("401") || msg.includes("403"))) {
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
    const accountId = this.accountId || process.env.IBKR_ACCOUNT_ID || "";
    try {
      const resp = await this.http.get(`/v1/api/portfolio/${encodeURIComponent(accountId)}/summary`, { headers: this.authHeaders() });
      if (resp.status !== 200) throw new Error(`status ${resp.status}`);
      const data = resp.data as any;
      const info: AccountInfo = {
        accountNumber: accountId || "",
        buyingPower: Number(data?.availablefunds || 0),
        portfolioValue: Number(data?.equitywithloanvalue || 0),
        netDelta: Number(data?.netdelta || 0),
        dayPnL: Number(data?.daytradesremaining || 0),
        marginUsed: Number(data?.initialmargin || 0),
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
    const accountId = this.accountId || process.env.IBKR_ACCOUNT_ID || "";
    try {
      const resp = await this.http.get(`/v1/api/portfolio/${encodeURIComponent(accountId)}/positions`, { headers: this.authHeaders() });
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

  private async resolveConid(symbol: string): Promise<number | null> {
    const url = `/v1/api/iserver/secdef/search`;
    const resp = await this.http.get(`${url}?symbol=${encodeURIComponent(symbol)}&name=${encodeURIComponent(symbol)}&secType=STK`, { headers: this.authHeaders() });
    if (resp.status !== 200) return null;
    const arr = (resp.data as any[]) || [];
    const first = arr?.[0];
    return typeof first?.conid === "number" ? first.conid : null;
  }

  async getOptionChain(symbol: string, expiration?: string): Promise<OptionChainData> {
    await this.ensureReady();
    // Try to resolve underlying price via snapshot; fall back to 0
    let underlyingPrice = 0;
    try {
      const conid = await this.resolveConid(symbol);
      if (conid) {
        const snap = await this.http.get(`/v1/api/iserver/marketdata/snapshot?conids=${conid}`, { headers: this.authHeaders() });
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
    const resp = await this.http.post(url, body, { headers: { ...this.authHeaders(), 'Content-Type': 'application/json' } });

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

  async placeStockOrder(
    symbol: string,
    side: 'BUY' | 'SELL',
    quantity: number,
    opts?: { orderType?: 'MKT'|'LMT'; limitPrice?: number; tif?: 'DAY'|'GTC'; outsideRth?: boolean }
  ): Promise<{ id?: string; status: string; raw?: any }> {
    await this.ensureReady();
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
    const resp2 = await this.http.post(url2, body, { headers: { ...this.authHeaders(), 'Content-Type': 'application/json' } });
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
      orderId2 = String(first?.id || first?.orderId || first?.c_oid || "").trim() || undefined;
    } catch {}
    await storage.createAuditLog({ eventType: "IBKR_ORDER_SUBMIT", details: `OK http=${http2} req=${reqId2} orderId=${orderId2 ?? 'n/a'}` , status: "SUCCESS" });
    return { id: orderId2, status: "submitted", raw: raw2 };
  }

  async getOpenOrders(): Promise<any[]> {
    await this.ensureReady();
    // Attempt standard open orders endpoint
    const ordersUrl = `/v1/api/iserver/account/orders`;
    const reqId3 = randomUUID();
    const resp3 = await this.http.get(ordersUrl, { headers: this.authHeaders() });
    const http3 = resp3.status;
    if (!(resp3.status >= 200 && resp3.status < 300)) {
      let snippet = "";
      try { snippet = (typeof resp3.data === 'string' ? resp3.data : JSON.stringify(resp3.data || {})).slice(0,200); } catch {}
      console.error(`[IBKR][${reqId3}] GET /v1/api/iserver/account/orders -> ${http3} ${snippet}`);
      return [];
    }
    try {
      const data = resp3.data;
      const list = Array.isArray(data) ? data : (data?.orders || data?.data || []);
      return list;
    } catch {
      return [];
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
