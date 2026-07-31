/**
 * Shared HTTP helpers for Vercel-style Node request handlers.
 */

/**
 * @param {import('http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 * @param {Record<string, string>} [extraHeaders]
 */
export function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders,
  });
  res.end(payload);
}

/**
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<unknown>}
 */
export async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("Invalid JSON body"), {
      status: 400,
      code: "INVALID_JSON",
    });
  }
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {string} name
 * @returns {string|null}
 */
export function getCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  const parts = header.split(";");
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

/**
 * @param {string} name
 * @param {string} value
 * @param {{ maxAge?: number, clear?: boolean }} [opts]
 * @returns {string}
 */
export function buildSetCookie(name, value, opts = {}) {
  const parts = [
    `${name}=${opts.clear ? "" : encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (opts.clear) {
    parts.push("Max-Age=0");
  } else if (typeof opts.maxAge === "number") {
    parts.push(`Max-Age=${opts.maxAge}`);
  }
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

/**
 * CORS + OPTIONS preflight for local/dev if needed.
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @returns {boolean} true if handled (OPTIONS)
 */
export function handleCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization",
  );
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS",
  );
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}

/**
 * Map thrown errors with status/code into JSON responses.
 * @param {import('http').ServerResponse} res
 * @param {unknown} err
 */
export function sendError(res, err) {
  const status =
    err && typeof err === "object" && "status" in err && typeof err.status === "number"
      ? err.status
      : 500;
  const code =
    err && typeof err === "object" && "code" in err && typeof err.code === "string"
      ? err.code
      : "INTERNAL_ERROR";
  const message =
    err instanceof Error ? err.message : "Internal server error";
  if (status >= 500) {
    console.error("[portal]", err);
  }
  sendJson(res, status, { error: message, code });
}
