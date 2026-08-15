# Room Codes — Walkerton Livery

Give a guest a door code without opening the TTLock app: pick the room, type the
name, pick the dates, hit **Create code**. Roughly 15 seconds instead of the
app's pick-lock → custom-passcode → set-period → save → read-it-back dance.

The generated code works on the keypad **immediately** — no gateway, no standing
next to the lock with Bluetooth — because it comes from TTLock's offline
passcode algorithm (`/v3/keyboardPwd/get`, period type). You can create a code
for next Tuesday from anywhere.

<sub>Screens: room picker → guest + dates → big code with a ready-to-send message,
plus every dated code on that room with a Revoke button.</sub>

## Why this is a service and not just a page

The TTLock cloud API authenticates with `clientId` + `clientSecret` + your TTLock
account password. Anything sitting in a browser is readable by anyone who opens
devtools, and those credentials control every lock on the account. So the
credentials live here, in `.env`, and the browser only ever talks to this
service.

## Setup

You need a TTLock **Open Platform** account (separate from the phone app) at
<https://open.ttlock.com> — register, create an application, wait for approval,
and copy the `clientId` / `clientSecret`. The `username` / `password` are the
ordinary TTLock app account that owns the locks.

```bash
cd ttlock
cp .env.example .env      # fill in credentials
node server.js            # http://localhost:8080
```

No `npm install` — the service is Node built-ins only (Node 18+).

Set `STAFF_PASSWORD` to whatever front-desk staff should type, and
`SESSION_SECRET` to a random string so restarts don't sign everyone out:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

If your TTLock account is on the EU region, set
`TTLOCK_BASE_URL=https://euapi.ttlock.com`.

## Deploy

It is one process with no database and no dependencies, so anywhere that runs
Node works. Point a subdomain (say `rooms.walkertonlivery.ca`) at it, put it
behind HTTPS, and set the env vars. Railway, Fly, a $5 VPS, or the same box as
anything else you run are all fine.

Serve the UI from this service (default) and there is nothing else to configure.
If you host `public/index.html` somewhere else instead, set `ALLOWED_ORIGINS` to
that origin so CORS lets it through.

## Two TTLock behaviours worth knowing

**A new code must be used within 24 hours of its start time.** This is a lock
firmware rule, not something this tool imposes. Generate a code with a Tuesday
3pm check-in and nobody punches it in by Wednesday 3pm — the lock drops it. For
normal bookings this is invisible; for a guest who arrives a day late, re-issue.
The UI prints the exact use-by moment under every code.

**Codes only cover whole hours.** Minutes and seconds are floored off both ends
before the request goes out, so what the UI shows is what the lock enforces.
Check-in/check-out hours come from `CHECKIN_HOUR` / `CHECKOUT_HOUR`.

**Revoking** needs a gateway to take effect remotely. Locks without one drop the
code from the cloud immediately but keep honouring it on the keypad until
someone opens the TTLock app near the lock; the UI says so when that applies.

## API

All routes except `POST /api/login` need `Authorization: Bearer <token>`.

| Route | Body / query | Returns |
|---|---|---|
| `POST /api/login` | `{password}` | `{token, defaults}` |
| `GET /api/rooms` | `?refresh=1` to skip the 5-min cache | `{rooms:[{lockId,name,battery,hasGateway}]}` |
| `POST /api/passcode` | `{lockId,guest,startDate,endDate}` | `{passcode,room,guest,startDate,endDate,useByDate}` |
| `GET /api/passcodes` | `?lockId=` | `{codes:[…]}` — period codes only |
| `POST /api/passcode/delete` | `{lockId,keyboardPwdId}` | `{ok,needsBluetooth}` |

Dates are epoch milliseconds. Permanent and one-time codes set from the phone app
are deliberately hidden from `/api/passcodes` so nobody revokes the owner's own
code from here.

## Tests

```bash
node test/smoke.js
```

Stands up a fake TTLock cloud API and drives the real server against it — auth,
hour flooring, passcode type, token refresh-and-retry, revoke routing, path
traversal. No credentials or network needed.

## Layout

```
ttlock-api.js   TTLock cloud client (token cache, refresh-on-401, error mapping)
server.js       HTTP service: sessions, validation, routes, static hosting
public/         the single-page UI
test/smoke.js   end-to-end test against a fake TTLock
```

Nothing here imports from the rest of this repo — copy the `ttlock/` folder out
into its own repo whenever the Livery gets one.
