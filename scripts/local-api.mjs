/**
 * Local static + API server for development.
 * Serves repo root as static files and routes /api/auth/* to handlers.
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import sessionHandler from "../api/auth/session.js";
import meHandler from "../api/auth/me.js";
import logoutHandler from "../api/auth/logout.js";
import verifyHandler from "../api/auth/verify.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

const routes = {
  "/api/auth/session": sessionHandler,
  "/api/auth/me": meHandler,
  "/api/auth/logout": logoutHandler,
  "/api/auth/verify": verifyHandler,
};

/**
 * @param {string} urlPath
 */
function resolveStatic(urlPath) {
  let rel = decodeURIComponent(urlPath.split("?")[0]);
  if (rel === "/") rel = "/index.html";
  const full = normalize(join(ROOT, rel));
  // Avoid classic prefix path issues (ROOT + "evil" when ROOT is not sep-terminated).
  if (full !== ROOT && !full.startsWith(ROOT + sep)) {
    return null;
  }
  if (!existsSync(full)) return null;
  return full;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://localhost:${PORT}`);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    // Normalize /api/auth/session/ → /api/auth/session
    const apiPath = pathname.startsWith("/api/") ? pathname : null;
    if (apiPath && routes[apiPath]) {
      // Handlers expect req.url with query string for verify
      await routes[apiPath](req, res);
      return;
    }

    if (apiPath) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found", code: "NOT_FOUND" }));
      return;
    }

    const filePath = resolveStatic(url.pathname);
    if (!filePath) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const data = await readFile(filePath);
    const type = MIME[extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
    }
    res.end(JSON.stringify({ error: "Internal server error" }));
  }
});

server.listen(PORT, () => {
  console.log(`[portal] http://localhost:${PORT}`);
  console.log(`[portal] DB: ${process.env.LIBSQL_URL || "file:data/games.db (local)"}`);
});
