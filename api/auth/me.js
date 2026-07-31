/**
 * GET /api/auth/me
 * Returns the current session player or 401.
 */

import { getPlayerById } from "../../lib/db.js";
import {
  getCookie,
  handleCors,
  sendError,
  sendJson,
} from "../../lib/http.js";
import {
  SESSION_COOKIE,
  createHandoffToken,
  verifySessionToken,
} from "../../lib/session.js";

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

    const cookie = getCookie(req, SESSION_COOKIE);
    if (!cookie) {
      sendJson(res, 401, { error: "Not authenticated", code: "NO_SESSION" });
      return;
    }

    const claims = verifySessionToken(cookie);
    const player = await getPlayerById(claims.playerId);
    if (!player) {
      sendJson(res, 401, { error: "Player not found", code: "PLAYER_NOT_FOUND" });
      return;
    }

    const handoffToken = createHandoffToken({
      playerId: player.id,
      email: player.email,
      nickname: player.nickname,
    });

    sendJson(res, 200, {
      player: {
        id: player.id,
        nickname: player.nickname,
        email: player.email,
      },
      handoffToken,
    });
  } catch (err) {
    sendError(res, err);
  }
}
