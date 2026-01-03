import { type Express } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
// Avoid importing Vite in production: dynamically import inside setupVite
import { type Server } from "http";
// Import utils functions instead of re-exporting to avoid bundling this file
import { log } from "./utils";

// ESM-safe path resolution (Node 18 compatible)
const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const clientRoot = path.join(projectRoot, "client");

export async function setupVite(app: Express, server: Server) {
  // Dev-only imports
  const { createServer: createViteServer } = await import('vite');
  const { nanoid } = await import('nanoid');

  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  // Important: do NOT import vite.config.* here. Let Vite discover it.
  // This keeps the production bundle free of any vite.config imports.
  const vite = await createViteServer({
    root: projectRoot, // allow Vite to find vite.config.ts at repo root
    server: serverOptions,
    appType: "custom",
  });

  // Debug: log all requests before Vite
  app.use((req, res, next) => {
    if (req.originalUrl.startsWith('/api')) {
      console.log('[VITE] API request received:', req.method, req.originalUrl);
    }
    next();
  });

  app.use(vite.middlewares);
  // Express v5/path-to-regexp v6: avoid raw "*"; use a regex catch-all
  // IMPORTANT: Skip /api routes - they should be handled by Express routes, not Vite
  app.use(/.*/, async (req, res, next) => {
    // Skip API routes - let Express handle them
    if (req.originalUrl.startsWith('/api')) {
      return next();
    }
    const url = req.originalUrl;
    try {
      const clientTemplate = path.resolve(clientRoot, "index.html");
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(`src="/src/main.tsx"`, `src="/src/main.tsx?v=${nanoid()}"`);
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      next(e);
    }
  });
}
