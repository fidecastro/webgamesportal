/**
 * POST /api/auth/logout
 * Clears the portal_session cookie.
 */

import {
  buildSetCookie,
  handleCors,
  sendError,
  sendJson,
} from "../../lib/http.js";
import { SESSION_COOKIE } from "../../lib/session.js";

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

    sendJson(
      res,
      200,
      { ok: true },
      {
        "Set-Cookie": buildSetCookie(SESSION_COOKIE, "", { clear: true }),
      },
    );
  } catch (err) {
    sendError(res, err);
  }
}
