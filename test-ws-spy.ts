/**
 * Test WebSocket connection to IBKR to get SPY price
 * Uses the broker provider to get credentials
 */

import WebSocket from 'ws';
import { createIbkrProvider } from './server/broker/ibkr';

const SPY_CONID = 756733;
const VIX_CONID = 13455763;

async function main() {
  console.log('Initializing IBKR...');

  // Create IBKR provider
  const ibkr = createIbkrProvider({
    baseUrl: process.env.IBKR_BASE_URL || 'https://api.ibkr.com',
    clientId: process.env.IBKR_CLIENT_ID || '',
    clientKeyId: process.env.IBKR_CLIENT_KEY_ID || '',
    privateKeyPem: process.env.IBKR_PRIVATE_KEY || '',
    credential: process.env.IBKR_CREDENTIAL || '',
  });

  try {
    // Initialize
    const initResult = await ibkr.initialize();
    console.log('IBKR initialized:', initResult.connected);

    if (!initResult.connected) {
      console.error('IBKR not connected');
      process.exit(1);
    }

    // Get account to verify connection
    const account = await ibkr.getAccountInfo();
    console.log('Account:', account?.cashBalance ? `$${account.cashBalance}` : 'N/A');

    // Get WebSocket credentials from the global state
    const { getIbkrWebSocketManager } = await import('./server/broker/ibkrWebSocket');
    const wsManager = getIbkrWebSocketManager();

    if (wsManager) {
      console.log('WebSocket manager exists');
      console.log('WS Connected:', wsManager.connected);

      // Subscribe to SPY
      wsManager.subscribe(SPY_CONID, { symbol: 'SPY', type: 'stock' });
      wsManager.subscribe(VIX_CONID, { symbol: 'VIX', type: 'stock' });

      // Listen for updates
      wsManager.onUpdate((update) => {
        if (update.conid === SPY_CONID && update.last) {
          console.log(`\n>>> SPY PRICE: $${update.last} <<<\n`);
        } else if (update.conid === VIX_CONID && update.last) {
          console.log(`>>> VIX: ${update.last}`);
        }
      });

      // Check cached data
      setTimeout(() => {
        const spyData = wsManager.getCachedMarketData(SPY_CONID);
        const vixData = wsManager.getCachedMarketData(VIX_CONID);
        console.log('Cached SPY:', spyData?.last || 'none');
        console.log('Cached VIX:', vixData?.last || 'none');
      }, 3000);

      // Exit after 15 seconds
      setTimeout(() => {
        console.log('Done');
        process.exit(0);
      }, 15000);
    } else {
      console.error('No WebSocket manager - need to connect first');
      process.exit(1);
    }

  } catch (err: any) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
