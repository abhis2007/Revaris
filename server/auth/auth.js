// ── auth.js ── Session-based auth helpers ────────────────────────────
const db = require('../db/store');

// Middleware: require valid session token (from cookie or header)
function requireAuth(req) {
  const cookie = parseCookies(req.headers.cookie || '');
  const token  = cookie['session'] || req.headers['x-session-token'];
  if (!token) return null;
  const session = db.findSession(token);
  if (!session) return null;
  const org = db.findOrgById(session.orgId);
  return org || null;
}

function parseCookies(str) {
  return Object.fromEntries(
    str.split(';').map(c => c.trim().split('=').map(decodeURIComponent))
  );
}

function sessionCookieHeader(token) {
  return `session=${token}; HttpOnly; Path=/; Max-Age=${7 * 24 * 3600}; SameSite=Strict`;
}

function clearCookieHeader() {
  return `session=; HttpOnly; Path=/; Max-Age=0`;
}

module.exports = { requireAuth, sessionCookieHeader, clearCookieHeader, parseCookies };
