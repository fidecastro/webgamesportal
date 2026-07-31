/**
 * GET /api/auth/verify?token=...
 * Or Authorization: Bearer <token>
 *
 * Handoff verification for game clients. Returns player claims or 401.
 */

import { getPlayerById } from "../../lib/db.js";
import {
  handleCors,
  sendError,
  sendJson,
} from "../../lib/http.js";
import { verifyHandoffToken } from "../../lib/session.js";

/**
 * @param {import('http').IncomingMessage} req
 * @returns {string|null}
 */
function extractToken(req) {
  const url = new URL(req.url || "/", "http://localhost");
  const fromQuery = url.searchParams.get("token");
  if (fromQuery) return fromQuery;

  const auth = req.headers.authorization;
  if (auth && typeof auth === "string") {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
  }
  return null;
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
export default async function handler(req, res) {
  try {
    if (handleCors(req, res)) return;
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "Method not allowed", code: "METHOD_NOT_ALLOWED" });
      return;
    }

    const token = extractToken(req);
    if (!token) {
      sendJson(res, 401, { error: "Missing token", code: "MISSING_TOKEN" });
      return;
    }

    const claims = verifyHandoffToken(token);
    const player = await getPlayerById(claims.playerId);
    if (!player) {
      sendJson(res, 401, { error: "Player not found", code: "PLAYER_NOT_FOUND" });
      return;
    }

    // Prefer live DB values; token is proof of recent portal auth.
    sendJson(res, 200, {
      valid: true,
      player: {
        id: player.id,
        nickname: player.nickname,
        email: player.email,
      },
      exp: claims.exp,
      iat: claims.iat,
    });
  } catch (err) {
    sendError(res, err);
  }
}
