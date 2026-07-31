# Ticket sync (cloud → local NUC)

Keeps the **local NUC database** current with **online ticket purchases** made on
the cloud (Railway), so tickets bought on the website appear at the gate within
~30 seconds — while the venue keeps running on the local database for bars,
credits, and entry.

## What it does (and what it deliberately doesn't)

- **Pulls** confirmed, non-sample `ticket_orders` from cloud and **inserts only
  the ones the local DB is missing** (`ON CONFLICT (id) DO NOTHING`).
- **Never updates an existing row.** A ticket already scanned locally keeps its
  `scanned` / `scanned_at` / `rfid_tag_id`. The sync cannot reset a used ticket
  or corrupt anything already in the local DB — the worst it can do on a bad run
  is insert nothing and log an error.
- **Does NOT sync wristband credits.** Balances (redeemed at bars, reloaded at
  booths/phones) live only in the local DB during the event, on purpose. Only
  tickets flow cloud → local; nothing flows local → cloud.

## One-time setup on the NUC

1. Get the files (this folder) onto the NUC — merge the PR, then on the NUC:
   ```powershell
   cd C:\rodeo\holmdale-staff-portal
   git pull
   ```
2. Set the two connection secrets (run once, then **reopen** PowerShell so they load):
   ```powershell
   setx PROD_URL   "postgresql://postgres:PASSWORD@mainline.proxy.rlwy.net:31899/railway"
   setx PGPASSWORD "<LOCAL postgres password>"
   ```
   - `PROD_URL` = the Railway **DATABASE_PUBLIC_URL** (the `mainline.proxy.rlwy.net` one).
   - `PGPASSWORD` = the password for the **local** `postgres` user (what you type at the psql prompt).

## Run it (do this first, to watch it work)

```powershell
cd C:\rodeo\holmdale-staff-portal\onsite
powershell -ExecutionPolicy Bypass -File .\ticket-sync.ps1
```
You should see a line every ~30s like:
```
14:12:03  ok   local tickets: 1034  (+0 new)
```
When an online sale lands, the next tick shows `(+1 new)`.

## Test plan (tomorrow morning, before doors)

1. Start `ticket-sync.ps1` and watch the log.
2. Note the current local ticket count (the number in the log).
3. Buy one **test ticket online** (or have someone do a real online purchase).
4. Within ~30s the log should show `(+1 new)` and the count go up by one.
5. On a **gate scanner** (entry-scanner by raw IP), search/scan that ticket — it
   should be found and scan through. This proves cloud sales reach the gate.
6. Let the sync run one more tick, then **re-scan the same ticket / re-check it**
   — it must still show as scanned (not reset). This proves the insert-only
   safety: the sync did not overwrite the local scan.
7. Confirm a wristband balance you change at a bar does **not** move on its own
   (credits are never synced).

If all seven hold, the sync is safe to leave running.

## Leave it running (once the test passes) — install as a service

```powershell
nssm install RodeoTicketSync powershell -ExecutionPolicy Bypass -File C:\rodeo\holmdale-staff-portal\onsite\ticket-sync.ps1
nssm set RodeoTicketSync AppEnvironmentExtra PROD_URL=postgresql://postgres:PASSWORD@mainline.proxy.rlwy.net:31899/railway PGPASSWORD=<LOCAL postgres password>
nssm start RodeoTicketSync
```
Check it: `nssm status RodeoTicketSync`. Stop it: `nssm stop RodeoTicketSync`.
(For a manual run, just Ctrl-C the window.)

## Known limitations (by design — decide if they matter for you)

- **Online refunds/cancellations after a ticket has already synced do NOT
  propagate** (insert-only). A ticket refunded online could still scan valid at
  the gate. If someone disputes at the gate, check the cloud dashboard manually.
- **Needs internet** (Starlink) to reach the cloud. If internet drops, sync
  pauses — tickets already synced still scan; new online sales just won't appear
  until it's back. This does not affect bars/credits (those are local).
- **Adjustable interval:** `-File .\ticket-sync.ps1 -IntervalSeconds 15` for
  faster, or higher to ease load.
