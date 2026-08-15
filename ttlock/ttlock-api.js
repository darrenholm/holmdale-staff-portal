'use strict';

// Thin client for the TTLock Open Platform cloud API.
//
// Docs: https://euopen.ttlock.com/doc/api/
// Every call is form-encoded and carries clientId + accessToken. Responses are
// JSON; a non-zero `errcode` means failure even though the HTTP status is 200.

const crypto = require('node:crypto');

const PWD_TYPE_PERIOD = 3;   // valid between startDate and endDate
const TOKEN_SKEW_MS = 60_000; // refresh a minute early rather than racing expiry

// TTLock invalidates a freshly generated permanent/period passcode if nobody
// uses it within 24h of its start time. Callers surface this to the user.
const UNUSED_GRACE_MS = 24 * 60 * 60 * 1000;

function md5(s) {
    return crypto.createHash('md5').update(s, 'utf8').digest('hex');
}

class TTLockError extends Error {
    constructor(errcode, errmsg, description) {
        super(description || errmsg || `TTLock error ${errcode}`);
        this.name = 'TTLockError';
        this.errcode = errcode;
        this.errmsg = errmsg;
        this.description = description;
    }
}

// errcode 10003 is "invalid token"; the others are the token-expiry family.
const TOKEN_ERRORS = new Set([10003, 10004, 10007]);

class TTLockClient {
    constructor({ baseUrl, clientId, clientSecret, username, password }) {
        this.baseUrl = (baseUrl || 'https://api.ttlock.com').replace(/\/+$/, '');
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.username = username;
        // The API takes the MD5 of the account password, never the password
        // itself. Accept an already-hashed value so a deployment can avoid
        // storing the plaintext at all.
        this.passwordMd5 = /^[a-f0-9]{32}$/i.test(password)
            ? password.toLowerCase()
            : md5(password);

        this.accessToken = null;
        this.refreshToken = null;
        this.expiresAt = 0;
        this.pendingAuth = null;
    }

    async form(path, params) {
        const body = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) {
            if (v !== undefined && v !== null) body.set(k, String(v));
        }

        const res = await fetch(this.baseUrl + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
        });

        const text = await res.text();
        let json;
        try {
            json = JSON.parse(text);
        } catch {
            throw new Error(`TTLock returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
        }
        if (json.errcode) {
            throw new TTLockError(json.errcode, json.errmsg, json.description);
        }
        return json;
    }

    // Serialised so a burst of parallel calls triggers one token request.
    async authenticate() {
        if (this.pendingAuth) return this.pendingAuth;

        this.pendingAuth = (async () => {
            const json = await this.form('/oauth2/token', {
                clientId: this.clientId,
                clientSecret: this.clientSecret,
                username: this.username,
                password: this.passwordMd5,
            });
            if (!json.access_token) {
                throw new Error('TTLock token response had no access_token');
            }
            this.accessToken = json.access_token;
            this.refreshToken = json.refresh_token || null;
            // expires_in is in seconds; fall back to an hour if absent.
            this.expiresAt = Date.now() + (Number(json.expires_in) || 3600) * 1000;
            return this.accessToken;
        })().finally(() => { this.pendingAuth = null; });

        return this.pendingAuth;
    }

    async token() {
        if (this.accessToken && Date.now() < this.expiresAt - TOKEN_SKEW_MS) {
            return this.accessToken;
        }
        return this.authenticate();
    }

    // Runs `fn` with a valid token, retrying once against a fresh token if
    // TTLock rejects the one we had cached.
    async call(path, params) {
        const send = async (accessToken) => this.form(path, {
            clientId: this.clientId,
            accessToken,
            date: Date.now(),
            ...params,
        });

        try {
            return await send(await this.token());
        } catch (err) {
            if (err instanceof TTLockError && TOKEN_ERRORS.has(err.errcode)) {
                this.accessToken = null;
                this.expiresAt = 0;
                return send(await this.token());
            }
            throw err;
        }
    }

    async listLocks({ pageNo = 1, pageSize = 100 } = {}) {
        const json = await this.call('/v3/lock/list', { pageNo, pageSize });
        return {
            list: json.list || [],
            total: json.total ?? (json.list || []).length,
            pages: json.pages ?? 1,
        };
    }

    async listPasscodes(lockId, { pageNo = 1, pageSize = 100 } = {}) {
        const json = await this.call('/v3/lock/listKeyboardPwd', { lockId, pageNo, pageSize });
        return {
            list: json.list || [],
            total: json.total ?? (json.list || []).length,
            pages: json.pages ?? 1,
        };
    }

    // Generates a passcode with TTLock's offline algorithm. The code works on
    // the lock keypad immediately -- no gateway and no Bluetooth sync needed,
    // which is the whole reason this tool can replace the phone app.
    async generatePeriodPasscode({ lockId, keyboardPwdVersion, name, startDate, endDate }) {
        const json = await this.call('/v3/keyboardPwd/get', {
            lockId,
            keyboardPwdVersion,
            keyboardPwdType: PWD_TYPE_PERIOD,
            keyboardPwdName: name,
            startDate,
            endDate,
        });
        if (!json.keyboardPwd) {
            throw new Error('TTLock did not return a passcode');
        }
        return { keyboardPwd: json.keyboardPwd, keyboardPwdId: json.keyboardPwdId };
    }

    // deleteType 1 = via Bluetooth (the app must be near the lock), 2 = via
    // gateway. Locks without a gateway can only truly clear the code on the
    // hardware when someone is nearby, but TTLock still drops it from the
    // cloud list so the record stops showing as active.
    async deletePasscode({ lockId, keyboardPwdId, deleteType = 2 }) {
        await this.call('/v3/keyboardPwd/delete', { lockId, keyboardPwdId, deleteType });
        return { ok: true };
    }
}

module.exports = { TTLockClient, TTLockError, md5, PWD_TYPE_PERIOD, UNUSED_GRACE_MS };
