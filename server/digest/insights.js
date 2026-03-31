// ── insights.js ── Google Maps + Claude insight pipeline ─────────────
const https = require('https');
require('../dotenv-load');
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || 'YOUR_ANTHROPIC_KEY';
const MAPS_KEY      = process.env.GOOGLE_MAPS_API_KEY || 'YOUR_MAPS_KEY';

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse: ' + data.slice(0, 200))); }
      });
    }).on('error', reject);
  });
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


// ── Fallback insight when Claude fails ────────────────────────────────
function getFallbackInsight(place) {
  const rating = place.rating || 0;
  const sentiment = rating >= 4 ? 'positive' : rating >= 3 ? 'neutral' : 'negative';
  const trend = 'stable';
  const reviews = place.reviews || [];

  return {
    rating_summary: {
      current: rating,
      total_reviews: place.user_ratings_total || 0,
      sentiment: sentiment,
      trend: trend,
      trend_reason: 'Based on current ratings and review volume'
    },
    unaddressed_issues: [
      'No detailed analysis available - please check reviews manually',
      'Ensure common service issues are being addressed',
      'Monitor staff responsiveness to complaints'
    ],
    top_positives: [
      'Generally positive customer feedback',
      'Consistent ratings indicate stable service quality'
    ],
    weekly_highlights: [
      reviews.length > 0 ? `${reviews.length} new reviews received` : 'No new reviews this week'
    ],
    competitor_alert: null,
    action_items: [
      {
        priority: 'medium',
        action: 'Review recent customer feedback and response strategies',
        expected_impact: 'Better understanding of customer needs and satisfaction'
      },
      {
        priority: 'low',
        action: 'Continue monitoring rating trends',
        expected_impact: 'Early detection of service quality changes'
      }
    ],
    executive_summary: `${place.name} has a rating of ${rating}/5 based on ${place.user_ratings_total || 0} reviews. Detailed AI analysis was unavailable this week, but the establishment maintains steady customer engagement. Please review recent feedback directly to identify improvement opportunities.`
  };
}



// ── Fetch a single place by placeId ──────────────────────────────────
async function fetchPlaceDetails(placeId) {
  const fields = 'name,formatted_address,rating,user_ratings_total,price_level,reviews,types,formatted_phone_number,opening_hours,website,place_id';
  const url = `https://maps.googleapis.com/maps/api/place/details/json`
            + `?place_id=${placeId}&fields=${fields}&key=${MAPS_KEY}`;
  const result = await httpsGet(url);
  if (!result.result) throw new Error('Place not found for ID: ' + placeId);
  return result.result;
}

// ── Search for a place by name + location ─────────────────────────────
async function searchPlace(businessName, location) {
  const query = encodeURIComponent(`${businessName} ${location}`);
  const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json`
            + `?input=${query}&inputtype=textquery`
            + `&fields=place_id,name,formatted_address,rating`
            + `&key=${MAPS_KEY}`;
  const result = await httpsGet(url);
  if (!result.candidates || result.candidates.length === 0) {
    throw new Error('No place found for: ' + businessName);
  }
  return result.candidates[0];
}

// ── Claude: generate full weekly insight for a restaurant ─────────────
async function generateInsightWithClaude(place) {
  const reviews = (place.reviews || []);
  const reviewTexts = reviews.length > 0
    ? reviews.map((r, i) => `Review ${i+1} (${r.rating}★ by ${r.author_name}): "${r.text}"`).join('\n')
    : 'No reviews available this week.';

  const prompt = `You are a restaurant business intelligence analyst generating a weekly digest report.

Restaurant: "${place.name}"
Location: ${place.formatted_address || 'N/A'}
Current Rating: ${place.rating || 'N/A'} / 5
Total Reviews: ${place.user_ratings_total || 0}

Latest Reviews:
${reviewTexts}

Generate a comprehensive weekly insight report. Return ONLY valid JSON (no markdown):
{
  "rating_summary": {
    "current": ${place.rating || 0},
    "total_reviews": ${place.user_ratings_total || 0},
    "sentiment": "positive|neutral|negative",
    "trend": "improving|stable|declining",
    "trend_reason": "one sentence explanation"
  },
  "unaddressed_issues": [
    "Issue 1 description",
    "Issue 2 description",
    "Issue 3 description"
  ],
  "top_positives": [
    "What customers love 1",
    "What customers love 2"
  ],
  "weekly_highlights": [
    "Notable mention from reviews this week"
  ],
  "competitor_alert": "Any mention of competitors in reviews, or null",
  "action_items": [
    {
      "priority": "high|medium|low",
      "action": "Specific action to take",
      "expected_impact": "What improvement this will drive"
    }
  ],
  "executive_summary": "2-3 sentence plain English summary of the week for the business owner"
}`;

  const bodyStr = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1200,
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
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(result.body.message || 'No JSON found in Claude response');
  return JSON.parse(match[0]);
}

// ── Main: generate full digest for one org ────────────────────────────
async function generateDigestForOrg(org) {
  let place;

  // Use saved placeId if available, otherwise search by name
  if (org.placeId) {
    place = await fetchPlaceDetails(org.placeId);
  } else {
    const found = await searchPlace(org.businessName, org.location);
    place = await fetchPlaceDetails(found.place_id);
  }

  let insight = null;
  try{
    insight = await generateInsightWithClaude(place);
  }catch(err) {
    console.error('Claude insight generation failed:', err.message);
    //hardcode for now
    insight = getFallbackInsight(place);
    console.log('Using fallback insight:', insight);
  }

  return {
    orgId: org.id,
    businessName: place.name,
    location: place.formatted_address,
    generatedAt: new Date().toISOString(),
    weekNumber: getWeekNumber(),
    place: {
      rating: place.rating,
      total_reviews: place.user_ratings_total,
      phone: place.formatted_phone_number,
      website: place.website,
      open_now: place.opening_hours?.open_now ?? null,
      maps_url: `https://www.google.com/maps/place/?q=place_id:${place.place_id}`,
      recent_reviews: (place.reviews || []).map(r => ({
        author: r.author_name,
        rating: r.rating,
        text: r.text,
        time_ago: r.relative_time_description
      }))
    },
    insight
  };
}

function getWeekNumber() {
  const d = new Date();
  const startOfYear = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
}

module.exports = { generateDigestForOrg, searchPlace, fetchPlaceDetails };
