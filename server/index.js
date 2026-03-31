// ── index.js ── Main server entry point ──────────────────────────────
// Load environment variables from .env file

const http = require('http');
const fs   = require('fs');
const path = require('path');

const { handleRoute }    = require('./routes/routes');
const { startScheduler } = require('./scheduler/scheduler');

require('./dotenv-load');
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html', '.css': 'text/css',
  '.js': 'application/javascript', '.json': 'application/json',
  '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml'
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const body = await readBody(req);

  // Try API routes first
  const handled = await handleRoute(req, res, body).catch(err => {
    console.error('[Server] Route error:', err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
    return true;
  });

  if (handled !== null) return; // API route handled it

  // Static file serving
  let urlPath = req.url.split('?')[0];

  // SPA-style routing: redirect auth pages
  if (urlPath === '/login' || urlPath === '/login.html') urlPath = '/login.html';
  else if (urlPath === '/register' || urlPath === '/register.html') urlPath = '/register.html';
  else if (urlPath === '/dashboard' || urlPath === '/dashboard.html') urlPath = '/dashboard.html';
  else if (urlPath === '/onboarding' || urlPath === '/onboarding.html') urlPath = '/onboarding.html';
  else if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(__dirname, '..', 'public', urlPath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Fallback: serve index.html for unknown routes
      fs.readFile(path.join(__dirname, '..', 'public', 'index.html'), (err2, d2) => {
        if (err2) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(d2);
      });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n🍽  RestaurantIQ SaaS Platform`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅  Server         → http://localhost:${PORT}`);
  console.log(`🔑  Anthropic key  → ${process.env.ANTHROPIC_API_KEY ? '✓ Set' : '✗ NOT SET — set ANTHROPIC_API_KEY'}`);
  console.log(`🗺   Maps key      → ${process.env.GOOGLE_MAPS_API_KEY ? '✓ Set' : '✗ NOT SET — set GOOGLE_MAPS_API_KEY'}`);
  console.log(`📧  Email          → ${process.env.EMAIL_FROM || '✗ NOT SET — set EMAIL_FROM + EMAIL_PASS'}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`\nPages:`);
  console.log(`  /            → Landing page`);
  console.log(`  /login       → Login`);
  console.log(`  /register    → Sign up`);
  console.log(`  /dashboard   → Org dashboard\n`);
  startScheduler();
});
