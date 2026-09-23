const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL, URLSearchParams } = require('url');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}
const envFile = loadDotEnv(path.join(ROOT, '.env'));
const cfg = { ...envFile, ...process.env };
let runtimeAccessToken = cfg.UPSTOX_ACCESS_TOKEN || '';

const instruments = {
  'NIFTY 50': 'NSE_INDEX|Nifty 50',
  'BANK NIFTY': 'NSE_INDEX|Nifty Bank',
  'RELIANCE': 'NSE_EQ|INE002A01018',
  'TCS': 'NSE_EQ|INE467B01029'
};

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(data);
}

async function getQuotes() {
  if (!runtimeAccessToken) return { ok: false, error: 'UPSTOX_ACCESS_TOKEN is not configured. Use Login with Upstox or set it in .env.' };
  const keys = Object.values(instruments).join(',');
  const endpoint = `https://api.upstox.com/v3/market-quote/quotes?instrument_key=${encodeURIComponent(keys)}`;
  const r = await fetch(endpoint, {
    headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${runtimeAccessToken}` }
  });
  const payload = await r.json().catch(() => ({}));
  if (!r.ok || payload.status !== 'success') {
    const msg = payload?.errors?.[0]?.message || `Upstox returned HTTP ${r.status}`;
    if (r.status === 401) runtimeAccessToken = '';
    return { ok: false, error: msg };
  }
  const result = {};
  const lookup = {};
  for (const [label, key] of Object.entries(instruments)) lookup[key.replace('|', ':')] = label;
  for (const [apiKey, q] of Object.entries(payload.data || {})) {
    const label = lookup[apiKey];
    if (!label) continue;
    result[label] = {
      last_price: Number(q.last_price),
      net_change: Number(q.net_change),
      prev_close_price: Number(q.prev_close_price ?? q.ohlc?.close ?? q.ohlc?.open),
      volume: Number(q.volume || q.ohlc?.volume || 0),
      timestamp: q.timestamp || null
    };
  }
  return { ok: true, data: result, timestamp: new Date().toISOString(), provider: 'Upstox' };
}

async function exchangeCode(code) {
  const clientId = cfg.UPSTOX_CLIENT_ID;
  const clientSecret = cfg.UPSTOX_CLIENT_SECRET;
  const redirectUri = cfg.UPSTOX_REDIRECT_URI || `http://localhost:${PORT}/auth/callback`;
  if (!clientId || !clientSecret) throw new Error('UPSTOX_CLIENT_ID and UPSTOX_CLIENT_SECRET are required for OAuth login.');
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  });
  const r = await fetch('https://api.upstox.com/v2/login/authorization/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body
  });
  const payload = await r.json().catch(() => ({}));
  if (!r.ok || !payload.access_token) throw new Error(payload?.errors?.[0]?.message || `Token exchange failed (HTTP ${r.status})`);
  runtimeAccessToken = payload.access_token;
}

function serveStatic(req, res) {
  let pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  if (pathname === '/') pathname = '/index.html';
  const safe = path.normalize(pathname).replace(/^([.][.][\\/])+/, '');
  const file = path.join(ROOT, safe);
  if (!file.startsWith(ROOT)) return json(res, 403, { error: 'Forbidden' });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return json(res, 404, { error: 'Not found' });
  const ext = path.extname(file).toLowerCase();
  const types = { '.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8' };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (u.pathname === '/api/status') {
      return json(res, 200, {
        liveConfigured: Boolean(runtimeAccessToken),
        oauthConfigured: Boolean(cfg.UPSTOX_CLIENT_ID && cfg.UPSTOX_CLIENT_SECRET),
        provider: 'Upstox'
      });
    }
    if (u.pathname === '/api/quotes') {
      const result = await getQuotes();
      return json(res, result.ok ? 200 : 401, result);
    }
    if (u.pathname === '/auth/login') {
      const clientId = cfg.UPSTOX_CLIENT_ID;
      const redirectUri = cfg.UPSTOX_REDIRECT_URI || `http://localhost:${PORT}/auth/callback`;
      if (!clientId) return json(res, 400, { error: 'Set UPSTOX_CLIENT_ID in .env first.' });
      const login = new URL('https://api.upstox.com/v2/login/authorization/dialog');
      login.searchParams.set('response_type', 'code');
      login.searchParams.set('client_id', clientId);
      login.searchParams.set('redirect_uri', redirectUri);
      login.searchParams.set('state', 'marketpulse');
      res.writeHead(302, { Location: login.toString() });
      return res.end();
    }
    if (u.pathname === '/auth/callback') {
      const code = u.searchParams.get('code');
      if (!code) return json(res, 400, { error: 'Authorization code missing.' });
      await exchangeCode(code);
      res.writeHead(302, { Location: '/' });
      return res.end();
    }
    return serveStatic(req, res);
  } catch (err) {
    console.error(err);
    return json(res, 500, { error: err.message || 'Server error' });
  }
});

server.listen(PORT, () => console.log(`MarketPulse running at http://localhost:${PORT}`));
