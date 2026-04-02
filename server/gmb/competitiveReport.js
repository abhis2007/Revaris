// server/gmb/competitiveReport.js
// Competitive Analysis Module for Restaurant SaaS

const axios = require('axios');
require('../dotenv-load');
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_MAPS_API_KEY; // Ensure this is set in your environment variables

/**
 * Find nearby competitors using Google Places API (fetch up to 60, filter top 10 by rating, open now, etc.)
 * @param {string} businessName
 * @param {string} type - e.g., 'restaurant'
 * @param {number} lat
 * @param {number} lng
 * @param {number} radius - in meters
 * @param {object} options - { keyword, minRating, opennow }
 */
async function findNearbyCompetitors(businessName, type, lat, lng, radius = 2000, options = {}) {
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json`;
  const params = {
    location: `${lat},${lng}`,
    radius,
    type,
    key: GOOGLE_PLACES_API_KEY,
    ...options.keyword && { keyword: options.keyword }
  };
  let allResults = [];
  let pagetoken;
  let page = 0;
  do {
    const query = pagetoken ? { pagetoken, key: GOOGLE_PLACES_API_KEY } : params;
    const res = await axios.get(url, { params: query });
    console.log(`Fetched page ${page + 1} of competitors: ${res.data.results.length} results`);
    let results = res.data.results || [];
    // Filter out the owner's business by name
    // results = results.filter(place => place.name !== businessName);
    allResults = allResults.concat(results);
    pagetoken = res.data.next_page_token;
    page++;
    if (pagetoken) await new Promise(r => setTimeout(r, 2200)); // Google requires a short delay
  } while (pagetoken && allResults.length < 60 && page < 3);
  // Filter by rating if specified
  let filtered = allResults.filter(place => (place.rating || 0) >= (options.minRating || 0));
  // Sort by rating desc, then reviews desc
//   filtered.sort((a, b) => (b.rating - a.rating) || (b.user_ratings_total - a.user_ratings_total));
  // Return top 10
    return filtered;
}

/**
 * Fetch reviews for a place using Google Places Details API
 * @param {string} placeId
 */
async function fetchPlaceReviews(placeId) {
  const url = `https://maps.googleapis.com/maps/api/place/details/json`;
  const params = {
    place_id: placeId,
    fields: 'name,rating,user_ratings_total,reviews',
    key: GOOGLE_PLACES_API_KEY
  };
  const res = await axios.get(url, { params });
  return res.data.result;
}

/**
 * Analyze competitors and generate a report
 * @param {string} businessName
 * @param {string} type
 * @param {number} lat
 * @param {number} lng
 */
async function generateCompetitiveReport(businessName, type, lat, lng) {
  const competitors = await findNearbyCompetitors(businessName, type, lat, lng);
  const report = [];
  for (const comp of competitors) {
    const details = await fetchPlaceReviews(comp.place_id);
    report.push({
      name: details.name,
      rating: details.rating,
      totalReviews: details.user_ratings_total,
      recentReviews: details.reviews ? details.reviews.slice(0, 5) : []
    });
  }
  // Sort by totalReviews (proxy for footfall)
  report.sort((a, b) => b.totalReviews - a.totalReviews);
//   report.sort((a, b) => b.rating - a.rating);
  return report.slice(0, 10);
}

module.exports = {
  findNearbyCompetitors,
  fetchPlaceReviews,
  generateCompetitiveReport
};
