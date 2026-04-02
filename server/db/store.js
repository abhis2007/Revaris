// ── store.js ── File-based JSON database ─────────────────────────────
const fs   = require('fs');
const path = require('path');


const DB_DIR   = path.join(__dirname, 'data');
const ORGS_F   = path.join(DB_DIR, 'orgs.json');
const DIGESTS_F= path.join(DB_DIR, 'digests.json');
const SESSIONS_F=path.join(DB_DIR, 'sessions.json');
const COMPETITIVE_REPORTS_F = path.join(DB_DIR, 'competitiveReports.json');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
[ORGS_F, DIGESTS_F, SESSIONS_F].forEach(f => { if (!fs.existsSync(f)) fs.writeFileSync(f, '[]'); });

const read  = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const write = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));

const db = {
  // Check if a reviewId already exists for an org in pending replies
  hasPendingReply(orgId, reviewId) {
    return read(REPLIES_F).some(r => r.orgId === orgId && r.reviewId === reviewId);
  },
  // ── Orgs ────────────────────────────────────────────────────────
  findOrgByEmail(email) {
    return read(ORGS_F).find(o => o.email === email.toLowerCase()) || null;
  },
  findOrgById(id) {
    return read(ORGS_F).find(o => o.id === id) || null;
  },
  createOrg({ name, email, passwordHash, businessName, placeId, location, plan }) {
    const orgs = read(ORGS_F);
    const org  = {
      id: `org_${Date.now()}`,
      name, email: email.toLowerCase(), passwordHash,
      businessName, placeId, location,
      plan: plan || 'starter',
      subscribed: true,
      subscribedAt: new Date().toISOString(),
      digestDay: 'monday',
      createdAt: new Date().toISOString(),
      lastDigestAt: null
    };
    orgs.push(org);
    write(ORGS_F, orgs);
    return org;
  },
  updateOrg(id, updates) {
    const orgs = read(ORGS_F);
    const idx  = orgs.findIndex(o => o.id === id);
    if (idx === -1) return null;
    orgs[idx] = { ...orgs[idx], ...updates };
    write(ORGS_F, orgs);
    return orgs[idx];
  },
  getAllSubscribedOrgs() {
    return read(ORGS_F).filter(o => o.subscribed);
  },

  // ── Sessions ────────────────────────────────────────────────────
  createSession(orgId) {
    const sessions = read(SESSIONS_F);
    const token    = `sess_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    sessions.push({ token, orgId, createdAt: new Date().toISOString() });
    if (sessions.length > 1000) sessions.splice(0, sessions.length - 1000);
    write(SESSIONS_F, sessions);
    return token;
  },
  findSession(token) {
    return read(SESSIONS_F).find(s => s.token === token) || null;
  },
  deleteSession(token) {
    write(SESSIONS_F, read(SESSIONS_F).filter(s => s.token !== token));
  },

  // ── Digests ─────────────────────────────────────────────────────
  saveDigest({ orgId, data, emailSent }) {
    const digests = read(DIGESTS_F);
    const digest  = {
      id: `digest_${Date.now()}`,
      orgId, data, emailSent: emailSent || false,
      createdAt: new Date().toISOString()
    };
    digests.push(digest);
    write(DIGESTS_F, digests);
    return digest;
  },
  getDigestsByOrg(orgId, limit = 10) {
    return read(DIGESTS_F)
      .filter(d => d.orgId === orgId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, limit);
  },
  getLatestDigest(orgId) {
    return this.getDigestsByOrg(orgId, 1)[0] || null;
  }
};

module.exports = db;

// ── Patch: add GMB token methods ──────────────────────────────────────
const GMB_TOKENS_F = path.join(DB_DIR, 'gmb_tokens.json');
if (!fs.existsSync(GMB_TOKENS_F)) fs.writeFileSync(GMB_TOKENS_F, '[]');

db.saveGmbTokens = function(orgId, tokens) {
  const all = read(GMB_TOKENS_F);
  const idx = all.findIndex(t => t.orgId === orgId);
  const entry = { orgId, ...tokens, updatedAt: new Date().toISOString() };
  if (idx >= 0) all[idx] = entry; else all.push(entry);
  write(GMB_TOKENS_F, all);
  return entry;
};

db.getGmbTokens = function(orgId) {
  return read(GMB_TOKENS_F).find(t => t.orgId === orgId) || null;
};

db.deleteGmbTokens = function(orgId) {
  write(GMB_TOKENS_F, read(GMB_TOKENS_F).filter(t => t.orgId !== orgId));
};

// ── Patch: GMB pending replies ────────────────────────────────────────
const REPLIES_F = path.join(DB_DIR, 'pending_replies.json');
if (!fs.existsSync(REPLIES_F)) fs.writeFileSync(REPLIES_F, '[]');

db.savePendingReply = function({ orgId, reviewId, locationId, accountName, reviewText, reviewerName, rating, suggestedReply }) {
  const all   = read(REPLIES_F);
  const entry = {
    id: `reply_${Date.now()}`,
    orgId, reviewId, locationId, accountName,
    reviewText, reviewerName, rating,
    suggestedReply, status: 'pending',
    createdAt: new Date().toISOString()
  };
  all.push(entry);
  write(REPLIES_F, all);
  return entry;
};

db.getPendingReplies = function(orgId) {
  return read(REPLIES_F)
    .filter(r => r.orgId === orgId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
};

db.updateReplyStatus = function(replyId, status, editedReply) {
  const all = read(REPLIES_F);
  const idx = all.findIndex(r => r.id === replyId);
  if (idx >= 0) {
    all[idx].status = status;
    if (editedReply) all[idx].postedReply = editedReply;
    all[idx].updatedAt = new Date().toISOString();
    write(REPLIES_F, all);
    return all[idx];
  }
  return null;
};

if (!fs.existsSync(COMPETITIVE_REPORTS_F)) fs.writeFileSync(COMPETITIVE_REPORTS_F, '[]');
// ── Competitive Report Caching ─────────────────────────────────────
// Save a competitive report for an org (replace if exists for orgId)
db.saveCompetitiveReport = function(orgId, report) {
  const all = read(COMPETITIVE_REPORTS_F);
  const idx = all.findIndex(r => r.orgId === orgId);
  const entry = {
    orgId,
    report,
    updatedAt: new Date().toISOString()
  };
  if (idx >= 0) all[idx] = entry;
  else all.push(entry);
  write(COMPETITIVE_REPORTS_F, all);
  return entry;
};

// Get the latest competitive report for an org
db.getCompetitiveReport = function(orgId) {
  return read(COMPETITIVE_REPORTS_F).find(r => r.orgId === orgId) || null;
};

// Delete a competitive report for an org
db.deleteCompetitiveReport = function(orgId) {
  write(COMPETITIVE_REPORTS_F, read(COMPETITIVE_REPORTS_F).filter(r => r.orgId !== orgId));
};
