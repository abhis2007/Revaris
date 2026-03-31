// ── mailer.js ── Weekly digest email sender ───────────────────────────
const https = require('https');

// Config — uses Gmail SMTP via nodemailer or a simple HTTPS approach
// For simplicity this uses nodemailer which is installed via npm
let nodemailer;
try { nodemailer = require('nodemailer'); } catch(_) { nodemailer = null; }

const EMAIL_FROM = process.env.EMAIL_FROM || 'hello@Revaris.co.in';
const EMAIL_PASS = process.env.EMAIL_PASS || '';
const EMAIL_HOST = process.env.EMAIL_HOST || 'smtp.gmail.com';
const EMAIL_PORT = parseInt(process.env.EMAIL_PORT || '587');

function getTransporter() {
  if (!nodemailer) throw new Error('nodemailer not installed. Run: npm install');
  return nodemailer.createTransport({
    host: EMAIL_HOST,
    port: EMAIL_PORT,
    secure: EMAIL_PORT === 465,
    auth: { user: EMAIL_FROM, pass: EMAIL_PASS }
  });
}

// ── Build beautiful HTML email ────────────────────────────────────────
function buildEmailHTML(org, digestData) {
  const { insight, place, businessName, weekNumber } = digestData;
  const sentimentColor = {
    positive: '#4ade80', neutral: '#fbbf24', negative: '#f87171'
  }[insight.rating_summary?.sentiment] || '#fbbf24';

  const trendIcon = {
    improving: '📈', stable: '➡️', declining: '📉'
  }[insight.rating_summary?.trend] || '➡️';

  const issuesHtml = (insight.unaddressed_issues || []).map((issue, i) => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #2a2a35">
        <span style="color:#e8436a;font-weight:700;margin-right:8px">#${i+1}</span>
        <span style="color:#c0bfd0;font-size:14px">${escHtml(issue)}</span>
      </td>
    </tr>`).join('');

  const actionsHtml = (insight.action_items || []).map(a => {
    const pColor = { high:'#f87171', medium:'#fbbf24', low:'#4ade80' }[a.priority] || '#fbbf24';
    return `
    <div style="background:#1a1a24;border-left:3px solid ${pColor};border-radius:0 8px 8px 0;padding:12px 16px;margin-bottom:10px">
      <div style="font-size:10px;font-weight:700;color:${pColor};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px">${a.priority} priority</div>
      <div style="color:#e0dff0;font-size:14px;margin-bottom:4px">${escHtml(a.action)}</div>
      <div style="color:#65647a;font-size:12px">Expected: ${escHtml(a.expected_impact)}</div>
    </div>`;
  }).join('');

  const positivesHtml = (insight.top_positives || []).map(p =>
    `<li style="color:#4ade80;font-size:14px;padding:4px 0">${escHtml(p)}</li>`
  ).join('');

  const reviewsHtml = (place.recent_reviews || []).slice(0, 3).map(r => {
    const stars = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
    return `
    <div style="background:#1a1a24;border-radius:8px;padding:12px 16px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <span style="color:#e0dff0;font-size:13px;font-weight:600">${escHtml(r.author || 'Anonymous')}</span>
        <span style="color:#fbbf24;font-size:12px">${stars}</span>
      </div>
      <p style="color:#9897a9;font-size:13px;margin:0;line-height:1.5">${escHtml(r.text || '')}</p>
      <div style="color:#45445a;font-size:11px;margin-top:6px">${escHtml(r.time_ago || '')}</div>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0e0e10;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:24px 16px">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#1a1a24,#13131c);border:1px solid rgba(255,255,255,0.08);border-radius:16px;padding:28px;margin-bottom:16px;text-align:center">
      <div style="font-size:28px;margin-bottom:8px">🍽</div>
      <div style="font-size:11px;font-weight:700;letter-spacing:0.15em;color:#65647a;text-transform:uppercase;margin-bottom:8px">Revaris Weekly Digest</div>
      <h1 style="margin:0;font-size:22px;font-weight:700;color:#f0eff4">${escHtml(businessName)}</h1>
      <div style="margin-top:6px;font-size:13px;color:#65647a">Week ${weekNumber} · ${new Date().toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' })}</div>
    </div>

    <!-- Executive Summary -->
    <div style="background:#13131c;border:1px solid rgba(245,166,35,0.2);border-left:3px solid #f5a623;border-radius:0 12px 12px 0;padding:16px 20px;margin-bottom:16px">
      <div style="font-size:10px;font-weight:700;color:#f5a623;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px">Executive Summary</div>
      <p style="margin:0;color:#c0bfd0;font-size:14px;line-height:1.6">${escHtml(insight.executive_summary || '')}</p>
    </div>

    <!-- Rating Block -->
    <div style="background:#13131c;border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:20px;margin-bottom:16px">
      <div style="font-size:10px;font-weight:700;color:#65647a;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:16px">Rating Overview</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <div style="flex:1;min-width:120px;background:#1a1a24;border-radius:10px;padding:16px;text-align:center">
          <div style="font-size:32px;font-weight:700;color:${sentimentColor}">${place.rating?.toFixed(1) || '—'}</div>
          <div style="font-size:11px;color:#65647a;margin-top:4px">Current Rating</div>
        </div>
        <div style="flex:1;min-width:120px;background:#1a1a24;border-radius:10px;padding:16px;text-align:center">
          <div style="font-size:24px;font-weight:700;color:#e0dff0">${(place.total_reviews || 0).toLocaleString()}</div>
          <div style="font-size:11px;color:#65647a;margin-top:4px">Total Reviews</div>
        </div>
        <div style="flex:1;min-width:120px;background:#1a1a24;border-radius:10px;padding:16px;text-align:center">
          <div style="font-size:24px">${trendIcon}</div>
          <div style="font-size:12px;font-weight:600;color:${sentimentColor};margin-top:4px;text-transform:capitalize">${insight.rating_summary?.trend || 'stable'}</div>
          <div style="font-size:11px;color:#65647a;margin-top:2px">Trend</div>
        </div>
      </div>
      ${insight.rating_summary?.trend_reason ? `<p style="margin:12px 0 0;font-size:12px;color:#65647a;font-style:italic">${escHtml(insight.rating_summary.trend_reason)}</p>` : ''}
    </div>

    <!-- Unaddressed Issues -->
    ${issuesHtml ? `
    <div style="background:#13131c;border:1px solid rgba(232,67,106,0.15);border-radius:12px;padding:20px;margin-bottom:16px">
      <div style="font-size:10px;font-weight:700;color:#e8436a;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px">⚠ Unaddressed Issues — Action Required</div>
      <table style="width:100%;border-collapse:collapse">${issuesHtml}</table>
    </div>` : ''}

    <!-- Action Items -->
    ${actionsHtml ? `
    <div style="background:#13131c;border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:20px;margin-bottom:16px">
      <div style="font-size:10px;font-weight:700;color:#65647a;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px">🎯 Recommended Actions This Week</div>
      ${actionsHtml}
    </div>` : ''}

    <!-- What's Working -->
    ${positivesHtml ? `
    <div style="background:#13131c;border:1px solid rgba(74,222,128,0.1);border-radius:12px;padding:20px;margin-bottom:16px">
      <div style="font-size:10px;font-weight:700;color:#4ade80;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:10px">✅ What Customers Love</div>
      <ul style="margin:0;padding-left:20px">${positivesHtml}</ul>
    </div>` : ''}

    <!-- Recent Reviews -->
    ${reviewsHtml ? `
    <div style="background:#13131c;border:1px solid rgba(255,255,255,0.07);border-radius:12px;padding:20px;margin-bottom:16px">
      <div style="font-size:10px;font-weight:700;color:#65647a;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px">🗨 Recent Customer Reviews</div>
      ${reviewsHtml}
    </div>` : ''}

    <!-- Competitor Alert -->
    ${insight.competitor_alert ? `
    <div style="background:#13131c;border:1px solid rgba(251,191,36,0.2);border-radius:12px;padding:16px 20px;margin-bottom:16px">
      <div style="font-size:10px;font-weight:700;color:#fbbf24;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px">🔍 Competitor Mention</div>
      <p style="margin:0;color:#c0bfd0;font-size:13px">${escHtml(insight.competitor_alert)}</p>
    </div>` : ''}

    <!-- Footer -->
    <div style="text-align:center;padding:20px 0;border-top:1px solid rgba(255,255,255,0.06);margin-top:8px">
      <p style="color:#45445a;font-size:12px;margin:0">You are receiving this because ${escHtml(org.name)} subscribed to Revaris.</p>
      <p style="color:#45445a;font-size:11px;margin:6px 0 0">© ${new Date().getFullYear()} Revaris · Weekly digest sent every Monday</p>
    </div>

  </div>
</body>
</html>`;
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Send email ────────────────────────────────────────────────────────
async function sendDigestEmail(org, digestData) {
  if (!nodemailer) {
    console.log('[Mailer] nodemailer not available — skipping email send');
    return false;
  }
  if (!EMAIL_PASS) {
    console.log('[Mailer] EMAIL_PASS not set — skipping email send');
    return false;
  }

  try {
    const transporter = getTransporter();
    const html = buildEmailHTML(org, digestData);

    await transporter.sendMail({
      from: `"Revaris" <${EMAIL_FROM}>`,
      to: org.email,
      subject: `📊 Weekly Digest: ${digestData.businessName} — Week ${digestData.weekNumber}`,
      html
    });

    console.log(`[Mailer] Digest sent to ${org.email}`);
    return true;
  } catch (err) {
    console.error(`[Mailer] Failed to send to ${org.email}:`, err.message);
    return false;
  }
}

module.exports = { sendDigestEmail, buildEmailHTML };
