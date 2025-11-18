import { type Express } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
// Avoid importing Vite in production: dynamically import inside setupVite
import { type Server } from "http";
import { nanoid } from "nanoid";

// Re-export production-safe functions from utils
export { log, serveStatic } from "./utils";

// ESM-safe path resolution (Node 18 compatible)
const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const clientRoot = path.join(projectRoot, "client");

export async function setupVite(app: Express, server: Server) {
  const { createServer: createViteServer } = await import('vite');
  // Use a string variable to prevent ESBuild from bundling this
  const configPath = '../vite.config.js';
  const { default: viteConfig } = await import(configPath);

  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  // Express v5/path-to-regexp v6: avoid raw "*"; use a regex catch-all
  app.use(/.*/, async (req, res, next) => {
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

