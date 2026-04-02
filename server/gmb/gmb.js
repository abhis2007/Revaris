// ── gmb.js ── Google OAuth + My Business Account Management API ───────
const https = require('https');
const db    = require('../db/store');

require('../dotenv-load');
const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI  = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/oauth/callback';

// ── OAuth Scopes needed ───────────────────────────────────────────────
const SCOPES = [
  'https://www.googleapis.com/auth/business.manage',  // GMB read/write
  'profile',
  'email'
].join(' ');

// ── Step 1: Build Google OAuth consent URL ────────────────────────────
function buildAuthUrl(orgId) {
  console.log('clientId', CLIENT_ID);
  console.log('redirectUri', REDIRECT_URI);
  console.log('clientSecret', CLIENT_SECRET);
  const params = new URLSearchParams({
    client_id:     CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: 'code',
    scope:         SCOPES,
    access_type:   'offline',   // get refresh_token
    prompt:        'consent',   // force refresh_token every time
    state:         orgId        // pass orgId through OAuth flow
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// ── Step 2: Exchange code for tokens ──────────────────────────────────
async function exchangeCodeForTokens(code) {
  const body = new URLSearchParams({
    code,
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri:  REDIRECT_URI,
    grant_type:    'authorization_code'
  }).toString();

  const result = await httpsPost('oauth2.googleapis.com', '/token',
    { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    body
  );

  const data = JSON.parse(result.body);
  if (data.error) throw new Error(`Token exchange failed: ${data.error_description || data.error}`);
  return data; // { access_token, refresh_token, expires_in, token_type }
}

// ── Step 3: Refresh access token using refresh_token ──────────────────
async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type:    'refresh_token'
  }).toString();

  const result = await httpsPost('oauth2.googleapis.com', '/token',
    { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    body
  );

  const data = JSON.parse(result.body);
  if (data.error) throw new Error(`Token refresh failed: ${data.error_description || data.error}`);
  return data.access_token;
}

// ── Get a valid access token (refresh if needed) ──────────────────────
async function getValidAccessToken(org) {
  const tokens = db.getGmbTokens(org.id);
  if (!tokens) throw new Error('Business not connected. Please connect via Google OAuth first.');

  // Check if token is expired (with 5 min buffer)
  const expiresAt = new Date(tokens.expiresAt).getTime();
  const now       = Date.now();

  if (now < expiresAt - 300000) {
    return tokens.accessToken; // still valid
  }

  // Refresh it
  const newAccessToken = await refreshAccessToken(tokens.refreshToken);
  db.saveGmbTokens(org.id, {
    ...tokens,
    accessToken: newAccessToken,
    expiresAt:   new Date(Date.now() + 3600 * 1000).toISOString()
  });
  return newAccessToken;
}

// ── GMB API: Fetch accounts ───────────────────────────────────────────
async function fetchAccounts(accessToken) {
  if (process.env.MOCK_MODE === "true") {
    return [
      {
        name: "accounts/123456",
        accountName: "Demo Business Group",
        type: "PERSONAL"
      }
    ];
  }

  const result = await httpsGet(
    'mybusinessaccountmanagement.googleapis.com',
    '/v1/accounts',
    accessToken
  );
  const data = JSON.parse(result);
  return data.accounts || [];
}

// ── GMB API: Fetch locations for an account ───────────────────────────
async function fetchLocations(accountName, accessToken) {
  // accountName format: "accounts/123456789"
  if (process.env.MOCK_MODE === "true") {
    return [
      {
        name: "locations/111",
        title: "Demo Restaurant Noida",
        metadata: {
          placeId: "demo-place-id-1"
        }
      }
    ];
  }
  const result = await httpsGet(
    'mybusinessbusinessinformation.googleapis.com',
    `/v1/${accountName}/locations?readMask=name,title,storefrontAddress,websiteUri,regularHours,phoneNumbers`,
    accessToken
  );
  const data = JSON.parse(result);
  return data.locations || [];
}

// ── GMB API: Fetch reviews for a location ─────────────────────────────
async function fetchGmbReviews(accountName, locationId, accessToken) {
  // locationId format: "locations/123456789"
  if (process.env.MOCK_MODE === "true") {
    return [
      {
        reviewId: "r1",
        reviewer: { displayName: "John Doe" },
        comment: "Amazing food and service!",
        starRating: "FIVE"
      },
      {
        reviewId: "r2",
        reviewer: { displayName: "Priya Sharma" },
        comment: "Average experience, slow service.",
        starRating: "THREE"
      },
      {
        reviewId: "r3",
        reviewer: { displayName: "Rahul Verma" },
        comment: "Loved the ambience!",
        starRating: "FOUR"
      }
    ];
  }
  const result = await httpsGet(
    'mybusiness.googleapis.com',
    `/v4/${accountName}/${locationId}/reviews`,
    accessToken
  );
  const data = JSON.parse(result);
  return data.reviews || [];
}

// ── GMB API: Reply to a review ────────────────────────────────────────
async function replyToReview(accountName, locationId, reviewId, replyText, accessToken) {
  const body = JSON.stringify({ comment: replyText });
  const result = await httpsRequest(
    'mybusiness.googleapis.com',
    `/v4/${accountName}/${locationId}/reviews/${reviewId}/reply`,
    'PUT',
    { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    body,
    accessToken
  );
  return JSON.parse(result.body);
}

// ── GMB API: Delete a reply ───────────────────────────────────────────
async function deleteReply(accountName, locationId, reviewId, accessToken) {
  const result = await httpsRequest(
    'mybusiness.googleapis.com',
    `/v4/${accountName}/${locationId}/reviews/${reviewId}/reply`,
    'DELETE',
    {},
    '',
    accessToken
  );
  return result.status === 200;
}

// ── HTTPS helpers ─────────────────────────────────────────────────────
function httpsGet(hostname, path, accessToken) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname, path, method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type':  'application/json'
      }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.end();
  });
}

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method: 'POST', headers }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpsRequest(hostname, path, method, headers, body, accessToken) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname, path, method,
      headers: { 'Authorization': `Bearer ${accessToken}`, ...headers }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

module.exports = {
  buildAuthUrl,
  exchangeCodeForTokens,
  getValidAccessToken,
  fetchAccounts,
  fetchLocations,
  fetchGmbReviews,
  replyToReview,
  deleteReply,
  // For future: competitive report API
};
