/**
 * POST /api/auth/session
 * Body: { email, nickname? }
 * Upserts player, sets portal_session cookie, returns player + handoff token helper fields.
 */

import { upsertPlayerByEmail } from "../../lib/db.js";
import {
  buildSetCookie,
  handleCors,
  readJsonBody,
  sendError,
  sendJson,
} from "../../lib/http.js";
import {
  SESSION_COOKIE,
  SESSION_TTL_SEC,
  createHandoffToken,
  createSessionToken,
} from "../../lib/session.js";

/**
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 */
export default async function handler(req, res) {
  try {
    if (handleCors(req, res)) return;
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed", code: "METHOD_NOT_ALLOWED" });
      return;
    }

    const body = await readJsonBody(req);
    const email = body?.email;
    const nickname = body?.nickname;

    const { player, created } = await upsertPlayerByEmail({ email, nickname });

    const sessionToken = createSessionToken({
      playerId: player.id,
      email: player.email,
      nickname: player.nickname,
    });
    const handoffToken = createHandoffToken({
      playerId: player.id,
      email: player.email,
      nickname: player.nickname,
    });

    sendJson(
      res,
      created ? 201 : 200,
      {
        player: {
          id: player.id,
          nickname: player.nickname,
          email: player.email,
        },
        created,
        handoffToken,
      },
      {
        "Set-Cookie": buildSetCookie(SESSION_COOKIE, sessionToken, {
          maxAge: SESSION_TTL_SEC,
        }),
      },
    );
  } catch (err) {
    sendError(res, err);
  }
}
