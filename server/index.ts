// @ts-nocheck
// TODO: Fix spread argument in res.json call
// NOTE: dotenv is loaded via bootstrap.ts before this file is imported
import express, { type Request, type Response, type NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic, log } from "./utils"; // Production-safe utilities
import { testDatabaseConnection, pool, db } from "./db";
import { startFiveMinuteCapture } from "./services/jobs/fiveMinuteDataCapture";
import { autoStartMarketDataStream } from "./services/marketDataAutoStart";
import { startAutonomousAgent } from "./agent/scheduler";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined;

  const originalResJson = res.json.bind(res);
  (res as any).json = function (bodyJson: any, ...args: any[]) {
    capturedJsonResponse = bodyJson;
    return originalResJson(bodyJson, ...args);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      if (logLine.length > 80) logLine = logLine.slice(0, 79) + "…";
      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  // Test database connection on startup
  await testDatabaseConnection();

  // Global error handler - catch unhandled errors with friendly messages
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    // Log the full error for debugging
    console.error('[API] Unhandled error:', err.message || err);

    // Handle timeout errors specifically
    if (err.message?.includes('timeout') || err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT') {
      return res.status(504).json({
        error: 'Request timed out',
        message: 'The request took too long. Please try again.',
      });
    }

    // Handle database connection errors
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.message?.includes('ECONNRESET')) {
      return res.status(503).json({
        error: 'Service temporarily unavailable',
        message: 'Unable to connect to database. Please try again.',
      });
    }

    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({
      error: status >= 500 ? 'Internal server error' : 'Request failed',
      message: status >= 500 ? 'Something went wrong. Please try again.' : message,
    });
  });

  // Dev only: load Vite at runtime so it is NOT required in production
  if (app.get("env") === "development") {
    const { setupVite } = await import("./vite");
    await setupVite(app, server);
  } else {
    // Hard redirect any onboarding route to /trade to avoid black-screen flow
    // while we move IBKR setup to Settings
    // Express 5 (path-to-regexp v8): use a RegExp for wildcard redirect
    app.get(/^\/onboarding(?:\/.*)?$/, (_req, res) => {
      res.redirect(302, "/trade");
    });
    serveStatic(app);
  }

  const port = Number(process.env.PORT ?? 8080); // Cloud Run sets PORT
  // Health check endpoint - verifies database connectivity
  app.get("/_health", async (_req, res) => {
    try {
      let dbHealthy = false;
      if (pool) {
        // Quick connectivity check with short timeout
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();
        dbHealthy = true;
      }
      res.status(200).json({
        status: 'healthy',
        db: dbHealthy,
        dbConfigured: !!db,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error('[Health] Database check failed:', err.message);
      res.status(503).json({
        status: 'unhealthy',
        db: false,
        dbConfigured: !!db,
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  });

  server.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);

    // Start the 5-minute option data capture scheduler
    startFiveMinuteCapture();

    // Auto-start IBKR WebSocket for market data streaming
    // Delay slightly to allow database connection to stabilize
    setTimeout(() => {
      autoStartMarketDataStream().catch(err => {
        console.error('[Startup] Market data auto-start failed:', err.message);
      });
    }, 3000);

    // Start autonomous agent scheduler if enabled
    if (process.env.ENABLE_AUTONOMOUS_AGENT === 'true') {
      setTimeout(() => {
        startAutonomousAgent();
        console.log('[Startup] APE Agent autonomous scheduler started');
      }, 5000);
    }
  });
})();
