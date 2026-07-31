/**
 * Session cookies and handoff tokens (HMAC-signed base64url payloads).
 *
 * Token format (not JWT): base64url(json).base64url(hmac-sha256)
 * Payload session: { playerId, email, nickname, exp }
 * Payload handoff: { playerId, email, nickname, iat, exp }
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "portal_session";
export const SESSION_TTL_SEC = 60 * 60 * 24 * 7; // 7 days
export const HANDOFF_TTL_SEC = 60 * 30; // 30 minutes

const DEV_DEFAULT_SECRET = "dev-only-portal-session-secret-change-me";

let warnedDevSecret = false;

/**
 * @param {"session"|"handoff"} kind
 * @returns {string}
 */
export function getSecret(kind = "session") {
  if (kind === "handoff" && process.env.PORTAL_HANDOFF_SECRET) {
    return process.env.PORTAL_HANDOFF_SECRET;
  }
  const secret = process.env.PORTAL_SESSION_SECRET;
  if (secret && secret.length >= 8) {
    return secret;
  }
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
    throw Object.assign(
      new Error("PORTAL_SESSION_SECRET must be set in production"),
      { status: 500, code: "MISSING_SECRET" },
    );
  }
  if (!warnedDevSecret) {
    console.warn(
      "[portal] PORTAL_SESSION_SECRET unset — using insecure dev default",
    );
    warnedDevSecret = true;
  }
  return DEV_DEFAULT_SECRET;
}

/**
 * @param {string} input
 * @returns {string}
 */
function b64url(input) {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/**
 * @param {string} input
 * @returns {string}
 */
function b64urlDecode(input) {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, "base64").toString("utf8");
}

/**
 * @param {string} data
 * @param {string} secret
 * @returns {string}
 */
function sign(data, secret) {
  return createHmac("sha256", secret)
    .update(data)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/**
 * @param {string} data
 * @param {string} signature
 * @param {string} secret
 * @returns {boolean}
 */
function verifySig(data, signature, secret) {
  const expected = sign(data, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * @param {{ playerId: string, email: string, nickname: string }} player
 * @param {number} [ttlSec]
 * @returns {string}
 */
export function createSessionToken(player, ttlSec = SESSION_TTL_SEC) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    playerId: player.playerId,
    email: player.email,
    nickname: player.nickname,
    exp: now + ttlSec,
  };
  const data = b64url(JSON.stringify(payload));
  const sig = sign(data, getSecret("session"));
  return `${data}.${sig}`;
}

/**
 * @param {string} token
 * @returns {{ playerId: string, email: string, nickname: string, exp: number }}
 */
export function verifySessionToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    throw Object.assign(new Error("Invalid session"), {
      status: 401,
      code: "INVALID_SESSION",
    });
  }
  const [data, sig] = token.split(".");
  if (!data || !sig || !verifySig(data, sig, getSecret("session"))) {
    throw Object.assign(new Error("Invalid session"), {
      status: 401,
      code: "INVALID_SESSION",
    });
  }
  let payload;
  try {
    payload = JSON.parse(b64urlDecode(data));
  } catch {
    throw Object.assign(new Error("Invalid session"), {
      status: 401,
      code: "INVALID_SESSION",
    });
  }
  const now = Math.floor(Date.now() / 1000);
  if (!payload.playerId || !payload.email || !payload.exp || payload.exp < now) {
    throw Object.assign(new Error("Session expired"), {
      status: 401,
      code: "SESSION_EXPIRED",
    });
  }
  return {
    playerId: String(payload.playerId),
    email: String(payload.email),
    nickname: String(payload.nickname || ""),
    exp: payload.exp,
  };
}

/**
 * @param {{ playerId: string, email: string, nickname: string }} player
 * @param {number} [ttlSec]
 * @returns {string}
 */
export function createHandoffToken(player, ttlSec = HANDOFF_TTL_SEC) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    playerId: player.playerId,
    email: player.email,
    nickname: player.nickname,
    iat: now,
    exp: now + ttlSec,
  };
  const data = b64url(JSON.stringify(payload));
  const sig = sign(data, getSecret("handoff"));
  return `${data}.${sig}`;
}

/**
 * @param {string} token
 * @returns {{ playerId: string, email: string, nickname: string, iat: number, exp: number }}
 */
export function verifyHandoffToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    throw Object.assign(new Error("Invalid handoff token"), {
      status: 401,
      code: "INVALID_TOKEN",
    });
  }
  const [data, sig] = token.split(".");
  if (!data || !sig || !verifySig(data, sig, getSecret("handoff"))) {
    throw Object.assign(new Error("Invalid handoff token"), {
      status: 401,
      code: "INVALID_TOKEN",
    });
  }
  let payload;
  try {
    payload = JSON.parse(b64urlDecode(data));
  } catch {
    throw Object.assign(new Error("Invalid handoff token"), {
      status: 401,
      code: "INVALID_TOKEN",
    });
  }
  const now = Math.floor(Date.now() / 1000);
  if (
    !payload.playerId ||
    !payload.email ||
    !payload.exp ||
    payload.exp < now
  ) {
    throw Object.assign(new Error("Handoff token expired"), {
      status: 401,
      code: "TOKEN_EXPIRED",
    });
  }
  return {
    playerId: String(payload.playerId),
    email: String(payload.email),
    nickname: String(payload.nickname || ""),
    iat: Number(payload.iat) || 0,
    exp: payload.exp,
  };
}

/**
 * Build launch URL with documented handoff query params.
 * @param {string} baseUrl
 * @param {{ id: string, nickname: string, email: string }} player
 * @param {string} token
 * @returns {string}
 */
export function buildHandoffUrl(baseUrl, player, token) {
  const url = new URL(baseUrl);
  url.searchParams.set("portalPlayerId", player.id);
  url.searchParams.set("portalNickname", player.nickname);
  url.searchParams.set("portalEmail", player.email);
  url.searchParams.set("portalToken", token);
  return url.toString();
}
