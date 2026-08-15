'use strict';

// End-to-end smoke test. Stands up a fake TTLock cloud API, points the real
// server at it, and drives the same calls the browser makes.
//
//   node ttlock/test/smoke.js

const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert');

let passed = 0;
function check(name, fn) {
    try {
        fn();
        passed += 1;
        console.log(`  ok   ${name}`);
    } catch (err) {
        console.error(`  FAIL ${name}\n       ${err.message}`);
        process.exitCode = 1;
    }
}

// ----------------------------------------------------------- fake TTLock ---

const calls = [];
let tokenIssued = 0;
let expireNextCall = false; // forces the one-shot token-refresh retry path

const fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
        const params = Object.fromEntries(new URLSearchParams(body));
        calls.push({ path: req.url, params });
        const reply = (obj) => {
            const s = JSON.stringify(obj);
            res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(s) });
            res.end(s);
        };

        if (req.url === '/oauth2/token') {
            tokenIssued += 1;
            return reply({ access_token: 'tok' + tokenIssued, refresh_token: 'ref', expires_in: 7776000, uid: 1 });
        }

        if (expireNextCall) {
            expireNextCall = false;
            return reply({ errcode: 10003, errmsg: 'invalid token', description: 'token expired' });
        }

        if (req.url === '/v3/lock/list') {
            return reply({
                list: [
                    { lockId: 22, lockAlias: 'Unit 22', lockName: 'L22', keyboardPwdVersion: 4, electricQuantity: 88, hasGateway: 0 },
                    { lockId: 20, lockAlias: 'Unit 20', lockName: 'L20', keyboardPwdVersion: 4, electricQuantity: 19, hasGateway: 1 },
                    { lockId: 21, lockAlias: 'Unit 21', lockName: 'L21', keyboardPwdVersion: 4, electricQuantity: 60, hasGateway: 0 },
                ],
                pageNo: 1, pageSize: 100, pages: 1, total: 3,
            });
        }

        if (req.url === '/v3/keyboardPwd/get') {
            return reply({ keyboardPwd: '739104', keyboardPwdId: 5551 });
        }

        if (req.url === '/v3/lock/listKeyboardPwd') {
            const now = Date.now();
            return reply({
                list: [
                    { keyboardPwdId: 1, keyboardPwd: '111111', keyboardPwdName: 'Dave', keyboardPwdType: 3, startDate: now - 8.64e7, endDate: now + 8.64e7 },
                    { keyboardPwdId: 2, keyboardPwd: '222222', keyboardPwdName: 'Old', keyboardPwdType: 3, startDate: now - 3e8, endDate: now - 2e8 },
                    { keyboardPwdId: 3, keyboardPwd: '333333', keyboardPwdName: 'Owner', keyboardPwdType: 2, startDate: 0, endDate: 0 },
                ],
                pageNo: 1, pageSize: 100, pages: 1, total: 3,
            });
        }

        if (req.url === '/v3/keyboardPwd/delete') {
            return reply({ errcode: 0, errmsg: 'none', description: '' });
        }

        reply({ errcode: 404, errmsg: 'unknown', description: 'unknown endpoint ' + req.url });
    });
});

// ---------------------------------------------------------------- driver ---

function listen(server) {
    return new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
}

function waitFor(url, tries = 60) {
    return new Promise((resolve, reject) => {
        const attempt = (n) => {
            fetch(url).then(resolve).catch(() => {
                if (n <= 0) return reject(new Error('server never came up'));
                setTimeout(() => attempt(n - 1), 100);
            });
        };
        attempt(tries);
    });
}

(async () => {
    const fakePort = await listen(fake);
    const appPort = 8099;
    const base = `http://127.0.0.1:${appPort}`;

    const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
        env: {
            ...process.env,
            PORT: String(appPort),
            STAFF_PASSWORD: 'letmein',
            SESSION_SECRET: 'test-secret',
            CHECKIN_HOUR: '15',
            CHECKOUT_HOUR: '11',
            TTLOCK_BASE_URL: `http://127.0.0.1:${fakePort}`,
            TTLOCK_CLIENT_ID: 'cid',
            TTLOCK_CLIENT_SECRET: 'csecret',
            TTLOCK_USERNAME: 'front@desk',
            TTLOCK_PASSWORD: 'hunter2',
        },
        stdio: ['ignore', 'pipe', 'inherit'],
    });

    const done = () => { child.kill(); fake.close(); };
    process.on('exit', done);

    try {
        await waitFor(base + '/');
        console.log('\nauth');

        let r = await fetch(base + '/api/rooms');
        check('rooms without a session is 401', () => assert.strictEqual(r.status, 401));

        r = await fetch(base + '/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: 'wrong' }),
        });
        check('wrong password is rejected', () => assert.strictEqual(r.status, 401));

        r = await fetch(base + '/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: 'letmein' }),
        });
        const login = await r.json();
        check('correct password returns a token', () => assert.ok(login.token));
        check('login returns house hours', () => assert.strictEqual(login.defaults.checkinHour, 15));

        const auth = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };

        r = await fetch(base + '/api/rooms', { headers: { Authorization: 'Bearer 999.forged' } });
        check('forged session is rejected', () => assert.strictEqual(r.status, 401));

        console.log('\nrooms');
        const { rooms } = await (await fetch(base + '/api/rooms', { headers: auth })).json();
        check('all locks are returned', () => assert.strictEqual(rooms.length, 3));
        check('rooms sort naturally by name', () =>
            assert.deepStrictEqual(rooms.map(x => x.name), ['Unit 20', 'Unit 21', 'Unit 22']));
        check('battery and gateway flags survive', () => {
            assert.strictEqual(rooms[0].battery, 19);
            assert.strictEqual(rooms[0].hasGateway, true);
            assert.strictEqual(rooms[1].hasGateway, false);
        });
        check('client secret never reaches the browser', () =>
            assert.ok(!JSON.stringify(rooms).includes('csecret')));

        const before = calls.length;
        await fetch(base + '/api/rooms', { headers: auth });
        check('repeat room list is served from cache', () => assert.strictEqual(calls.length, before));

        console.log('\npasscode');
        // 14:37 local -- deliberately not on the hour, to prove flooring.
        const start = new Date(2026, 8, 3, 14, 37, 12, 500).getTime();
        const end = new Date(2026, 8, 6, 11, 45, 0, 0).getTime();

        r = await fetch(base + '/api/passcode', {
            method: 'POST', headers: auth,
            body: JSON.stringify({ lockId: 21, guest: 'Dave Miller', startDate: start, endDate: end }),
        });
        const pass = await r.json();
        check('passcode is returned', () => assert.strictEqual(pass.passcode, '739104'));
        check('room name comes back for the message', () => assert.strictEqual(pass.room, 'Unit 21'));

        const gen = calls.filter(c => c.path === '/v3/keyboardPwd/get').pop();
        check('minutes and seconds are floored off both ends', () => {
            assert.strictEqual(new Date(Number(gen.params.startDate)).getMinutes(), 0);
            assert.strictEqual(new Date(Number(gen.params.startDate)).getSeconds(), 0);
            assert.strictEqual(new Date(Number(gen.params.endDate)).getMinutes(), 0);
        });
        check('flooring keeps the intended hour', () =>
            assert.strictEqual(new Date(Number(gen.params.startDate)).getHours(), 14));
        check('period type (3) is used', () => assert.strictEqual(gen.params.keyboardPwdType, '3'));
        check("the lock's keyboardPwdVersion is passed through", () =>
            assert.strictEqual(gen.params.keyboardPwdVersion, '4'));
        check('guest name is sent as the passcode label', () =>
            assert.strictEqual(gen.params.keyboardPwdName, 'Dave Miller'));
        check('24h use-by is reported back', () =>
            assert.strictEqual(pass.useByDate - Number(gen.params.startDate), 86400000));

        console.log('\nvalidation');
        const bad = async (body) => (await fetch(base + '/api/passcode', {
            method: 'POST', headers: auth, body: JSON.stringify(body),
        })).status;
        const s1 = await bad({ guest: 'X', startDate: start, endDate: end });
        const s2 = await bad({ lockId: 21, startDate: start, endDate: end });
        const s3 = await bad({ lockId: 21, guest: 'X', startDate: end, endDate: start });
        const s4 = await bad({ lockId: 999, guest: 'X', startDate: start, endDate: end });
        check('missing lockId -> 400', () => assert.strictEqual(s1, 400));
        check('missing guest -> 400', () => assert.strictEqual(s2, 400));
        check('check-out before check-in -> 400', () => assert.strictEqual(s3, 400));
        check('unknown room -> 404', () => assert.strictEqual(s4, 404));

        console.log('\nexisting codes');
        const { codes } = await (await fetch(base + '/api/passcodes?lockId=21', { headers: auth })).json();
        check('app-made permanent codes are hidden', () => assert.strictEqual(codes.length, 2));
        check('current stay reads as active', () => {
            const c = codes.find(x => x.name === 'Dave');
            assert.strictEqual(c.active, true);
            assert.strictEqual(c.expired, false);
        });
        check('past stay reads as expired', () => {
            const c = codes.find(x => x.name === 'Old');
            assert.strictEqual(c.expired, true);
            assert.strictEqual(c.active, false);
        });
        check('codes sort newest first', () =>
            assert.ok(codes[0].startDate >= codes[1].startDate));

        console.log('\nrevoke');
        let del = await (await fetch(base + '/api/passcode/delete', {
            method: 'POST', headers: auth, body: JSON.stringify({ lockId: 21, keyboardPwdId: 1 }),
        })).json();
        check('gateway-less room asks for a Bluetooth finish', () =>
            assert.strictEqual(del.needsBluetooth, true));
        check('gateway-less room uses deleteType 1', () =>
            assert.strictEqual(calls.filter(c => c.path === '/v3/keyboardPwd/delete').pop().params.deleteType, '1'));

        del = await (await fetch(base + '/api/passcode/delete', {
            method: 'POST', headers: auth, body: JSON.stringify({ lockId: 20, keyboardPwdId: 1 }),
        })).json();
        check('gateway room revokes remotely', () => assert.strictEqual(del.needsBluetooth, false));
        check('gateway room uses deleteType 2', () =>
            assert.strictEqual(calls.filter(c => c.path === '/v3/keyboardPwd/delete').pop().params.deleteType, '2'));

        console.log('\ntoken handling');
        check('one token fetched for the whole run so far', () => assert.strictEqual(tokenIssued, 1));
        check('password is MD5-hashed, never sent plain', () => {
            const t = calls.find(c => c.path === '/oauth2/token');
            assert.match(t.params.password, /^[a-f0-9]{32}$/);
            assert.notStrictEqual(t.params.password, 'hunter2');
        });

        expireNextCall = true;
        r = await fetch(base + '/api/passcode', {
            method: 'POST', headers: auth,
            body: JSON.stringify({ lockId: 21, guest: 'Retry', startDate: start, endDate: end }),
        });
        const retried = await r.json();
        check('an expired token is refreshed and the call retried', () => {
            assert.strictEqual(r.status, 200);
            assert.strictEqual(retried.passcode, '739104');
            assert.strictEqual(tokenIssued, 2);
        });

        console.log('\nstatic');
        r = await fetch(base + '/');
        const html = await r.text();
        check('the UI is served', () => assert.ok(html.includes('Room Codes')));
        r = await fetch(base + '/../server.js');
        check('path traversal is blocked', () => assert.ok(r.status === 403 || r.status === 404));

        console.log(`\n${passed} checks passed`);
    } finally {
        done();
    }
})().catch(err => {
    console.error(err);
    process.exit(1);
});
