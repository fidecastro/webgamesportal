# Web Games Portal

Sign in with email, then launch web games with one click. Player identity is stored in a **shared Turso / libSQL (SQLite)** database so sibling games can reuse the same `players` rows.

**Mission:** [DEV-158](https://linear.app/fidecastro/issue/DEV-158/web-games-portal-catalog-email-auth-shared-turso)

## Features

- Email-based auth (optional nickname); session cookie on the portal origin
- Shared `players` schema compatible with [rtypeweb](https://github.com/fidecastro/rtypeweb)
- Catalog: [River Raid Lite](https://river-raid-lite.vercel.app/) and [R-Type Web](https://rtypeweb.vercel.app/)
- Documented **auth handoff** so games can inherit identity without re-registration

## Quick start (local)

Requirements: Node.js 20+ (24 recommended).

```bash
npm install
cp .env.example .env   # optional — defaults work for local file SQLite
npm run api            # http://localhost:3000
```

Open the URL, enter an email, and you should see two game cards. Click **Play** to open a game with handoff query parameters.

Without `LIBSQL_URL`, the portal uses a local file database at `data/games.db`.

### Scripts

| Script | Purpose |
|--------|---------|
| `npm run api` / `dev` / `start` | Static UI + `/api/*` on one port |
| `npm run smoke` | Automated register / session / verify / catalog checks |

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LIBSQL_URL` | No | Turso/libSQL URL. If unset → `file:<repo>/data/games.db` |
| `LIBSQL_AUTH_TOKEN` | For remote Turso | Auth token for `LIBSQL_URL` |
| `PORTAL_SESSION_SECRET` | **Yes in production** | HMAC secret for session cookies and (by default) handoff tokens. Local dev uses an insecure default with a console warning if unset. |
| `PORTAL_HANDOFF_SECRET` | No | Optional separate secret for handoff tokens; defaults to `PORTAL_SESSION_SECRET` |
| `PORT` | No | Local server port (default `3000`) |

Use the **same** `LIBSQL_URL` / `LIBSQL_AUTH_TOKEN` as sibling games so one Turso database is shared.

## Shared database schema

The portal creates (if missing) the same `players` shape used by rtypeweb:

```sql
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY NOT NULL,
  nickname TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_nickname ON players(nickname);
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_email ON players(email);
```

A `scores` table is also ensured for local shared-DB friendliness; the portal **never writes scores**.

### Nickname policy

- Email is required; nickname is optional on the form.
- On **first** registration without a nickname, the portal derives one from the email local-part (sanitized, 1–32 chars, `[a-zA-Z0-9_-]`) and appends a numeric suffix if needed for uniqueness.
- On **returning** login (same email), the existing row is returned and any submitted nickname is ignored (no forced re-registration, no nickname conflicts).

“Confirm” means the portal stores the player and establishes a session — there is **no SMTP / magic-link** flow.

## Auth API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/session` | Body `{ "email": "...", "nickname": "..."? }`. Upsert player, set `portal_session` cookie, return player + `handoffToken`. |
| `GET` | `/api/auth/me` | Current session player + fresh `handoffToken`, or `401`. |
| `POST` | `/api/auth/logout` | Clear session cookie. |
| `GET` | `/api/auth/verify` | Handoff verification (see below). |

Session cookie: `portal_session` (HttpOnly, `SameSite=Lax`, `Secure` in production). Payload is an HMAC-signed token (not a full JWT library):

```
base64url(json).base64url(hmac-sha256)
```

Session JSON claims: `{ playerId, email, nickname, exp }` (default TTL 7 days).

---

## Auth handoff contract

**Normative for game implementers.** Games do not need to change for the portal to ship, but consumers should follow this contract.

### 1. Launch URL (query parameters)

When the user clicks **Play**, the portal opens:

```
https://<game-host>/?
  portalPlayerId=<uuid>&
  portalNickname=<nickname>&
  portalEmail=<email>&
  portalToken=<signed-handoff-token>
```

| Param | Meaning |
|-------|---------|
| `portalPlayerId` | Shared `players.id` |
| `portalNickname` | Shared `players.nickname` |
| `portalEmail` | Shared `players.email` (lowercase) |
| `portalToken` | Short-lived signed handoff token (default **30 minutes**) |

Do **not** trust query fields alone in production. Prefer verifying `portalToken` with the portal.

### 2. Handoff token format

Same encoding as the session cookie:

```
token = base64url(payloadJson) + "." + base64url(hmac_sha256(payloadPart, secret))
```

Payload JSON:

```json
{
  "playerId": "…",
  "email": "user@example.com",
  "nickname": "ace",
  "iat": 1710000000,
  "exp": 1710001800
}
```

Signed with `PORTAL_HANDOFF_SECRET` if set, otherwise `PORTAL_SESSION_SECRET`.

### 3. Verify endpoint

```
GET https://<portal-host>/api/auth/verify?token=<portalToken>
```

Alternatively:

```
Authorization: Bearer <portalToken>
```

**Success `200`:**

```json
{
  "valid": true,
  "player": {
    "id": "…",
    "nickname": "ace",
    "email": "user@example.com"
  },
  "exp": 1710001800,
  "iat": 1710000000
}
```

**Failure `401`:** `{ "error": "…", "code": "INVALID_TOKEN" | "TOKEN_EXPIRED" | "MISSING_TOKEN" | "PLAYER_NOT_FOUND" }`

Games should use the **player object from the verify response** (live DB values) rather than the raw query string.

### 4. Optional client inheritance (rtypeweb)

After a successful verify, a game may store:

```js
localStorage.setItem(
  "rtypeweb.player",
  JSON.stringify({ id, nickname, email })
);
```

That matches rtypeweb’s existing client identity shape. The portal **cannot** set third-party `localStorage` (cross-origin); each game must implement this step.

### 5. Example (game-side pseudocode)

```js
const params = new URLSearchParams(location.search);
const token = params.get("portalToken");
if (token) {
  const res = await fetch(
    `https://<portal-host>/api/auth/verify?token=${encodeURIComponent(token)}`
  );
  if (res.ok) {
    const { player } = await res.json();
    // Treat as authenticated; map into game session / localStorage
  }
}
```

---

## Deploy (Vercel)

1. Connect this repo to Vercel.
2. Set `PORTAL_SESSION_SECRET`, and optionally `LIBSQL_URL` + `LIBSQL_AUTH_TOKEN`.
3. Static files are served from the repo root; `api/auth/*.js` are serverless functions (Node).

Ensure the portal’s public origin is the one games call for `/api/auth/verify`.

## Manual verification

1. `npm install && npm run api` (no Turso credentials required).
2. Open `http://localhost:3000` → enter a fresh email → catalog shows two cards.
3. Click each **Play** → game origin opens in a new tab with `portalPlayerId`, `portalNickname`, `portalEmail`, `portalToken` query params.
4. Log out → email form returns.
5. Re-enter the same email → same player identity (nickname not required again).
6. `npm run smoke` → all automated checks pass.

## Non-goals

- Changes inside river-raid-lite or rtypeweb (separate missions)
- SMTP / magic-link email verification
- In-portal scoring or leaderboard UIs
- Creating a Turso account (use env vars or local SQLite)

## License

Private / project use unless otherwise stated.
