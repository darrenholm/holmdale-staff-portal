# Cloud-primary with local warm-standby backup

**The event runs live on the cloud (Railway).** Every device — terminals,
phones, gate, kiosks — talks to the cloud. The local NUC database is kept as a
**continuously-refreshed backup mirror** so that if the internet fails you can
fail over to the on-site system with recent data.

Why this is the safe topology: during normal operation **nothing writes to the
local DB** — it only mirrors the cloud. So each refresh can overwrite it
wholesale with zero risk (there's nothing local to lose) and there is **no
conflict to reconcile**. This is the opposite of the local-primary plan, and it
means you should run `cloud-backup.ps1` — **not** `ticket-sync.ps1`.

## Setup on the NUC

1. Get the files: merge the PR, then on the NUC `cd C:\rodeo\holmdale-staff-portal; git pull`.
2. Secrets (run once, then reopen PowerShell):
   ```powershell
   setx PROD_URL   "postgresql://postgres:PASSWORD@mainline.proxy.rlwy.net:31899/railway"
   setx PGPASSWORD "<LOCAL postgres password>"
   ```
3. Keep **RodeoAPI** and **RodeoCaddy** running on the NUC (idle) so the local
   site is ready to serve instantly on failover.

## Run it

Test in a window first:
```powershell
cd C:\rodeo\holmdale-staff-portal\onsite
powershell -ExecutionPolicy Bypass -File .\cloud-backup.ps1
```
Every ~5 min you should see:
```
14:05:11  mirror OK    tickets=1042  wristbands=318
```
Adjust the cadence with `-IntervalSeconds 90` (the failover data-loss window is
whatever this interval is; default 300 = 5 min, minimum 30). Once happy, install as a service:
```powershell
nssm install RodeoCloudBackup powershell -ExecutionPolicy Bypass -File C:\rodeo\holmdale-staff-portal\onsite\cloud-backup.ps1
nssm set RodeoCloudBackup AppEnvironmentExtra PROD_URL=postgresql://postgres:PASSWORD@mainline.proxy.rlwy.net:31899/railway PGPASSWORD=<LOCAL postgres password>
nssm start RodeoCloudBackup
```

---

## ⚠️ FAILOVER — the internet / cloud goes down

Do these in order:

1. **STOP the mirror first.** `nssm stop RodeoCloudBackup` (or Ctrl-C the window).
   This is non-negotiable: if it keeps running, the next successful refresh will
   **erase everything you do on the local system** during the outage.
2. **Point every device at the NUC** (`192.168.0.101`):
   - Devices on the venue Wi-Fi already resolve `staff./api.holmdalerodeo.ca` to
     the NUC via Technitium — as long as Chrome **Secure DNS** / Android
     **Private DNS** are **off**. Or just load pages by raw IP
     `http://192.168.0.101/...`, which never depends on DNS.
   - The Android app follows DNS, so it must resolve to the NUC too.
3. **Operate on local.** The local DB is current as of the **last `mirror OK`
   line** in the log — check that timestamp so you know your starting point.
   Card payments will NOT work offline (Stripe/Moneris need internet) — fall back
   to cash / wristband credits.

## ⚠️ CUTBACK — the internet comes back (the hard part — read before you act)

While you were on local, the local DB took writes the cloud never saw. The cloud
also may have taken new online ticket sales. **Do NOT just restart the mirror** —
that overwrites local with cloud and **loses everything from the outage.**

Safe options, pick one:
- **Stay on local** to the end of that session, then `pg_dump` the local DB up to
  the cloud as the authoritative record (this makes local the new source of
  truth going forward). Reconcile any cloud-side online sales that happened
  during the outage separately.
- Or hold, and I can help you merge the two sets of changes deliberately.

Only once the two sides are reconciled should you resume cloud-primary and
restart `RodeoCloudBackup`.

## Notes

- **Data-loss window on failover = the mirror interval.** 5 min is a good
  balance; drop it to 2–3 if you want a tighter window.
- The dump is small (seconds), so refreshes are cheap. If a restore ever hangs
  on a lock, stop RodeoAPI on the NUC during that refresh (it isn't serving
  traffic in cloud-primary anyway).
- Flow is strictly one-way, cloud → local. Nothing ever pushes local → cloud
  automatically — cutback is always a deliberate manual decision.
