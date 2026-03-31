// ── routes.js ── All HTTP route handlers ─────────────────────────────
const bcrypt = require('bcryptjs');
const db     = require('../db/store');
const { requireAuth, sessionCookieHeader, clearCookieHeader } = require('../auth/auth');
const { generateDigestForOrg, searchPlace } = require('../digest/insights');
const { sendDigestEmail } = require('../digest/mailer');
const { runDigestForAllOrgs } = require('../scheduler/scheduler');

// ── Helpers ────────────────────────────────────────────────────────────
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

// ── Route dispatcher ───────────────────────────────────────────────────
async function handleRoute(req, res, body) {
  const url    = req.url.split('?')[0];
  const method = req.method;
  let   parsed = {};
  try { if (body) parsed = JSON.parse(body); } catch(_) {}

  // ── Auth routes ──────────────────────────────────────────────────
  if (method === 'POST' && url === '/api/auth/register') {
    return handleRegister(req, res, parsed);
  }
  if (method === 'POST' && url === '/api/auth/login') {
    return handleLogin(req, res, parsed);
  }
  if (method === 'POST' && url === '/api/auth/logout') {
    return handleLogout(req, res);
  }
  if (method === 'GET' && url === '/api/auth/me') {
    return handleMe(req, res);
  }

  // ── Org routes ───────────────────────────────────────────────────
  if (method === 'GET' && url === '/api/org/digest') {
    return handleGetDigests(req, res);
  }
  if (method === 'POST' && url === '/api/org/digest/generate') {
    return handleGenerateDigest(req, res);
  }
  if (method === 'GET' && url === '/api/org/profile') {
    return handleGetProfile(req, res);
  }
  if (method === 'POST' && url === '/api/org/profile') {
    return handleUpdateProfile(req, res, parsed);
  }

  // ── Places search ────────────────────────────────────────────────
  if (method === 'POST' && url === '/api/places/search') {
    return handlePlacesSearch(req, res, parsed);
  }

  // ── Admin: trigger digest for all orgs ──────────────────────────
  if (method === 'POST' && url === '/api/admin/run-digest') {
    const org = requireAuth(req);
    if (!org) return json(res, 401, { error: 'Unauthorized' });
    runDigestForAllOrgs().catch(console.error); // fire and forget
    return json(res, 200, { message: 'Digest run started for all orgs' });
  }

  return null; // not handled — caller will serve static or 404
}

// ── Register ──────────────────────────────────────────────────────────
async function handleRegister(req, res, body) {
  const { name, email, password, businessName, location } = body;
  if (!name || !email || !password || !businessName) {
    return json(res, 400, { error: 'name, email, password, businessName are required' });
  }
  if (db.findOrgByEmail(email)) {
    return json(res, 409, { error: 'Email already registered' });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const org = db.createOrg({ name, email, passwordHash, businessName, location: location || 'Noida' });
  const token = db.createSession(org.id);
  res.writeHead(201, {
    'Content-Type': 'application/json',
    'Set-Cookie': sessionCookieHeader(token)
  });
  res.end(JSON.stringify({ success: true, org: safeOrg(org), token }));
}

// ── Login ─────────────────────────────────────────────────────────────
async function handleLogin(req, res, body) {
  const { email, password } = body;
  if (!email || !password) return json(res, 400, { error: 'email and password required' });

  const org = db.findOrgByEmail(email);
  if (!org) return json(res, 401, { error: 'Invalid credentials' });

  const match = await bcrypt.compare(password, org.passwordHash);
  if (!match) return json(res, 401, { error: 'Invalid credentials' });

  const token = db.createSession(org.id);
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Set-Cookie': sessionCookieHeader(token)
  });
  res.end(JSON.stringify({ success: true, org: safeOrg(org), token }));
}

// ── Logout ────────────────────────────────────────────────────────────
function handleLogout(req, res) {
  const { parseCookies } = require('../auth/auth');
  const cookies = parseCookies(req.headers.cookie || '');
  if (cookies.session) db.deleteSession(cookies.session);
  res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': clearCookieHeader() });
  res.end(JSON.stringify({ success: true }));
}

// ── Me ────────────────────────────────────────────────────────────────
function handleMe(req, res) {
  const org = requireAuth(req);
  if (!org) return json(res, 401, { error: 'Not authenticated' });
  return json(res, 200, { org: safeOrg(org) });
}

// ── Get digests ───────────────────────────────────────────────────────
function handleGetDigests(req, res) {
  const org = requireAuth(req);
  if (!org) return json(res, 401, { error: 'Not authenticated' });
  const digests = db.getDigestsByOrg(org.id);
  return json(res, 200, { digests });
}

// ── Generate digest on demand ─────────────────────────────────────────
async function handleGenerateDigest(req, res) {
  const org = requireAuth(req);
  if (!org) return json(res, 401, { error: 'Not authenticated' });

  try {
    const digestData = await generateDigestForOrg(org);
    const emailSent  = await sendDigestEmail(org, digestData);
    const saved      = db.saveDigest({ orgId: org.id, data: digestData, emailSent });
    db.updateOrg(org.id, { lastDigestAt: new Date().toISOString() });
    return json(res, 200, { success: true, digest: saved, emailSent });
  } catch (err) {
    return json(res, 500, { error: err.message });
  }
}

// ── Get/update profile ────────────────────────────────────────────────
function handleGetProfile(req, res) {
  const org = requireAuth(req);
  if (!org) return json(res, 401, { error: 'Not authenticated' });
  return json(res, 200, { org: safeOrg(org) });
}

async function handleUpdateProfile(req, res, body) {
  const org = requireAuth(req);
  if (!org) return json(res, 401, { error: 'Not authenticated' });
  const { businessName, location, placeId, digestDay } = body;
  const updated = db.updateOrg(org.id, {
    ...(businessName && { businessName }),
    ...(location    && { location }),
    ...(placeId     && { placeId }),
    ...(digestDay   && { digestDay })
  });
  return json(res, 200, { org: safeOrg(updated) });
}

// ── Places search ─────────────────────────────────────────────────────
async function handlePlacesSearch(req, res, body) {
  const org = requireAuth(req);
  if (!org) return json(res, 401, { error: 'Not authenticated' });
  const { businessName, location } = body;
  if (!businessName) return json(res, 400, { error: 'businessName required' });
  try {
    const place = await searchPlace(businessName, location || 'Noida');
    return json(res, 200, { place });
  } catch (err) {
    return json(res, 404, { error: err.message });
  }
}

// ── Strip sensitive fields ────────────────────────────────────────────
function safeOrg(org) {
  const { passwordHash, ...safe } = org;
  return safe;
}

module.exports = { handleRoute };

// ══════════════════════════════════════════════════════════════════════
// GMB OAuth + Business API routes  (appended)
// ══════════════════════════════════════════════════════════════════════
const gmb        = require('../gmb/gmb');
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

// Patch handleRoute to include GMB routes
const _originalHandleRoute = handleRoute;
async function handleRouteWithGmb(req, res, body) {
  const result = await _originalHandleRoute(req, res, body);
  if (result !== null) return result;

  const url    = req.url.split('?')[0];
  const qs     = Object.fromEntries(new URL('http://x' + req.url).searchParams);
  const method = req.method;
  let parsed   = {};
  try { if (body) parsed = JSON.parse(body); } catch(_) {}

  // ── OAuth: redirect to Google consent screen ──────────────────────
  if (method === 'GET' && url === '/api/oauth/connect') {
    const org = requireAuth(req);
    if (!org) return json(res, 401, { error: 'Not authenticated' });
    const authUrl = gmb.buildAuthUrl(org.id);
    res.writeHead(302, { Location: authUrl });
    res.end();
    return true;
  }

  // ── OAuth: callback from Google ───────────────────────────────────
  if (method === 'GET' && url === '/api/oauth/callback') {
    console.log('OAuth callback query:', qs);
    const { code, state: orgId, error } = qs;

    if (error) {
      res.writeHead(302, { Location: `/dashboard?gmb_error=${encodeURIComponent(error)}` });
      res.end();
      return true;
    }

    try {
      const tokens = await gmb.exchangeCodeForTokens(code);
      db.saveGmbTokens(orgId, {
        accessToken:  tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt:    new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        scope:        tokens.scope
      });
      db.updateOrg(orgId, { gmbConnected: true, gmbConnectedAt: new Date().toISOString() });
      res.writeHead(302, { Location: '/dashboard?gmb_connected=1' });
      res.end();
    } catch (err) {
      console.error('[OAuth] Callback error:', err.message);
      res.writeHead(302, { Location: `/dashboard?gmb_error=${encodeURIComponent(err.message)}` });
      res.end();
    }
    return true;
  }

  // ── OAuth: disconnect ─────────────────────────────────────────────
  if (method === 'POST' && url === '/api/oauth/disconnect') {
    const org = requireAuth(req);
    if (!org) return json(res, 401, { error: 'Not authenticated' });
    db.deleteGmbTokens(org.id);
    db.updateOrg(org.id, { gmbConnected: false });
    return json(res, 200, { success: true });
  }

  // ── GMB: fetch accounts ───────────────────────────────────────────
  if (method === 'GET' && url === '/api/gmb/accounts') {
    const org = requireAuth(req);
    if (!org) return json(res, 401, { error: 'Not authenticated' });
    try {
      const token    = await gmb.getValidAccessToken(org);
      const accounts = await gmb.fetchAccounts(token);
      return json(res, 200, { accounts });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  // ── GMB: fetch locations for an account ───────────────────────────
  if (method === 'GET' && url === '/api/gmb/locations') {
    const org = requireAuth(req);
    if (!org) return json(res, 401, { error: 'Not authenticated' });
    const { accountName } = qs;
    if (!accountName) return json(res, 400, { error: 'accountName required' });
    try {
      const token     = await gmb.getValidAccessToken(org);
      const locations = await gmb.fetchLocations(accountName, token);
      return json(res, 200, { locations });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  // ── GMB: fetch reviews for a location ─────────────────────────────
  if (method === 'GET' && url === '/api/gmb/reviews') {
    const org = requireAuth(req);
    if (!org) return json(res, 401, { error: 'Not authenticated' });
    const { accountName, locationId } = qs;
    if (!accountName || !locationId) return json(res, 400, { error: 'accountName and locationId required' });
    try {
      const token   = await gmb.getValidAccessToken(org);
      const reviews = await gmb.fetchGmbReviews(accountName, locationId, token);

      // Auto-generate AI reply suggestions for unanswered reviews
      const pending = [];
      for (const review of reviews) {
        if (!review.reviewReply && review.comment) {
          // Only add if reviewId is not already present for this org
          if (!db.hasPendingReply(org.id, review.reviewId)) {
            const suggestion = await generateAiReply(review, org.businessName);
            const saved = db.savePendingReply({
              orgId:         org.id,
              reviewId:      review.reviewId,
              locationId,
              accountName,
              reviewText:    review.comment,
              reviewerName:  review.reviewer?.displayName || 'Customer',
              rating:        starRatingToNum(review.starRating),
              suggestedReply: suggestion
            });
            pending.push(saved);
          }
        }
      }

      return json(res, 200, { reviews, pending_suggestions: pending.length });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  // ── GMB: get pending replies ──────────────────────────────────────
  if (method === 'GET' && url === '/api/gmb/pending-replies') {
    const org = requireAuth(req);
    if (!org) return json(res, 401, { error: 'Not authenticated' });
    const replies = db.getPendingReplies(org.id);
    return json(res, 200, { replies });
  }

  // ── GMB: approve + post a reply ───────────────────────────────────
  if (method === 'POST' && url === '/api/gmb/reply/approve') {
    const org = requireAuth(req);
    if (!org) return json(res, 401, { error: 'Not authenticated' });
    const { replyId, editedText } = parsed;
    if (!replyId) return json(res, 400, { error: 'replyId required' });

    const pending = db.getPendingReplies(org.id).find(r => r.id === replyId);
    if (!pending) return json(res, 404, { error: 'Reply not found' });

    try {
      const token     = await gmb.getValidAccessToken(org);
      const replyText = editedText || pending.suggestedReply;
      await gmb.replyToReview(pending.accountName, pending.locationId, pending.reviewId, replyText, token);
      db.updateReplyStatus(replyId, 'posted', replyText);
      return json(res, 200, { success: true, message: 'Reply posted to Google Maps' });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  // ── GMB: reject/dismiss a pending reply ───────────────────────────
  if (method === 'POST' && url === '/api/gmb/reply/reject') {
    const org = requireAuth(req);
    if (!org) return json(res, 401, { error: 'Not authenticated' });
    const { replyId } = parsed;
    db.updateReplyStatus(replyId, 'rejected');
    return json(res, 200, { success: true });
  }

  // ── GMB: regenerate AI reply suggestion ───────────────────────────
  if (method === 'POST' && url === '/api/gmb/reply/regenerate') {
    const org = requireAuth(req);
    if (!org) return json(res, 401, { error: 'Not authenticated' });
    const { replyId } = parsed;

    const pending = db.getPendingReplies(org.id).find(r => r.id === replyId);
    if (!pending) return json(res, 404, { error: 'Reply not found' });

    try {
      const newSuggestion = await generateAiReply(
        { comment: pending.reviewText, starRating: numToStarRating(pending.rating) },
        org.businessName
      );
      db.updateReplyStatus(replyId, 'pending', null);
      // update suggestion
      const all = require('fs').readFileSync(
        require('path').join(__dirname, '../db/data/pending_replies.json'), 'utf8'
      );
      const replies = JSON.parse(all);
      const idx = replies.findIndex(r => r.id === replyId);
      if (idx >= 0) {
        replies[idx].suggestedReply = newSuggestion;
        require('fs').writeFileSync(
          require('path').join(__dirname, '../db/data/pending_replies.json'),
          JSON.stringify(replies, null, 2)
        );
      }
      return json(res, 200, { success: true, suggestedReply: newSuggestion });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  return null;
}

// ── Claude: generate reply suggestion ────────────────────────────────
async function generateAiReply(review, businessName) {
  if (!ANTHROPIC_KEY) return 'Thank you for your feedback! We appreciate you taking the time to share your experience.';

  const rating   = starRatingToNum(review.starRating);
  const tone     = rating >= 4 ? 'warm and grateful' : 'apologetic and solution-focused';
  const bodyStr  = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: `You are the owner of ${businessName || 'our restaurant'}.
Write a ${tone} reply to this Google Maps review (${rating}/5 stars):
"${review.comment}"

Rules:
- Under 80 words
- Sound genuine and human, not templated
- If negative: acknowledge the issue, invite them back
- If positive: thank them specifically
- End with "— The ${businessName || 'Team'}"
Return only the reply text.`
    }]
  });

  const https   = require('https');
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const d = JSON.parse(data);
          resolve((d.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim());
        } catch(_) { resolve('Thank you for your feedback!'); }
      });
    });
    req.on('error', () => resolve('Thank you for your feedback!'));
    req.write(bodyStr);
    req.end();
  });
}

function starRatingToNum(star) {
  const map = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  return map[star] || 3;
}

function numToStarRating(n) {
  const map = { 1:'ONE', 2:'TWO', 3:'THREE', 4:'FOUR', 5:'FIVE' };
  return map[n] || 'THREE';
}

// Override export
module.exports = { handleRoute: handleRouteWithGmb };
