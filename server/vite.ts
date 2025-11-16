import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
// Avoid importing Vite in production: dynamically import inside setupVite
import { type Server } from "http";
import { nanoid } from "nanoid";


// ESM-safe path resolution (Node 18 compatible)
const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const clientRoot = path.join(projectRoot, "client");
const distPublic = path.join(projectRoot, "dist", "public");

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server) {
  const { createServer: createViteServer } = await import('vite');
  const { default: viteConfig } = await import('../vite.config'); // <-- moved here

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

export function serveStatic(app: Express) {
  const distPath = distPublic;

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use(/.*/, (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
