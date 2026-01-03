/**
 * Standalone IBKR OAuth test - no server dependencies
 */
import { config } from 'dotenv';
config();

import { SignJWT, importPKCS8 } from 'jose';
import { randomUUID } from 'crypto';

const BASE_URL = 'https://api.ibkr.com';

async function main() {
  console.log('='.repeat(60));
  console.log('IBKR OAuth Test (Standalone)');
  console.log('='.repeat(60));

  const clientId = process.env.IBKR_CLIENT_ID;
  const keyId = process.env.IBKR_CLIENT_KEY_ID;
  const privateKey = process.env.IBKR_PRIVATE_KEY;
  const credential = process.env.IBKR_CREDENTIAL;
  const allowedIp = process.env.IBKR_ALLOWED_IP;

  console.log('\n[1] Environment Check:');
  console.log(`  IBKR_CLIENT_ID: ${clientId ? '✓' : '✗'}`);
  console.log(`  IBKR_CLIENT_KEY_ID: ${keyId ? '✓' : '✗'}`);
  console.log(`  IBKR_PRIVATE_KEY: ${privateKey ? `✓ (${privateKey.length} chars)` : '✗'}`);
  console.log(`  IBKR_CREDENTIAL: ${credential ? '✓' : '✗'}`);
  console.log(`  IBKR_ALLOWED_IP: ${allowedIp || '(not set - good!)'}`);

  if (!clientId || !keyId || !privateKey || !credential) {
    console.error('\n✗ Missing required env vars');
    process.exit(1);
  }

  // Phase 1: OAuth Token
  console.log('\n[2] OAuth Token Request...');
  const key = await importPKCS8(privateKey, 'RS256');
  const now = Math.floor(Date.now() / 1000);

  const clientAssertion = await new SignJWT({
    iss: clientId,
    sub: clientId,
    aud: `${BASE_URL}/oauth2/api/v1/token`,
    jti: randomUUID(),
    iat: now,
    exp: now + 60,
  })
    .setProtectedHeader({ alg: 'RS256', kid: keyId, typ: 'JWT' })
    .sign(key);

  const scope = process.env.IBKR_SCOPE || 'sso-sessions.write';
  const form = new URLSearchParams({
    grant_type: 'client_credentials',
    scope,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: clientAssertion,
  });

  const oauthResp = await fetch(`${BASE_URL}/oauth2/api/v1/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });

  console.log(`  Status: ${oauthResp.status}`);
  if (!oauthResp.ok) {
    const err = await oauthResp.text();
    console.error(`  Error: ${err.slice(0, 500)}`);
    process.exit(1);
  }

  const oauthData = await oauthResp.json() as { access_token: string; expires_in: number };
  console.log(`  ✓ Token received (expires in ${oauthData.expires_in}s)`);

  // Phase 2: SSO Session
  console.log('\n[3] SSO Session Creation...');
  const ssoClaims: Record<string, any> = {
    credential,
    iss: clientId,
    iat: now,
    exp: now + 86400,
  };
  // Note: NOT adding IP claim since we removed IBKR_ALLOWED_IP
  if (allowedIp) {
    ssoClaims.ip = allowedIp;
    console.log(`  (Adding IP claim: ${allowedIp})`);
  } else {
    console.log('  (No IP restriction - accepting from any origin)');
  }

  const ssoJwt = await new SignJWT(ssoClaims)
    .setProtectedHeader({ alg: 'RS256', kid: keyId, typ: 'JWT' })
    .sign(key);

  const ssoResp = await fetch(`${BASE_URL}/gw/api/v1/sso-sessions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${oauthData.access_token}`,
      'Content-Type': 'application/jwt',
    },
    body: ssoJwt,
  });

  console.log(`  Status: ${ssoResp.status}`);
  const ssoText = await ssoResp.text();

  if (ssoResp.status >= 400) {
    console.error(`  Error: ${ssoText.slice(0, 500)}`);
    process.exit(1);
  }

  let ssoData: any = {};
  try { ssoData = JSON.parse(ssoText); } catch {}
  console.log(`  ✓ Session created`);
  console.log(`  Session ID: ${ssoData.session_id || ssoData.sessionId || 'cookie-based'}`);

  // Wait 3 seconds as required
  console.log('  (Waiting 3s as required by IBKR...)');
  await new Promise(r => setTimeout(r, 3000));

  // Phase 3: Validate
  console.log('\n[4] SSO Validation...');
  const ssoToken = ssoData.access_token || ssoData.token || null;
  const authHeader = ssoToken ? `Bearer ${ssoToken}` : `Bearer ${oauthData.access_token}`;

  // Pass cookies if available (we don't have them in this simple test)
  const validateResp = await fetch(`${BASE_URL}/v1/api/sso/validate`, {
    headers: { 'Authorization': authHeader },
  });

  console.log(`  Status: ${validateResp.status}`);
  const validateData = await validateResp.text();

  if (validateResp.status === 200) {
    console.log(`  ✓ Session validated!`);
    console.log(`  Response: ${validateData.slice(0, 200)}`);
    console.log('\n' + '='.repeat(60));
    console.log('✓ IBKR CONNECTION SUCCESSFUL!');
    console.log('='.repeat(60));
  } else {
    console.log(`  Response: ${validateData.slice(0, 500)}`);
    console.log('\n⚠ Validation returned non-200, but SSO session was created.');
    console.log('The full app uses cookies - this test is simplified.');
  }
}

main().catch(console.error);
