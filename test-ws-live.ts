import WebSocket from 'ws';
import { db } from './server/db.js';
import { ibkrCredentials } from './shared/schema.js';
import { decryptToken } from './server/crypto.js';

const WS_URL = 'wss://api.ibkr.com/v1/api/ws';
const SPY_CONID = 756733;

async function main() {
  console.log('Fetching IBKR credentials from database...');

  const [creds] = await db!.select().from(ibkrCredentials).limit(1);

  if (!creds?.cookieJarJson) {
    console.error('No cookies in database!');
    process.exit(1);
  }

  const jar = JSON.parse(creds.cookieJarJson);
  const cookies = jar.cookies || [];
  const cookieStr = cookies.map((c: any) => `${c.key}=${c.value}`).join('; ');
  console.log('Cookie length:', cookieStr.length);

  // Get session token
  let sessionToken: string | null = null;
  if (creds.ssoTokenEncrypted) {
    sessionToken = decryptToken(creds.ssoTokenEncrypted);
    console.log('Session token available:', !!sessionToken);
  }

  // Also check ssoSessionId
  const ssoSessionId = creds.ssoSessionId;
  console.log('SSO Session ID:', ssoSessionId);

  console.log('Connecting to IBKR WebSocket...');

  const ws = new WebSocket(WS_URL, {
    headers: {
      'Cookie': cookieStr,
      'Origin': 'https://api.ibkr.com',
      'User-Agent': 'Mozilla/5.0'
    }
  });

  ws.on('open', () => {
    console.log('✅ WebSocket CONNECTED!');

    // Send session token if available
    if (sessionToken) {
      console.log('📤 Sending session token...');
      ws.send(JSON.stringify({ session: sessionToken }));
    }
  });

  ws.on('message', (data: Buffer) => {
    const msg = data.toString();

    if (msg === 'tic') {
      process.stdout.write('.');
      return;
    }

    console.log('📨 MSG:', msg.slice(0, 300));

    try {
      const parsed = JSON.parse(msg);

      // Check if server is waiting for session
      if (msg.includes('waiting for session')) {
        console.log('Server waiting for session - sending token');
        if (sessionToken) {
          ws.send(JSON.stringify({ session: sessionToken }));
        }
        return;
      }

      // Check for auth success
      if (parsed.authenticated === true || parsed.topic === 'sts') {
        console.log('🔓 Authenticated! Subscribing to SPY...');
        const subMsg = `smd+${SPY_CONID}+{"fields":["31","84","86"]}`;
        ws.send(subMsg);
      }

      // Check for SPY data
      if (parsed['31'] || parsed.conid === SPY_CONID) {
        const price = parsed['31'];
        const bid = parsed['84'];
        const ask = parsed['86'];
        const now = new Date().toLocaleTimeString();
        console.log(`\n💰 [${now}] SPY: $${price} (bid: $${bid}, ask: $${ask})`);
      }
    } catch {
      // Non-JSON message
    }
  });

  ws.on('error', (err) => {
    console.error('❌ WebSocket ERROR:', err.message);
  });

  ws.on('close', (code, reason) => {
    console.log('🔌 WebSocket CLOSED:', code, reason.toString());
    process.exit(0);
  });

  // Keep running for 60 seconds
  setTimeout(() => {
    console.log('\n⏱️ 60 seconds elapsed, closing...');
    ws.close();
  }, 60000);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
