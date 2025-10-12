import 'dotenv/config';
import { SignJWT, importPKCS8, decodeJwt, decodeProtectedHeader } from 'jose';
import { v4 as uuidv4 } from 'uuid';

async function main() {
  const baseUrl = (process.env.IBKR_BASE_URL || 'https://api.ibkr.com').replace(/\/$/, '');
  const tokenUrl = `${baseUrl}/oauth2/api/v1/token`;
  const ssoUrl = `${baseUrl}/gw/api/v1/sso-sessions`;

  const clientId = process.env.IBKR_CLIENT_ID!;
  const kid = process.env.IBKR_CLIENT_KEY_ID!;
  const privateKeyPem = process.env.IBKR_PRIVATE_KEY!;
  const scope = process.env.IBKR_SCOPE || 'sso-sessions.write';

  // 1) OAuth2: client_credentials with private_key_jwt assertion
  const now = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(privateKeyPem, 'RS256');
  const jwt = await new SignJWT({
    iss: clientId,
    sub: clientId,
    aud: tokenUrl,
    jti: uuidv4(),
    iat: now,
    exp: now + 60,
  })
    .setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' })
    .sign(key);

  const form = new URLSearchParams({
    grant_type: 'client_credentials',
    scope,
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: jwt,
  });
  console.log('[TEST][OAuth][requestKeys]', Array.from(form.keys()));

  const oauthRes = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const oauthText = await oauthRes.text();
  let oauthJson: any = undefined;
  try { oauthJson = JSON.parse(oauthText); } catch {}
  console.log(`[TEST][OAuth] ${oauthRes.status} ${oauthText.slice(0, 300)}`);
  if (!oauthRes.ok) process.exit(1);
  const accessToken = oauthJson.access_token as string;

  // 2) SSO: application/jwt body (strict minimal format from Authentication.txt)
  const credential = process.env.IBKR_CREDENTIAL!; // paper username
  const ip = process.env.IBKR_ALLOWED_IP;
  const claims: Record<string, any> = {
    credential,
    iss: clientId,
    iat: now,
    exp: now + 86400,
  };
  if (ip) claims.ip = ip;
  const jwtSso = await new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' })
    .sign(key);

  // Log decoded header/payload (safe)
  try {
    console.log('[TEST][SSO JWT header]', decodeProtectedHeader(jwtSso));
    console.log('[TEST][SSO JWT payload]', decodeJwt(jwtSso));
  } catch {}

  const res = await fetch(ssoUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/jwt' },
    body: jwtSso,
  });
  const txt = await res.text();
  console.log(`[TEST][SSO] ${res.status} ${txt.slice(0, 200)}`);
  if (!res.ok) process.exit(1);
}

main().catch((e) => {
  console.error('Error:', e?.message || e);
  process.exit(1);
});
