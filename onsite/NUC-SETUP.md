# On-Site NUC Setup — staff.holmdalerodeo.ca without internet

Goal: the NUC (`nucbox_g10pro`, Windows, static IP **192.168.0.101**) serves the
staff portal and the API to every device on the venue Wi‑Fi, even with no
internet connection.

```
Phone/tablet ──DNS──> Technitium (NUC :53)   staff./api.holmdalerodeo.ca → 192.168.0.101
             ──HTTPS─> Caddy (NUC :443) ──┬─> static files  (this repo's public/)
                                          └─> Node API (:3000) ──> PostgreSQL (local)
```

Already done:

- [x] Technitium DNS zones for `staff.` and `api.holmdalerodeo.ca` → `192.168.0.101`
- [x] Portal pages self-host fonts and call `api.holmdalerodeo.ca` (no CDN deps)

Everything below needs internet, so do it **before** event day.

---

## 1. Install software (one-time, while online)

On the NUC, in an **admin** PowerShell:

```powershell
winget install OpenJS.NodeJS.LTS
winget install PostgreSQL.PostgreSQL.17     # match Railway (v17); note the postgres password you choose
winget install CaddyServer.Caddy
winget install Git.Git
winget install NSSM.NSSM                    # runs node + caddy as Windows services
```

Close and reopen PowerShell afterwards so PATH updates apply.

## 2. Folder layout

```powershell
mkdir C:\rodeo
cd C:\rodeo
git clone https://github.com/darrenholm/holmdale-staff-portal
git clone https://github.com/darrenholm/rodeo-fresh
mkdir C:\rodeo\certs
```

To update the portal later: `cd C:\rodeo\holmdale-staff-portal; git pull`.

## 3. Database

Create the database:

```powershell
& "C:\Program Files\PostgreSQL\17\bin\createdb.exe" -U postgres rodeo_db
```

**Copy production data from Railway** (recommended — brings over all staff
accounts, wristbands, inventory, and events so the local site matches
production). Get the `DATABASE_URL` from Railway → Postgres service →
Variables, then:

```powershell
$env:PROD_URL = "postgresql://...railway connection string..."
& "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe" --no-owner --no-acl -d $env:PROD_URL -f C:\rodeo\prod-dump.sql
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -d rodeo_db -f C:\rodeo\prod-dump.sql
```

Re-run those two commands right before the event so the local copy is fresh.

**The production copy is required, not optional.** A dress rehearsal of this
guide (2026-07-26) found that building the database from the repo's migrations
produces a schema that drifted from production: `staff.password_hash` is
missing (it exists on Railway but is in no migration file), the
`updated_at`/`updated_date` trigger bug breaks every staff UPDATE until
`migrations/fix-trigger.sql` is applied, and the sponsors/signs tables never
get created. Restoring the production dump sidesteps all of that. (Also note
`npm run migrate` doesn't read `.env` — if you ever need it, run
`node -r dotenv/config migrations/run.js` instead.)

## 4. API

```powershell
cd C:\rodeo\rodeo-fresh
npm install
copy ..\holmdale-staff-portal\onsite\api.env.example .env
notepad .env    # set the postgres password and the Railway JWT_SECRET
```

Test it: `npm start`, then in another window
`curl.exe http://localhost:3000/health` → should return OK. Ctrl-C to stop
(it becomes a service in step 6).

Using the **same `JWT_SECRET` as Railway** means staff logins carry over
between the production site and the on-site server.

## 5. HTTPS certificate (the camera/NFC requirement)

The QR scanner camera and NFC pages only work over HTTPS, and the cert must be
one the phones already trust — so use a real Let's Encrypt cert for both names,
validated via DNS (no public web server needed). Certs last 90 days, which
covers the event.

In PowerShell:

```powershell
Install-Module Posh-ACME -Scope CurrentUser
New-PACertificate 'staff.holmdalerodeo.ca','api.holmdalerodeo.ca' -AcceptTOS -Contact darren@holmgraphics.ca -Plugin Manual -PluginArgs @{}
```

It prints two `_acme-challenge` **TXT records**. Add them in **WHC cPanel →
Zone Editor** for holmdalerodeo.ca, wait a couple of minutes, press Enter to
continue. When it finishes:

```powershell
$cert = Get-PACertificate
copy $cert.FullChainFile C:\rodeo\certs\fullchain.pem
copy $cert.KeyFile       C:\rodeo\certs\privkey.pem
```

(If event day is more than ~80 days away, do this step closer to the event, or
run `Submit-Renewal` and re-copy the files.)

> Heads-up: the local Technitium zones mean the NUC itself can't resolve the
> *public* holmdalerodeo.ca while validating. That's fine — Let's Encrypt does
> the checking from the internet side.

## 6. Run everything as Windows services

```powershell
nssm install rodeo-api "C:\Program Files\nodejs\node.exe" server.js
nssm set rodeo-api AppDirectory C:\rodeo\rodeo-fresh
nssm set rodeo-api AppStdout C:\rodeo\api.log
nssm set rodeo-api AppStderr C:\rodeo\api.log
nssm start rodeo-api

nssm install rodeo-caddy "C:\Program Files\Caddy\caddy.exe" run --config C:\rodeo\holmdale-staff-portal\onsite\Caddyfile
nssm set rodeo-caddy AppDirectory C:\rodeo
nssm start rodeo-caddy
```

(Adjust the caddy.exe path if winget installed it elsewhere — `where.exe caddy`
tells you.) Both services now start automatically on boot. PostgreSQL and
Technitium already install themselves as services.

## 7. Firewall

Allow the web ports in (DNS 53 is already open for Technitium):

```powershell
New-NetFirewallRule -DisplayName "Rodeo HTTP"  -Direction Inbound -Protocol TCP -LocalPort 80  -Action Allow
New-NetFirewallRule -DisplayName "Rodeo HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow
```

Port 3000 stays closed — only Caddy talks to the API locally.

## 8. Router (Archer C80)

- **Advanced → Network → DHCP Server** → Primary DNS = `192.168.0.101`
  (leave Secondary empty — a public fallback like 8.8.8.8 would let devices
  bypass the local answers).
- **Address Reservation**: pin the NUC to `192.168.0.101`.

## 9. Verify (from a phone on the venue Wi‑Fi)

1. Toggle Wi‑Fi off/on (picks up the new DNS).
2. Open `https://staff.holmdalerodeo.ca` → portal loads, **padlock, no cert warning**.
3. Log in → proves the API + database work.
4. Entry scanner page → camera opens (proves the HTTPS cert is trusted).
5. The real test: unplug the router's WAN cable and repeat 2–4.

## Known limitations offline

- **Moneris card payments need internet.** The purchase kiosk can't take cards
  during an outage — have a cash/manual fallback ready.
- **Emails** (ticket resend, vendor invites) queue up or fail until internet
  returns.
- While running locally, the NUC database is the source of truth; anything
  entered there does **not** sync back to Railway. After the event, export
  with `pg_dump` if you need the data upstream.
