/**
 * Test IBKR authentication step by step
 * Run with: npx tsx scripts/test-ibkr-auth.ts
 */

import { config } from 'dotenv';
config();

import axios from 'axios';
import crypto from 'crypto';

const IBKR_BASE = 'https://api.ibkr.com';

async function main() {
  console.log('='.repeat(60));
  console.log('IBKR Authentication Test');
  console.log('='.repeat(60));

  // Check env vars
  const clientId = process.env.IBKR_CLIENT_ID;
  const keyId = process.env.IBKR_CLIENT_KEY_ID;
  const privateKey = process.env.IBKR_PRIVATE_KEY;
  const credential = process.env.IBKR_CREDENTIAL;

  console.log('\n[1] Checking environment variables...');
  console.log(`  IBKR_CLIENT_ID: ${clientId ? '✓ set' : '✗ MISSING'}`);
  console.log(`  IBKR_CLIENT_KEY_ID: ${keyId ? '✓ set' : '✗ MISSING'}`);
  console.log(`  IBKR_PRIVATE_KEY: ${privateKey ? `✓ set (${privateKey.length} chars)` : '✗ MISSING'}`);
  console.log(`  IBKR_CREDENTIAL: ${credential ? '✓ set' : '✗ MISSING'}`);
  console.log(`  IBKR_ACCOUNT_ID: ${process.env.IBKR_ACCOUNT_ID || 'not set'}`);

  if (!clientId || !keyId || !privateKey || !credential) {
    console.error('\n✗ Missing required environment variables');
    process.exit(1);
  }

  // Step 1: OAuth token
  console.log('\n[2] Getting OAuth token...');
  try {
    // Build JWT assertion
    const header = { alg: 'RS256', typ: 'JWT', kid: keyId };
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: clientId,
      sub: credential,
      aud: 'https://oauth.ibkr.com/oauth2/token',
      iat: now,
      exp: now + 300,
    };

    const b64url = (obj: any) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const unsigned = `${b64url(header)}.${b64url(payload)}`;

    // Handle both PEM and raw key formats
    let keyForSign = privateKey;
    if (!privateKey.includes('-----BEGIN')) {
      keyForSign = `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`;
    }

    const sig = crypto.sign('sha256', Buffer.from(unsigned), {
      key: keyForSign,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    }).toString('base64url');

    const jwt = `${unsigned}.${sig}`;

    const oauthRes = await axios.post(
      `${IBKR_BASE}/oauth2/oauth2/token`,
      new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'profile',
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: jwt,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    console.log(`  Status: ${oauthRes.status}`);
    const oauthToken = oauthRes.data?.access_token;
    console.log(`  Token: ${oauthToken ? oauthToken.slice(0, 30) + '...' : 'NONE'}`);

    if (!oauthToken) {
      console.error('✗ No OAuth token received');
      process.exit(1);
    }

    // Step 2: SSO session
    console.log('\n[3] Creating SSO session...');
    const ssoRes = await axios.post(
      `${IBKR_BASE}/sso/api/oauth2/relogin`,
      { credential },
      {
        headers: {
          'Authorization': `Bearer ${oauthToken}`,
          'Content-Type': 'application/json',
        },
        withCredentials: true,
      }
    );

    console.log(`  Status: ${ssoRes.status}`);
    const ssoToken = ssoRes.data?.access_token;
    console.log(`  SSO Token: ${ssoToken ? ssoToken.slice(0, 30) + '...' : 'NONE'}`);

    // Step 3: Validate
    console.log('\n[4] Validating session...');
    const validateRes = await axios.get(
      `${IBKR_BASE}/v1/api/sso/validate`,
      {
        headers: {
          'Authorization': `Bearer ${ssoToken || oauthToken}`,
        },
        validateStatus: () => true,
      }
    );

    console.log(`  Status: ${validateRes.status}`);
    console.log(`  Body: ${JSON.stringify(validateRes.data).slice(0, 200)}`);

    if (validateRes.status === 200) {
      console.log('\n✓ Authentication successful!');

      // Try to get account
      console.log('\n[5] Testing account endpoint...');
      const accountId = process.env.IBKR_ACCOUNT_ID;
      if (accountId) {
        const accountRes = await axios.get(
          `${IBKR_BASE}/v1/api/portfolio/${accountId}/summary`,
          {
            headers: { 'Authorization': `Bearer ${ssoToken || oauthToken}` },
            validateStatus: () => true,
          }
        );
        console.log(`  Status: ${accountRes.status}`);
        console.log(`  Body: ${JSON.stringify(accountRes.data).slice(0, 300)}`);
      }
    } else {
      console.log(`\n✗ Validate failed with ${validateRes.status}`);
      console.log('  This means IBKR is rejecting the session');
      console.log('\n  Possible fixes:');
      console.log('  1. Check if credentials are correct in IBKR portal');
      console.log('  2. Regenerate API keys in IBKR');
      console.log('  3. Check if IP is whitelisted');
    }

  } catch (err: any) {
    console.error(`\n✗ Error: ${err.message}`);
    if (err.response) {
      console.error(`  Status: ${err.response.status}`);
      console.error(`  Body: ${JSON.stringify(err.response.data)}`);
    }
  }

  console.log('\n' + '='.repeat(60));
}

main();
