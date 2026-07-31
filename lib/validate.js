/**
 * Input validation — aligned with rtypeweb rules for shared players shape.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NICKNAME_RE = /^[a-zA-Z0-9_-]+$/;

/**
 * @param {unknown} value
 * @returns {string} normalized lowercase email
 */
export function validateEmail(value) {
  if (typeof value !== "string") {
    throw Object.assign(new Error("Email is required"), {
      status: 400,
      code: "INVALID_EMAIL",
    });
  }
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    throw Object.assign(new Error("Invalid email address"), {
      status: 400,
      code: "INVALID_EMAIL",
    });
  }
  return email;
}

/**
 * @param {unknown} value
 * @returns {string|null} trimmed nickname or null if omitted
 */
export function validateNicknameOptional(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw Object.assign(new Error("Nickname must be a string"), {
      status: 400,
      code: "INVALID_NICKNAME",
    });
  }
  const nickname = value.trim();
  if (nickname.length < 1 || nickname.length > 32) {
    throw Object.assign(new Error("Nickname must be 1–32 characters"), {
      status: 400,
      code: "INVALID_NICKNAME",
    });
  }
  if (!NICKNAME_RE.test(nickname)) {
    throw Object.assign(
      new Error("Nickname may only contain letters, numbers, _ and -"),
      { status: 400, code: "INVALID_NICKNAME" },
    );
  }
  return nickname;
}

/**
 * Derive a default nickname from an email local-part.
 * @param {string} email
 * @returns {string}
 */
export function defaultNicknameFromEmail(email) {
  const local = email.split("@")[0] || "player";
  let sanitized = local
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[-_]+|[-_]+$/g, "");
  if (!sanitized) sanitized = "player";
  if (sanitized.length > 32) sanitized = sanitized.slice(0, 32);
  if (sanitized.length < 1) sanitized = "player";
  return sanitized;
}
