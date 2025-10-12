import { createPrivateKey } from 'crypto';
import * as jose from 'jose';
import fetch from 'node-fetch';
import { v4 as uuid } from 'uuid';

const env = (k: string, req = true) => {
  const v = process.env[k];
  if (req && !v) throw new Error(`Missing env ${k}`);
  return v || '';
};

const BASE = env('IBKR_BASE_URL').replace(/\/+$/, '');
const CLIENT_ID = env('IBKR_CLIENT_ID');
const CLIENT_KEY_ID = env('IBKR_CLIENT_KEY_ID');
const PEM = env('IBKR_PRIVATE_KEY');
const CRED = env('IBKR_CREDENTIAL');
const PW = process.env.IBKR_PASSWORD || '';
const SCOPE = process.env.IBKR_SCOPE || 'sso-sessions.write';

const TOKEN_URL = `${BASE}/oauth2/api/v1/token`;
const SSO_URL = `${BASE}/gw/api/v1/sso-sessions`;

(async () => {
  // OAuth (private_key_jwt)
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new jose.SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: CLIENT_KEY_ID, typ: 'JWT' })
    .setIssuer(CLIENT_ID)
    .setSubject(CLIENT_ID)
    .setAudience(TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 60)
    .setJti(uuid())
    .sign(createPrivateKey(PEM));

  const form = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: SCOPE,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: assertion,
  });

  const tok = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const tj = await tok.json();
  console.log('[CHECK][OAuth]', tok.status, tj.error || 'OK');

  const h = {
    Authorization: `Bearer ${tj.access_token}`,
    'Content-Type': 'application/json',
  };

  // Legacy A: { credential }
  let r = await fetch(SSO_URL, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ credential: CRED }),
  });
  let t = await r.text();
  console.log('[CHECK][SSO legacy A]', r.status, t.slice(0, 200));

  // Legacy B: { username/password } only if A failed and password is provided
  if (!r.ok && PW) {
    r = await fetch(SSO_URL, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({
        username: CRED,
        password: PW,
        authType: 'IB_KEY',
        ssoType: 'CLIENT_CREDENTIALS',
      }),
    });
    t = await r.text();
    console.log('[CHECK][SSO legacy B]', r.status, t.slice(0, 200));
  }
})().catch((e) => console.error(e?.stack || e?.message || e));
