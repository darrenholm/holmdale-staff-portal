'use strict';

// Room-code service for the Walkerton Livery.
//
// Holds the TTLock credentials server-side (they must never reach a browser)
// and exposes a small JSON API plus the single-page UI in ./public.
//
// Run:  node ttlock/server.js       (reads ttlock/.env if present)
// Deps: none -- Node 18+ built-ins only.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { TTLockClient, TTLockError, UNUSED_GRACE_MS } = require('./ttlock-api');

// ---------------------------------------------------------------- config ---

function loadEnvFile(file) {
    let text;
    try {
        text = fs.readFileSync(file, 'utf8');
    } catch {
        return;
    }
    for (const line of text.split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
        if (!m) continue;
        if (process.env[m[1]] !== undefined) continue; // real env wins
        process.env[m[1]] = m[2].trim().replace(/^["'](.*)["']$/, '$1');
    }
}

loadEnvFile(path.join(__dirname, '.env'));

function required(name) {
    const v = process.env[name];
    if (!v) {
        console.error(`Missing required env var ${name}. See ttlock/.env.example`);
        process.exit(1);
    }
    return v;
}

const PORT = Number(process.env.PORT || 8080);
const STAFF_PASSWORD = required('STAFF_PASSWORD');
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_HOURS = Number(process.env.SESSION_HOURS || 12);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);

// Default check-in/check-out hours, 24h clock. TTLock requires whole hours.
const CHECKIN_HOUR = Number(process.env.CHECKIN_HOUR || 15);
const CHECKOUT_HOUR = Number(process.env.CHECKOUT_HOUR || 11);

const ttlock = new TTLockClient({
    baseUrl: process.env.TTLOCK_BASE_URL,
    clientId: required('TTLOCK_CLIENT_ID'),
    clientSecret: required('TTLOCK_CLIENT_SECRET'),
    username: required('TTLOCK_USERNAME'),
    password: required('TTLOCK_PASSWORD'),
});

// ------------------------------------------------------------- sessions ---

function sign(value) {
    return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
}

function issueSession() {
    const exp = String(Date.now() + SESSION_HOURS * 3600 * 1000);
    return `${exp}.${sign(exp)}`;
}

function validSession(token) {
    if (typeof token !== 'string') return false;
    const [exp, sig] = token.split('.');
    if (!exp || !sig) return false;
    const expected = sign(exp);
    // Compare as fixed-length buffers so the check is constant-time.
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    return Number(exp) > Date.now();
}

// Crude but sufficient brute-force brake for a single-tenant tool.
const loginAttempts = new Map();
function loginAllowed(ip) {
    const now = Date.now();
    const rec = loginAttempts.get(ip);
    if (!rec || now > rec.resetAt) {
        loginAttempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
        return true;
    }
    rec.count += 1;
    return rec.count <= 10;
}

function passwordMatches(supplied) {
    const a = Buffer.from(String(supplied ?? ''));
    const b = Buffer.from(STAFF_PASSWORD);
    // timingSafeEqual throws on length mismatch, so hash first to equalise.
    const ha = crypto.createHash('sha256').update(a).digest();
    const hb = crypto.createHash('sha256').update(b).digest();
    return crypto.timingSafeEqual(ha, hb);
}

// ----------------------------------------------------------------- dates ---

// TTLock only honours whole hours in a passcode window -- minutes and seconds
// must be zero, otherwise the code silently works over a different range than
// the one shown in the app.
function floorToHour(ms) {
    const d = new Date(ms);
    d.setMinutes(0, 0, 0);
    return d.getTime();
}

// ------------------------------------------------------------- http glue ---

function send(res, status, body, extraHeaders = {}) {
    const payload = Buffer.from(JSON.stringify(body));
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': payload.length,
        'Cache-Control': 'no-store',
        ...extraHeaders,
    });
    res.end(payload);
}

function readJson(req, limit = 64 * 1024) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (c) => {
            size += c.length;
            if (size > limit) {
                reject(new Error('Request body too large'));
                req.destroy();
                return;
            }
            chunks.push(c);
        });
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            if (!raw) return resolve({});
            try {
                resolve(JSON.parse(raw));
            } catch {
                reject(new Error('Invalid JSON body'));
            }
        });
        req.on('error', reject);
    });
}

function corsHeaders(req) {
    const origin = req.headers.origin;
    if (!origin || !ALLOWED_ORIGINS.includes(origin)) return {};
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Vary': 'Origin',
    };
}

function bearer(req) {
    const h = req.headers.authorization || '';
    return h.startsWith('Bearer ') ? h.slice(7) : null;
}

// ------------------------------------------------------------ api routes ---

// Locks change rarely; a short cache keeps the room list snappy without
// letting a rename go stale for long.
let lockCache = { at: 0, rooms: [] };
const LOCK_CACHE_MS = 5 * 60 * 1000;

async function getRooms({ force = false } = {}) {
    if (!force && Date.now() - lockCache.at < LOCK_CACHE_MS) return lockCache.rooms;

    const { list } = await ttlock.listLocks({ pageSize: 200 });
    const rooms = list.map(l => ({
        lockId: l.lockId,
        name: l.lockAlias || l.lockName || `Lock ${l.lockId}`,
        keyboardPwdVersion: l.keyboardPwdVersion,
        battery: l.electricQuantity,
        hasGateway: l.hasGateway === 1,
    })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    lockCache = { at: Date.now(), rooms };
    return rooms;
}

const routes = {
    'POST /api/login': async (req, res, ctx) => {
        if (!loginAllowed(ctx.ip)) {
            return send(res, 429, { error: 'Too many attempts. Wait 15 minutes.' }, ctx.cors);
        }
        const body = await readJson(req);
        if (!passwordMatches(body.password)) {
            return send(res, 401, { error: 'Wrong password' }, ctx.cors);
        }
        loginAttempts.delete(ctx.ip);
        send(res, 200, { token: issueSession(), defaults: { checkinHour: CHECKIN_HOUR, checkoutHour: CHECKOUT_HOUR } }, ctx.cors);
    },

    'GET /api/rooms': async (req, res, ctx) => {
        const force = ctx.url.searchParams.get('refresh') === '1';
        send(res, 200, { rooms: await getRooms({ force }) }, ctx.cors);
    },

    'GET /api/passcodes': async (req, res, ctx) => {
        const lockId = Number(ctx.url.searchParams.get('lockId'));
        if (!lockId) return send(res, 400, { error: 'lockId is required' }, ctx.cors);

        const { list } = await ttlock.listPasscodes(lockId, { pageSize: 100 });
        const now = Date.now();
        const codes = list
            // Period codes are the only kind this tool issues; showing the
            // permanent/one-time ones set from the app would invite deleting
            // something the owner relies on.
            .filter(p => p.keyboardPwdType === 3)
            .map(p => ({
                keyboardPwdId: p.keyboardPwdId,
                passcode: p.keyboardPwd,
                name: p.keyboardPwdName || '',
                startDate: p.startDate,
                endDate: p.endDate,
                expired: p.endDate > 0 && p.endDate < now,
                active: p.startDate <= now && (p.endDate === 0 || p.endDate > now),
            }))
            .sort((a, b) => b.startDate - a.startDate);

        send(res, 200, { codes }, ctx.cors);
    },

    'POST /api/passcode': async (req, res, ctx) => {
        const body = await readJson(req);
        const lockId = Number(body.lockId);
        const guest = String(body.guest || '').trim();
        let startDate = Number(body.startDate);
        let endDate = Number(body.endDate);

        if (!lockId) return send(res, 400, { error: 'Pick a room' }, ctx.cors);
        if (!guest) return send(res, 400, { error: 'Enter a guest name' }, ctx.cors);
        if (!Number.isFinite(startDate) || !Number.isFinite(endDate)) {
            return send(res, 400, { error: 'Check-in and check-out dates are required' }, ctx.cors);
        }

        startDate = floorToHour(startDate);
        endDate = floorToHour(endDate);
        if (endDate <= startDate) {
            return send(res, 400, { error: 'Check-out must be after check-in' }, ctx.cors);
        }

        const rooms = await getRooms();
        const room = rooms.find(r => r.lockId === lockId);
        if (!room) return send(res, 404, { error: 'That room is no longer in the TTLock account' }, ctx.cors);

        const { keyboardPwd, keyboardPwdId } = await ttlock.generatePeriodPasscode({
            lockId,
            keyboardPwdVersion: room.keyboardPwdVersion,
            name: guest,
            startDate,
            endDate,
        });

        send(res, 200, {
            passcode: keyboardPwd,
            keyboardPwdId,
            room: room.name,
            guest,
            startDate,
            endDate,
            // The lock drops an unused period code 24h after its start time.
            useByDate: startDate + UNUSED_GRACE_MS,
        }, ctx.cors);
    },

    'POST /api/passcode/delete': async (req, res, ctx) => {
        const body = await readJson(req);
        const lockId = Number(body.lockId);
        const keyboardPwdId = Number(body.keyboardPwdId);
        if (!lockId || !keyboardPwdId) {
            return send(res, 400, { error: 'lockId and keyboardPwdId are required' }, ctx.cors);
        }

        const rooms = await getRooms();
        const room = rooms.find(r => r.lockId === lockId);
        // Without a gateway TTLock cannot reach the lock over the internet, so
        // ask for a Bluetooth delete and tell the caller what that means.
        const deleteType = room && room.hasGateway ? 2 : 1;

        await ttlock.deletePasscode({ lockId, keyboardPwdId, deleteType });
        send(res, 200, { ok: true, needsBluetooth: deleteType === 1 }, ctx.cors);
    },
};

const PUBLIC_ROUTES = new Set(['POST /api/login']);

// ---------------------------------------------------------- static files ---

const STATIC_DIR = path.join(__dirname, 'public');
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = path.join(STATIC_DIR, rel);
    // Refuse anything that escapes the static root.
    if (!file.startsWith(STATIC_DIR + path.sep)) {
        res.writeHead(403).end('Forbidden');
        return;
    }
    fs.readFile(file, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
            return;
        }
        res.writeHead(200, {
            'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
            'Content-Length': data.length,
            'Cache-Control': 'no-cache',
        });
        res.end(data);
    });
}

// ----------------------------------------------------------------- server ---

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const cors = corsHeaders(req);
    const ip = req.socket.remoteAddress || 'unknown';

    if (req.method === 'OPTIONS') {
        res.writeHead(204, cors).end();
        return;
    }

    const key = `${req.method} ${url.pathname}`;
    const handler = routes[key];

    if (!handler) {
        if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
            return serveStatic(req, res, url.pathname);
        }
        return send(res, 404, { error: 'Not found' }, cors);
    }

    if (!PUBLIC_ROUTES.has(key) && !validSession(bearer(req))) {
        return send(res, 401, { error: 'Session expired' }, cors);
    }

    try {
        await handler(req, res, { url, cors, ip });
    } catch (err) {
        if (err instanceof TTLockError) {
            console.error(`TTLock ${err.errcode}: ${err.message}`);
            return send(res, 502, { error: `TTLock: ${err.message}`, errcode: err.errcode }, cors);
        }
        console.error(err);
        send(res, 500, { error: err.message || 'Server error' }, cors);
    }
});

server.listen(PORT, () => {
    console.log(`Room codes running on http://localhost:${PORT}`);
    console.log(`TTLock API: ${ttlock.baseUrl}  account: ${ttlock.username}`);
});
