# Recovering last night's food POS orders (the "wings" data)

**What happened (Aug 1, morning):** Yesterday the venue ran with the Technitium
zones enabled, so `staff.holmdalerodeo.ca` resolved to the NUC and the counter
POS pages wrote food orders to the **local** `kitchen_orders` table. The
morning merge to the cloud used `merge-back.js`, which (before commit
`fe7918e` on `fix/merge-back-json`) did **not** copy `kitchen_orders` — and the
cloud→local mirror then overwrote the local table (~08:50). The wristband
charges for that food (bar_transactions type `food`) DID merge and are safe;
what's missing is the order-level food records / non-wristband food revenue.

**Rules while recovering:**
- Keep `RodeoCloudBackup` STOPPED until recovery is finished.
- Do NOT run any standby sync to `.153` — if `.153` has a copy of yesterday's
  local DB, a sync would overwrite the evidence.

## Recovery sources, best first

### 1. The standby PC (.153)
If it holds a copy of yesterday's local DB:
```powershell
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -h 192.168.0.153 -U postgres -d rodeo_db -c "SELECT count(*) AS orders, max(created_at) AS newest, sum(total) AS dollars FROM kitchen_orders"
```
(Uses PGPASSWORD from the environment. If "database does not exist", retry
with `-d rodeo`. If the count is large and `newest` is last night → recovered:
dump just that table and load it into the cloud with the fixed merge-back or a
\copy.)

### 2. Backup dumps on the NUC
```powershell
dir C:\rodeo\backups | sort LastWriteTime
```
Any dump written last night (before ~08:45 Aug 1) contains `kitchen_orders`.
Restore it into a scratch database and export the table:
```powershell
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -d postgres -c "CREATE DATABASE wings_recovery"
& "C:\Program Files\PostgreSQL\17\bin\pg_restore.exe" -U postgres -d wings_recovery <dumpfile>   # or psql -f for .sql dumps
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -d wings_recovery -c "SELECT count(*), sum(total) FROM kitchen_orders"
```

### 3. Windows shadow copies of the Postgres data directory
```powershell
vssadmin list shadows
```
If a shadow copy from before ~08:45 exists, the whole pre-wipe database can be
pulled from it (copy the PostgreSQL data folder out of the shadow, start a
second postgres instance on another port against it).

### 4. Payment processor records (always exists for card sales)
Card-paid food went through **Moneris** (`/moneris/terminal-purchase`) or the
Stripe WisePad. The Moneris Go portal / terminal end-of-day report has every
card transaction from last night — that recovers the *revenue totals* even if
order rows are gone. Cash sales reconcile against the drawer count.

## After recovery
Load recovered `kitchen_orders` rows into the **cloud** (merge-back on
`fix/merge-back-json` now handles kitchen_orders with dedupe), then restart
the mirror: `nssm start RodeoCloudBackup`.
