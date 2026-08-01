# Cloud snapshot + daily sales report (local vs cloud)

Answers "what did we sell today, according to each database?" — the local NUC
DB and the cloud (Railway) DB — side by side, and flags any wristband that has
transactions in **both** (a sign the two databases were both live for sales at
some point, e.g. around cutover).

## What it does

`cloud-snapshot-report.ps1`:

1. **Dumps the cloud DB read-only.** The dump connection is forced
   `default_transaction_read_only=on`; nothing on Railway is modified.
2. **Restores it into schema `cloud_snapshot` inside local `rodeo_db`.**
   Existing local tables (`public`) are never touched. The dump is restored
   into a throwaway scratch database, `public` is renamed to `cloud_snapshot`
   there, and only that schema is loaded into `rodeo_db`. The only object
   dropped/recreated in `rodeo_db` is the `cloud_snapshot` schema itself
   (replaced on each run). The scratch DB and temp dumps are cleaned up.
3. **Runs `cloud-snapshot-report.sql`** against both schemas:
   - Row-count sanity check for the key tables.
   - Today's sales — **Food**, **Ice cream**, **Alcohol** (plus alcohol
     refunds) — order/transaction counts and dollar totals, local vs cloud.
   - **Wristband overlap**: every RFID UID with `bar_transactions` rows today
     on both sides, with per-side counts, amounts, transaction types, and last
     transaction time. An empty list is the good outcome.

## Where the numbers come from

| Category | Source | Filter |
|---|---|---|
| Food | `kitchen_orders` | `payment_status='paid'`, booth ≠ `icecream` (totals include tax) |
| Ice cream | `kitchen_orders` | `payment_status='paid'`, booth = `icecream` |
| Alcohol | `bar_transactions` | `transaction_type='drink'`; `refund` rows shown separately |

Note: wristband redeems at the food kiosks also write `bar_transactions` rows
with type `food`, but the kitchen-order rows are the authoritative food/ice
cream sales record (they include card payments too), so the report counts
those and uses `bar_transactions` only for alcohol and the overlap check.

Timezones: `kitchen_orders.created_at` is timestamptz (safe everywhere).
`bar_transactions.created_date` is a naive timestamp — local rows are taken
as event-local wall time, cloud rows are converted UTC → `America/Toronto`
(Railway runs in UTC). Both are configurable at the top of the script.

## Run it (on the NUC)

Uses the same env vars ticket-sync already set up (`PROD_URL`, `PGPASSWORD`):

```powershell
cd C:\rodeo\holmdale-staff-portal\onsite
powershell -ExecutionPolicy Bypass -File .\cloud-snapshot-report.ps1
```

Options:

- `-ReportDate 2026-08-02` — report a different day.
- `-SkipSnapshot` — re-print the report from the existing `cloud_snapshot`
  schema without re-downloading the cloud dump.

The `cloud_snapshot` schema stays in `rodeo_db` afterwards for ad-hoc digging:

```sql
SELECT COUNT(*) FROM cloud_snapshot.bar_transactions;
```
