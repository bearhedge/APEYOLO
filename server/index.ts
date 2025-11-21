import express, { type Request, type Response, type NextFunction } from "express";
// Only load .env file in development
if (process.env.NODE_ENV !== 'production') {
  await import('dotenv').then(module => module.config());
}
import { registerRoutes } from "./routes";
import { serveStatic, log } from "./utils"; // Production-safe utilities

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

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    throw err;
  });

  // Dev only: load Vite at runtime so it is NOT required in production
  if (app.get("env") === "development") {
    const { setupVite } = await import("./vite");
    await setupVite(app, server);
  } else {
    // Hard redirect any onboarding route to /agent to avoid black-screen flow
    // while we move IBKR setup to Settings
    // Express 5 (path-to-regexp v8): use a RegExp for wildcard redirect
    app.get(/^\/onboarding(?:\/.*)?$/, (_req, res) => {
      res.redirect(302, "/agent");
    });
    serveStatic(app);
  }

  const port = Number(process.env.PORT ?? 8080); // Cloud Run sets PORT
  app.get("/_health", (_req, res) => res.status(200).send("ok"));

  server.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);
  });
})();
