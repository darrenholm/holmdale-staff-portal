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

## 8. Router (Omada ER605 — replaced the Archer C80)

The ER605 (standalone web UI at `https://192.168.0.1`) puts all the access
points and everything behind them on one LAN.

Physical wiring — the ER605 has one WAN port plus a few LAN ports; keep it
simple and hang everything off the PoE switch:

```
Starlink ──> ER605 WAN
             ER605 LAN ──> ES208GP (PoE+) ──┬─> EAP225-Outdoor  (PoE)
                                            ├─> EAP650 ×3       (PoE+)
                                            ├─> NUC (RodeoOpsServer)
                                            └─> warm backup server
```

Starlink notes:

- ER605 WAN connection type = **Dynamic IP** (Starlink hands out DHCP; no
  PPPoE). With the standard Starlink router you need its **Ethernet
  adapter**; enabling **Bypass mode** in the Starlink app avoids double
  NAT. Not strictly required — everything here is outbound-only — but it
  removes one layer of weirdness.
- Starlink is **CGNAT**: nothing on the internet can reach into the venue.
  That's fine — cards (Stripe/Moneris), emails, Railway dumps, and Let's
  Encrypt (DNS validation) are all outbound.
- Good internet does **not** change the local-first design. Starlink blips
  (obstructions, weather, power) are exactly when the gate line is longest —
  the NUC keeps everything but card payments running through them.

The venue kit:

| Device | MAC | Reserved IP |
|---|---|---|
| ES208GP switch | `D4-D6-DF-00-37-98` | `192.168.0.2` |
| EAP225-Outdoor | `50-3D-D1-69-F2-02` | `192.168.0.3` |
| EAP650 | `B8-FB-B3-2A-E8-D0` | `192.168.0.4` |
| EAP650 | `B8-FB-B3-2A-FC-06` | `192.168.0.5` |
| EAP650 | `B8-FB-B3-2B-1C-C4` | `192.168.0.6` |
| NUC (`RodeoOpsServer`) | `0C-CD-B4-58-80-73` | **`192.168.0.101`** |
| Warm backup server | *(grab from DHCP Client List when it's on)* | `192.168.0.153` |

Set it up in this order — the reservations must land **before** the DNS
change, because until then some AP may be squatting on `.101` (first boot
after the router swap, the EAP225-Outdoor grabbed `.101` from DHCP and the
NUC ended up on `.105`):

1. **Network → LAN → Address Reservation** → **Import** →
   `onsite/er605-address-reservations.csv` (this repo) loads the whole
   table in one go. If the import complains (the feature is finicky across
   firmware versions), just add the six rows by hand — the "Network Name"
   column must match the LAN's name shown on the LAN tab (default `LAN`).
2. Power-cycle the APs (or reboot them from their admin pages) so they
   release their old leases, then on the NUC run
   `ipconfig /release; ipconfig /renew` (or reboot it). Check **Network →
   LAN → DHCP Client List**: the NUC must show `192.168.0.101`.
3. **DHCP DNS = `192.168.0.101` only**: **Network → LAN → LAN** → edit the
   LAN entry → Primary DNS = `192.168.0.101`, **Secondary empty** (a public
   fallback like 8.8.8.8 would let devices bypass the local answers).
4. Devices pick the new DNS up on lease renewal — toggling Wi‑Fi off/on on
   a phone forces it.

Also make sure the LAN stays on `192.168.0.0/24` (gateway `192.168.0.1`) —
every raw-IP bookmark and TV depends on it.

> If the APs are ever adopted into an Omada controller (OC200/software
> controller), the controller **owns the config** — redo these settings
> there, because standalone-UI edits get overwritten on sync.

### Access points (3× EAP650 + EAP225-Outdoor, all wired to the ES208GP)

All four APs plug into the ES208GP PoE+ switch, which feeds them power and
uplink. That already makes them **one network** — no wireless mesh needed
(mesh is only for APs that have no cable; a wired backhaul is faster and
more reliable than any wireless hop). One Wi‑Fi network across the grounds
just means: **the same SSID + password on all four APs**. Phones then roam
to whichever AP is strongest.

Two ways to get there:

**Simple (no controller):** configure each AP individually with the
identical SSID/password on both 2.4 GHz and 5 GHz — via the Omada app
(menu → Standalone Devices, it lists all four) or each AP's web page at
its reserved IP (`.3`–`.6`). Same security type (WPA2/WPA3) everywhere.
That's the whole job; client devices handle the roaming themselves.

**Better (one pane of glass): Omada Software Controller on the NUC.** The
free controller adopts the ER605, the ES208GP, *and* all four EAPs. You set
the SSID once, it pushes everywhere, and you get fast/seamless roaming
(802.11k/v), per-AP client views, and one login for the whole venue
network. The NUC is always on site, so this works offline. If you adopt,
the controller **owns the config** — redo section 8's DNS + fixed-IP
settings inside it (Settings → Wired Networks → LAN → DHCP DNS = Manual
`192.168.0.101`; Clients → Use Fixed IP), because standalone edits get
overwritten on sync. An AP that was set up standalone asks for its admin
login during adoption (or factory-reset it and adopt fresh).

Either way, the router settings above (reservations + DHCP DNS) are
unchanged and still required — APs and their clients get addresses and DNS
from the ER605.

PoE note: 3× EAP650 (PoE+, ~13 W each) + the EAP225-Outdoor (~10 W) total
roughly 50 W, inside the ES208GP's 64 W budget — but don't hang other PoE
loads off the same switch on event day.

Quick check per AP: stand near it, connect a phone to the SSID, and
confirm the phone gets a `192.168.0.x` address with DNS `192.168.0.101`
(Wi‑Fi details screen), then open `https://staff.holmdalerodeo.ca`.

## Warm backup server (`192.168.0.153`)

Second machine with the same stack as the NUC (steps 1–7 of this guide:
Postgres, rodeo-fresh API, Caddy, Technitium with the same `staff.`/`api.`
zones → but pointing at itself only after failover). It idles at `.153`;
if the NUC dies mid-event, it **takes over `.101`** so nothing else has to
change — DNS, phones, and every raw-IP TV/kiosk bookmark keep working.

### Keeping it warm

Fresh data on the backup is what makes failover useful. On the **NUC**,
allow the backup to pull from Postgres (one-time):

1. `C:\Program Files\PostgreSQL\17\data\pg_hba.conf` → add
   `host all all 192.168.0.153/32 scram-sha-256`, then restart the
   `postgresql-x64-17` service.
2. Firewall: `New-NetFirewallRule -DisplayName "Rodeo PG sync" -Direction
   Inbound -Protocol TCP -LocalPort 5432 -RemoteAddress 192.168.0.153
   -Action Allow` (scoped to the backup only).

On the **backup**, save the postgres password once in
`%APPDATA%\postgresql\pgpass.conf` (`192.168.0.101:5432:*:postgres:PASSWORD`),
put this in `C:\rodeo\sync-from-primary.ps1`:

```powershell
$stamp = Get-Date -Format yyyyMMdd-HHmm
& "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe" --no-owner --no-acl -h 192.168.0.101 -U postgres -d rodeo_db -f "C:\rodeo\sync\rodeo-$stamp.sql"
Get-ChildItem C:\rodeo\sync\rodeo-*.sql | Sort-Object Name -Descending | Select-Object -Skip 24 | Remove-Item
```

and schedule it every **15 minutes** (Task Scheduler → run whether user is
logged on or not). Worst-case data loss on failover = one interval.

Also copy `C:\rodeo\certs\*` to the backup whenever the Let's Encrypt cert
is (re)issued — the backup must serve the same trusted cert.

### Failover runbook (NUC died)

1. **Power off the NUC** (or pull its cable) — two machines on `.101` is
   worse than none.
2. On the backup, take over the IP:
   `Get-NetIPAddress -AddressFamily IPv4` to find the interface, then
   `New-NetIPAddress -InterfaceAlias "Ethernet" -IPAddress 192.168.0.101 -PrefixLength 24 -DefaultGateway 192.168.0.1`
   (remove the old `.153` address if it lingers:
   `Remove-NetIPAddress -IPAddress 192.168.0.153`).
3. Restore the newest sync dump:
   ```powershell
   & "C:\Program Files\PostgreSQL\17\bin\dropdb.exe"   -U postgres --if-exists rodeo_db
   & "C:\Program Files\PostgreSQL\17\bin\createdb.exe" -U postgres rodeo_db
   $latest = Get-ChildItem C:\rodeo\sync\rodeo-*.sql | Sort-Object Name | Select-Object -Last 1
   & "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -d rodeo_db -f $latest.FullName
   ```
4. `nssm restart rodeo-api; nssm restart rodeo-caddy` and check Technitium
   is running.
5. Verify from a phone: toggle Wi‑Fi, `https://staff.holmdalerodeo.ca`,
   padlock, log in. TVs/kiosks recover on their own (same raw IP).

After the event, whichever machine finished as `.101` holds the real data —
`pg_dump` from *that* one before touching anything.

## Device cheat-sheet (which address to use where)

| Device | Address | Why |
|---|---|---|
| Staff phones/tablets | `https://staff.holmdalerodeo.ca` | Trusted cert; camera/NFC need https |
| TVs (displays) | `http://192.168.0.101/rodeo-icecream-display.html` etc. | Raw IP — immune to TV DNS quirks |
| Booth kiosks / POS / bar terminals (browser) | `http://192.168.0.101/rodeo-food-kiosk.html?booth=...` etc. | Raw IP — orders always land in the LOCAL database |
| RodeoBar Android app | built-in (`api.holmdalerodeo.ca`) | Follows normal DNS |

Raw-IP pages call the API same-origin (`/api` proxied by Caddy), so they never
depend on DNS. Named-domain pages follow whatever DNS the device uses — fine
for phones, but a browser with "secure DNS"/Private DNS set to a specific
provider will silently reach the CLOUD instead of the NUC. If two screens ever
show different orders, that's what's happening.

## ⚠️ The Caddyfile the service actually loads

The RodeoCaddy service loads **`C:\rodeo\rodeo-fresh\scripts\onsite\Caddyfile`**
(see `nssm get RodeoCaddy AppParameters`) — NOT the copy in this folder. Both
are kept in their repos; edit the rodeo-fresh one (or change the service's
AppParameters) and `nssm restart RodeoCaddy` after any change. This bit us
once: edits to this repo's copy were silently ignored.

## Stripe on the NUC

Card payments from the kiosk require `STRIPE_SECRET_KEY` in
`C:\rodeo\rodeo-fresh\.env` (copy from Railway → rodeo-fresh → Variables),
then `nssm restart RodeoAPI`. Stripe always needs internet — wristband/cash
flows work offline, card does not.

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
