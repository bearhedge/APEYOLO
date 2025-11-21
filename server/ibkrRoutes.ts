/**
 * IBKR Trading Strategy Routes
 * Handles naked option selling and other trading strategies
 */

import { Request, Response, Router } from 'express';
import { NakedOptionStrategy } from './strategies/nakedOptions';
import { getBroker } from './broker';
import { getIbkrDiagnostics, ensureIbkrReady } from './broker/ibkr';

const router = Router();

// Initialize strategy instance
let nakedOptionStrategy: NakedOptionStrategy | null = null;

// Commenting out /status endpoint - this conflicts with the one in routes.ts
// The correct /api/ibkr/status endpoint is defined in routes.ts which properly
// checks for JWT-based OAuth credentials (IBKR_CLIENT_ID, IBKR_PRIVATE_KEY, etc.)
// rather than the client secret approach checked here.
//
// /**
//  * Get IBKR connection status
//  */
// router.get('/status', async (req: Request, res: Response) => {
//   try {
//     const brokerBundle = getBroker();
//     const isConnected = brokerBundle.status.connected;
//     const diagnostics = await getIbkrDiagnostics();
//
//     // Get configuration status
//     const configured = !!(
//       process.env.IBKR_CLIENT_ID &&
//       process.env.IBKR_CLIENT_SECRET &&
//       process.env.IBKR_REDIRECT_URI
//     );
//
//     // Check all 4 authentication steps - only show connected when ALL succeed
//     const allStepsConnected =
//       diagnostics.oauth.status === 200 &&
//       diagnostics.sso.status === 200 &&
//       diagnostics.validate.status === 200 &&
//       diagnostics.init.status === 200;
//
//     res.json({
//       configured,
//       connected: allStepsConnected,  // Only true when ALL 4 steps succeed
//       environment: process.env.IBKR_ENVIRONMENT || 'paper',
//       accountId: process.env.IBKR_ACCOUNT_ID || null,
//       clientId: process.env.IBKR_CLIENT_ID ? process.env.IBKR_CLIENT_ID.substring(0, 12) + '-***' : null,
//       multiUserMode: process.env.IBKR_MULTI_USER === 'true',
//       diagnostics: {
//         oauth: {
//           status: diagnostics.oauth.status,
//           message: diagnostics.oauth.message,
//           success: diagnostics.oauth.status === 200
//         },
//         sso: {
//           status: diagnostics.sso.status,
//           message: diagnostics.sso.message,
//           success: diagnostics.sso.status === 200
//         },
//         validate: {
//           status: diagnostics.validate.status,
//           message: diagnostics.validate.message,
//           success: diagnostics.validate.status === 200
//         },
//         init: {
//           status: diagnostics.init.status,
//           message: diagnostics.init.message,
//           success: diagnostics.init.status === 200
//         }
//       }
//     });
//   } catch (error) {
//     console.error('[IBKR][Status] Error:', error);
//     res.status(500).json({
//       configured: false,
//       connected: false,
//       error: error instanceof Error ? error.message : 'Unknown error'
//     });
//   }
// });

// The /test endpoint has been moved to routes.ts as /api/ibkr/test
// to avoid duplication and ensure consistent authentication flow.
// Use the endpoint at /api/ibkr/test instead.

/**
 * Test IBKR connection (deprecated - use /api/ibkr/test in routes.ts)
 */
router.post('/test-deprecated', async (req: Request, res: Response) => {
  try {
    const diagnostics = await ensureIbkrReady();

    // Check if all 4 steps succeeded
    const allStepsSuccessful =
      diagnostics.oauth.status === 200 &&
      diagnostics.sso.status === 200 &&
      diagnostics.validate.status === 200 &&
      diagnostics.init.status === 200;

    if (allStepsSuccessful) {
      res.json({
        success: true,
        message: 'IBKR connection successful! Ready to trade.',
        steps: {
          oauth: diagnostics.oauth,
          sso: diagnostics.sso,
          validate: diagnostics.validate,
          init: diagnostics.init
        }
      });
    } else {
      // Find which step failed
      let failedStep = '';
      if (diagnostics.oauth.status !== 200) failedStep = 'OAuth';
      else if (diagnostics.sso.status !== 200) failedStep = 'SSO';
      else if (diagnostics.validate.status !== 200) failedStep = 'Validation';
      else if (diagnostics.init.status !== 200) failedStep = 'Initialization';

      res.status(400).json({
        success: false,
        message: failedStep ? `${failedStep} failed` : 'Connection failed',
        steps: {
          oauth: diagnostics.oauth,
          sso: diagnostics.sso,
          validate: diagnostics.validate,
          init: diagnostics.init
        }
      });
    }
  } catch (error) {
    console.error('[IBKR][Test] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Initialize naked option strategy
 */
router.post('/strategy/init', async (req: Request, res: Response) => {
  try {
    const brokerBundle = getBroker();

    if (!brokerBundle.status.connected) {
      return res.status(400).json({
        success: false,
        error: 'IBKR not connected. Please connect first.'
      });
    }

    // Initialize strategy if not already done
    if (!nakedOptionStrategy) {
      nakedOptionStrategy = new NakedOptionStrategy(brokerBundle.api);
      // Initialize with actual account data
      await nakedOptionStrategy.initialize();
    }

    // Get status with actual values
    const status = await nakedOptionStrategy.getStatus();

    res.json({
      success: true,
      message: 'Naked option strategy initialized with actual NAV',
      config: {
        capital: status.config.capital,
        buyingPower: status.config.buyingPower,
        maxDelta: status.config.maxDelta,
        maxContractsPerSide: status.config.maxContractsPerSide,
        optionsMarginMultiplier: status.config.optionsMarginMultiplier,
        tradingHours: '12:00-14:00 HK',
        tradingMode: '0DTE'
      }
    });
  } catch (error) {
    console.error('[Strategy][Init] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Execute naked option strategy
 */
router.post('/strategy/execute', async (req: Request, res: Response) => {
  try {
    if (!nakedOptionStrategy) {
      return res.status(400).json({
        success: false,
        error: 'Strategy not initialized. Please initialize first.'
      });
    }

    const { symbol = 'SPY' } = req.body;

    // Execute the strategy
    await nakedOptionStrategy.execute(symbol);

    res.json({
      success: true,
      message: `Naked option strategy executed for ${symbol}`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Strategy][Execute] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get strategy status
 */
router.get('/strategy/status', async (req: Request, res: Response) => {
  try {
    if (!nakedOptionStrategy) {
      return res.status(400).json({
        success: false,
        error: 'Strategy not initialized',
        status: null
      });
    }

    const status = await nakedOptionStrategy.getStatus();

    res.json({
      success: true,
      status
    });
  } catch (error) {
    console.error('[Strategy][Status] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Stop strategy execution
 */
router.post('/strategy/stop', async (req: Request, res: Response) => {
  try {
    if (!nakedOptionStrategy) {
      return res.status(400).json({
        success: false,
        error: 'Strategy not initialized'
      });
    }

    // Reset strategy instance
    nakedOptionStrategy = null;

    res.json({
      success: true,
      message: 'Strategy stopped successfully'
    });
  } catch (error) {
    console.error('[Strategy][Stop] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;