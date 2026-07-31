/**
 * Portal client: email auth gate + game catalog with handoff launch.
 */

/** @typedef {{ id: string, title: string, blurb: string, url: string, badge: string }} Game */

/** @type {Game[]} */
const GAMES = [
  {
    id: "river-raid-lite",
    title: "River Raid Lite",
    blurb:
      "Fly the river canyon, dodge and destroy. Classic vertical shooter, web edition.",
    url: "https://river-raid-lite.vercel.app/",
    badge: "Arcade",
  },
  {
    id: "rtypeweb",
    title: "R-Type Web",
    blurb:
      "Side-scrolling space combat. Charge, unleash, survive the armada.",
    url: "https://rtypeweb.vercel.app/",
    badge: "Shooter",
  },
];

const els = {
  boot: document.getElementById("boot-status"),
  authPanel: document.getElementById("auth-panel"),
  catalogPanel: document.getElementById("catalog-panel"),
  form: document.getElementById("auth-form"),
  email: document.getElementById("email"),
  nickname: document.getElementById("nickname"),
  authError: document.getElementById("auth-error"),
  authSubmit: document.getElementById("auth-submit"),
  userBar: document.getElementById("user-bar"),
  welcome: document.getElementById("welcome"),
  logoutBtn: document.getElementById("logout-btn"),
  gameCards: document.getElementById("game-cards"),
};

/** @type {{ id: string, nickname: string, email: string } | null} */
let currentPlayer = null;
/** @type {string | null} */
let handoffToken = null;

/**
 * @param {string} path
 * @param {RequestInit} [opts]
 */
async function api(path, opts = {}) {
  const headers = new Headers(opts.headers || {});
  if (opts.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, {
    ...opts,
    headers,
    credentials: "same-origin",
  });
  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }
  return { res, data };
}

function showError(msg) {
  els.authError.textContent = msg;
  els.authError.classList.remove("hidden");
}

function clearError() {
  els.authError.textContent = "";
  els.authError.classList.add("hidden");
}

/**
 * @param {{ id: string, nickname: string, email: string }} player
 * @param {string} [token]
 */
function showCatalog(player, token) {
  currentPlayer = player;
  handoffToken = token || null;
  els.boot.classList.add("hidden");
  els.authPanel.classList.add("hidden");
  els.catalogPanel.classList.remove("hidden");
  els.userBar.classList.remove("hidden");
  els.welcome.textContent = `Welcome, ${player.nickname}`;
  renderCards();
}

function showAuth() {
  currentPlayer = null;
  handoffToken = null;
  els.boot.classList.add("hidden");
  els.catalogPanel.classList.add("hidden");
  els.userBar.classList.add("hidden");
  els.authPanel.classList.remove("hidden");
}

/**
 * Build launch URL with portal handoff query params.
 * @param {Game} game
 * @param {{ id: string, nickname: string, email: string }} player
 * @param {string} token
 */
function buildLaunchUrl(game, player, token) {
  const url = new URL(game.url);
  url.searchParams.set("portalPlayerId", player.id);
  url.searchParams.set("portalNickname", player.nickname);
  url.searchParams.set("portalEmail", player.email);
  url.searchParams.set("portalToken", token);
  return url.toString();
}

function renderCards() {
  // Wire static cards (or rebuild if empty) so titles stay in HTML for smoke/SEO.
  const byId = new Map(GAMES.map((g) => [g.id, g]));
  const existing = els.gameCards.querySelectorAll("[data-game-id]");
  if (existing.length > 0) {
    for (const card of existing) {
      const game = byId.get(card.dataset.gameId);
      if (!game) continue;
      const play = card.querySelector("[data-play], .btn-play");
      if (play) {
        play.replaceWith(play.cloneNode(true));
        const fresh = card.querySelector("[data-play], .btn-play");
        fresh.addEventListener("click", () => launchGame(game));
      }
    }
    return;
  }

  els.gameCards.innerHTML = "";
  for (const game of GAMES) {
    const card = document.createElement("article");
    card.className = "card";
    card.dataset.gameId = game.id;

    const badge = document.createElement("span");
    badge.className = "card-badge";
    badge.textContent = game.badge;

    const title = document.createElement("h3");
    title.textContent = game.title;

    const blurb = document.createElement("p");
    blurb.textContent = game.blurb;

    const play = document.createElement("button");
    play.type = "button";
    play.className = "btn btn-play";
    play.dataset.play = "";
    play.textContent = "Play";
    play.addEventListener("click", () => launchGame(game));

    card.append(badge, title, blurb, play);
    els.gameCards.append(card);
  }
}

/**
 * @param {Game} game
 */
async function launchGame(game) {
  if (!currentPlayer) return;

  // Refresh handoff token so it is short-lived and valid at click time.
  let token = handoffToken;
  try {
    const { res, data } = await api("/api/auth/me");
    if (res.ok && data?.handoffToken) {
      token = data.handoffToken;
      handoffToken = token;
      if (data.player) currentPlayer = data.player;
    } else if (res.status === 401) {
      showAuth();
      showError("Session expired — sign in again.");
      return;
    }
  } catch {
    // Fall through with cached token if network glitch
  }

  if (!token || !currentPlayer) {
    showError("Could not prepare launch token. Try signing in again.");
    showAuth();
    return;
  }

  const url = buildLaunchUrl(game, currentPlayer, token);
  window.open(url, "_blank", "noopener,noreferrer");
}

async function restoreSession() {
  try {
    const { res, data } = await api("/api/auth/me");
    if (res.ok && data?.player) {
      showCatalog(data.player, data.handoffToken);
      return;
    }
  } catch {
    /* show auth */
  }
  showAuth();
}

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();
  const email = els.email.value.trim();
  const nickname = els.nickname.value.trim();
  if (!email) {
    showError("Email is required.");
    return;
  }
  els.authSubmit.disabled = true;
  try {
    const body = { email };
    if (nickname) body.nickname = nickname;
    const { res, data } = await api("/api/auth/session", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      showError(data?.error || `Sign-in failed (${res.status})`);
      return;
    }
    showCatalog(data.player, data.handoffToken);
  } catch (err) {
    showError(err instanceof Error ? err.message : "Network error");
  } finally {
    els.authSubmit.disabled = false;
  }
});

els.logoutBtn.addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
    /* still clear UI */
  }
  showAuth();
  clearError();
});

restoreSession();
