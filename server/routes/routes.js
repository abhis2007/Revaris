// ── routes.js ── All HTTP route handlers ─────────────────────────────
require('../dotenv-load');

const bcrypt = require('bcryptjs');
const db     = require('../db/store');
const https = require('https');
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

async function getCompetitiveAiInsights(report, orgInfo) {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || 'YOUR_ANTHROPIC_KEY';
  const isMockEnv = process.env.MOCK_MODE === 'true' || !ANTHROPIC_KEY;
  if (isMockEnv) {
    // Stub/mock response for development or when AI is unavailable (matches new format)
    return {
      "summary": "The market shows a mix of premium dining experiences winning on food quality and service (Ancient Barbeque, Moti Mahal) while large chains (McDonald’s) are losing customer trust due to inconsistent service and quality issues. Your business has stronger growth momentum than most competitors but lacks clear differentiation in experience and consistency-driven branding.",
      "competitor_analysis": [
        {
          "name": "The Ancient Barbeque & Bar in Noida",
          "sentiment": {
            "positive": 5,
            "neutral": 0,
            "negative": 0
          },
          "growth_rate": 0.0006,
          "strengths": [
            "Consistently high food quality and taste",
            "Strong service experience with staff recognition",
            "Great ambience suitable for celebrations",
            "Wide variety of food options"
          ],
          "weaknesses": [
            "Hygiene issues in washrooms",
            "No dedicated parking",
            "Hidden service charges complaints"
          ]
        },
        {
          "name": "Moti Mahal Fine Dining & Bar",
          "sentiment": {
            "positive": 4,
            "neutral": 1,
            "negative": 0
          },
          "growth_rate": 0.0033,
          "strengths": [
            "Authentic North Indian taste",
            "Premium dining ambience",
            "Highly attentive staff",
            "Strong brand recall for quality meals"
          ],
          "weaknesses": [
            "Inconsistent delivery experience",
            "Food quality drops in online orders",
            "Overuse of spices causing dissatisfaction"
          ]
        },
        {
          "name": "McDonald’s",
          "sentiment": {
            "positive": 2,
            "neutral": 1,
            "negative": 2
          },
          "growth_rate": 0.0008,
          "strengths": [
            "Strong brand trust and familiarity",
            "Clean outlets and predictable experience (in some cases)",
            "Good for quick and affordable meals"
          ],
          "weaknesses": [
            "Slow service despite low crowd",
            "Inconsistent food quality",
            "Poor staff behavior and understaffing",
            "Order handling inefficiencies"
          ]
        }
      ],
      "top_competitor": {
        "name": "The Ancient Barbeque & Bar in Noida",
        "why_winning": "They deliver a complete experience—high-quality food, strong service, and ambience tailored for group occasions. Customers repeatedly highlight staff behavior and food consistency, which builds loyalty and repeat visits."
      },
      "gap_analysis": {
        "user_vs_market": "Tasty Treats has significantly higher growth momentum (1.87%) compared to competitors but lacks strong positioning in customer experience, staff recognition, and memorable dining value.",
        "missed_opportunities": [
          "No strong positioning around occasions (birthdays, family dining)",
          "Lack of highlighted staff experience or personalized service",
          "No visible differentiation in ambience or experience",
          "Not leveraging competitor hygiene/service failures in branding",
          "Limited focus on review generation despite strong growth potential"
        ]
      },
      "action_plan": {
        "do_immediately": [
          "Introduce a 'celebration package' (free cake, decor, staff shoutout) to directly compete with Ancient Barbeque’s occasion-driven demand",
          "Launch a strict service SLA (order time guarantee + compensation) to capitalize on competitors’ slow service complaints"
        ],
        "next_steps": [
          "Train staff to create memorable interactions and encourage name mentions in reviews",
          "Run a review acquisition campaign (QR on table + incentive) to accelerate visibility",
          "Improve ambience elements (lighting, music, seating) for social sharing appeal",
          "Create a consistent food quality checklist to avoid McDonald’s-like inconsistency issues",
          "Build a strong delivery experience with packaging and quality control to beat Moti Mahal’s weakness"
        ],
        "exploit_competitor_weakness": [
          "Market hygiene and cleanliness aggressively to target Ancient Barbeque and Mithaas gaps",
          "Promote 'fast service guarantee' to attract frustrated McDonald’s and Pizza Hut customers",
          "Highlight 'consistent quality every time' messaging to win against brands with fluctuating experiences",
          "Offer transparent pricing (no hidden charges) to build trust over competitors adding extra fees",
          "Focus on reliable delivery experience to capture dissatisfied online food ordering customers"
        ]
      }
    }
  }
  // Prepare prompt for Claude
  const prompt = `
      You are an expert restaurant business analyst AI.

    Your task is to analyze competitor data and generate highly actionable insights that help a restaurant owner outperform competitors and grow revenue.

    INPUT DATA:

    Competitor Report (JSON):
    ${JSON.stringify(report, null, 2)}

    User Business Info (JSON):
    ${JSON.stringify(orgInfo, null, 2)}

    ---

    ANALYSIS REQUIREMENTS:

    1. SENTIMENT ANALYSIS
    - Classify recent reviews (last 30 days) into:
      positive / neutral / negative
    - Count each category for every competitor
    - Identify sentiment trend (improving / declining / stable)

    2. REVIEW VELOCITY & GROWTH
    - Calculate:
      growth_rate = reviews_last_month / total_reviews
    - Compare growth adjusted by business age
    - Identify which competitors are gaining momentum fastest

    3. CUSTOMER EXPERIENCE INSIGHTS
    From reviews, extract:
    - Top strengths (e.g., fast service, taste, ambience)
    - Top complaints (e.g., slow delivery, pricing, hygiene)
    - Most mentioned themes

    4. COMPETITOR WEAKNESS DETECTION (VERY IMPORTANT)
    - Identify repeated negative patterns
    - Explain WHY customers are unhappy
    - Highlight opportunities where the user can outperform competitors

    5. WINNING FACTORS
    - Identify what top competitors are doing right
    - Explain what makes them successful

    6. GAP ANALYSIS (USER vs COMPETITORS)
    - Compare user's business with top competitors:
      - sentiment
      - growth
      - engagement
    - Clearly highlight gaps:
      - where user is behind
      - where user has advantage

    7. ACTIONABLE STRATEGY (MOST IMPORTANT)
    Provide specific, practical strategies:
    - Minimum 5 actions
    - Must be directly implementable
    - Must include:
      - quick wins (immediate impact)
      - mid-term improvements
      - differentiation strategy

    8. COMPETITOR PRIORITIZATION (VERY IMPORTANT)

    - Do NOT include all competitors in the final output.
    - Select ONLY the top 2-3 most relevant competitors based on:
      1. Highest review growth rate
      2. Strongest positive sentiment
      3. Direct competitive threat

    - Prioritize competitors that:
      - Are outperforming the user
      - OR are rapidly growing

    - Ignore low-impact competitors unless they reveal a unique weakness or opportunity.

    ---

    OUTPUT FORMAT (STRICT JSON ONLY):

    {
      "summary": "High-level insight",
      "competitor_analysis": [
        {
          "name": "Competitor Name",
          "sentiment": {
            "positive": number,
            "neutral": number,
            "negative": number
          },
          "growth_rate": number,
          "strengths": ["..."],
          "weaknesses": ["..."]
        }
      ],
      "top_competitor": {
        "name": "Name",
        "why_winning": "Explanation"
      },
      "gap_analysis": {
        "user_vs_market": "Where user stands",
        "missed_opportunities": ["..."]
      },
      "action_plan": {
        "do_immediately": ["..."],
        "next_steps": ["..."],
        "exploit_competitor_weakness": ["..."]
      }
    }

    IMPORTANT:
    - Be specific, not generic
    - Avoid vague advice
    - Focus on revenue growth
    - Think like a business consultant

    Respond ONLY with valid JSON.
  `;

  const bodyStr = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }]
  });
  
  const result = await httpsPost(
    'api.anthropic.com', '/v1/messages',
    {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    bodyStr
  );

  const data = JSON.parse(result.body);
  if(JSON.parse(result.body).error.type === 'invalid_request_error') {
    throw new Error(`Anthropic API error: ${data.error.message}`);
  }
  if(JSON.parse(result.body).error.type === 'authentication_error') {
    throw new Error(`Anthropic API error: invalid API key`);
  }
  
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error('Claude did not return valid JSON: ' + text);
  }
}


function httpsPost(hostname, urlPath, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path: urlPath, method: 'POST', headers }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
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


// Competitive Report module
const competitiveReport = require('../gmb/competitiveReport');

// Add competitive report endpoint
// Override export
module.exports = { handleRoute: handleRouteWithGmb };

// Patch handleRouteWithGmb to include competitive report route
const _originalHandleRouteWithGmb = handleRouteWithGmb;
async function handleRouteWithCompetitive(req, res, body) {
  const result = await _originalHandleRouteWithGmb(req, res, body);
  if (result !== null) return result;

  const url    = req.url.split('?')[0];
  const method = req.method;
  let parsed   = {};
  try { if (body) parsed = JSON.parse(body); } catch(_) {}

  // ── Competitive Report: generate (with caching + AI insights) ───────────────
  if (method === 'POST' && url === '/api/competitive/report') {
    const org = requireAuth(req);
    if (!org) return json(res, 401, { error: 'Not authenticated' });
    // Expect org to have businessName and location (lat, lng)
    const { businessName, lat, lng, type, forceRefresh } = parsed;
    if (!businessName || !lat || !lng) {
      return json(res, 400, { error: 'businessName, lat, lng required' });
    }
    try {
      let report, cached = false, updatedAt = null;
      if (!forceRefresh) {
        const cachedObj = db.getCompetitiveReport(org.id);
        if (cachedObj && cachedObj.report) {
          report = cachedObj.report;
          cached = true;
          updatedAt = cachedObj.updatedAt;
        }
      }
      if (!report) {
        report = await competitiveReport.generateCompetitiveReport(businessName, type || 'restaurant', lat, lng);
        db.saveCompetitiveReport(org.id, report);
        cached = false;
      }
      // Call AI insights endpoint (internal call)
      let aiInsights = null;
      // console.log('Generating AI insights for competitive report...' + JSON.stringify(report));
      try {
        aiInsights = await getCompetitiveAiInsights(report, org);
      } catch (e) {
        console.error('Error generating AI insights:', e.message);
        aiInsights = { summary: 'AI analysis unavailable', suggestions: [] };
      }
      return json(res, 200, { report, aiInsights, cached, updatedAt });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  return null;
}

module.exports = { handleRoute: handleRouteWithCompetitive };
