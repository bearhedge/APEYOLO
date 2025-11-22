/**
 * Test IBKR OAuth 2.0 (private_key_jwt) token exchange.
 *
 * Reads env vars, builds RS256 JWT with kid and ip claim, posts to
 * ${IBKR_BASE_URL}/oauth2/api/v1/token, and prints status + JSON.
 */

import 'dotenv/config';
import jwt from 'jsonwebtoken';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Missing required env: ${name}`);
  }
  return v;
}

async function main() {
  const CLIENT_ID = requireEnv('IBKR_CLIENT_ID');
  const CLIENT_KEY_ID = requireEnv('IBKR_CLIENT_KEY_ID');
  const CREDENTIAL = requireEnv('IBKR_CREDENTIAL');
  const PRIVATE_KEY = requireEnv('IBKR_PRIVATE_KEY'); // PKCS#8 PEM (multiline)
  const ALLOWED_IP = requireEnv('IBKR_ALLOWED_IP');
  const BASE_URL = requireEnv('IBKR_BASE_URL');

  const aud = `${BASE_URL.replace(/\/$/, '')}/oauth2/api/v1/token`;

  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, any> = {
    iss: CLIENT_ID,
    sub: CREDENTIAL,
    aud,
    iat: now,
    exp: now + 60,
    jti: `${now}-${Math.random().toString(36).slice(2)}`,
    ip: ALLOWED_IP,
  };

  const token = jwt.sign(payload, PRIVATE_KEY, {
    algorithm: 'RS256',
    header: { alg: 'RS256', kid: CLIENT_KEY_ID, typ: 'JWT' },
  });

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: token,
  });

  const url = aud;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  let data: any = null;
  let text = '';
  try {
    data = await res.json();
  } catch {
    try { text = await res.text(); } catch {}
  }

  // Print status and response (JSON if possible, else text)
  console.log(`Status: ${res.status} ${res.statusText}`);
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(text);
  }
}

main().catch((err) => {
  console.error('Error:', err?.message || err);
  process.exit(1);
});

/*
Run:
  tsx test_ibkr_auth.ts

Ensure env vars are set before running (example):
  export IBKR_CLIENT_ID=...
  export IBKR_CLIENT_KEY_ID=...
  export IBKR_CREDENTIAL=...
  export IBKR_ALLOWED_IP=...
  export IBKR_BASE_URL=https://api.ibkr.com
  export IBKR_PRIVATE_KEY="$(cat << 'EOF'
  -----BEGIN PRIVATE KEY-----
  ...
  -----END PRIVATE KEY-----
  EOF
  )"
*/

