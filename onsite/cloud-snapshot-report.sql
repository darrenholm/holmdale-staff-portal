-- Side-by-side daily sales report: local (public) vs cloud (cloud_snapshot).
-- Run by cloud-snapshot-report.ps1, which supplies these psql variables:
--   :report_date     day being reported, e.g. 2026-08-01
--   :event_tz        event timezone, e.g. America/Toronto
--   :cloud_naive_tz  timezone the cloud server writes naive TIMESTAMPs in (UTC on Railway)
--
-- Standalone run:
--   psql -U postgres -d rodeo_db -v report_date=2026-08-01 \
--        -v event_tz=America/Toronto -v cloud_naive_tz=UTC \
--        -f cloud-snapshot-report.sql
--
-- Where the numbers come from (same schema both sides):
--   Food      kitchen_orders, payment_status='paid', booth <> 'icecream'
--             (totals include tax, matching what the customer paid)
--   Ice cream kitchen_orders, payment_status='paid', booth = 'icecream'
--   Alcohol   bar_transactions, transaction_type='drink' (bar service);
--             'refund' rows (drink cancellations, negative amounts) are shown
--             on their own line so gross vs net is visible
--
-- Timestamp handling: kitchen_orders.created_at is TIMESTAMPTZ (absolute, safe
-- on both sides). bar_transactions.created_date is a naive TIMESTAMP — written
-- in local wall time on the NUC but in :cloud_naive_tz on Railway, so the
-- cloud side is converted into :event_tz before comparing to :report_date.

\set ON_ERROR_STOP on

\echo ''
\echo '============================================================'
\echo 'HOLMDALE RODEO — DAILY SALES REPORT (local vs cloud snapshot)'
\echo 'Report date:' :report_date '  (event tz:' :event_tz ')'
\echo '============================================================'

\echo ''
\echo '--- Snapshot sanity: total row counts (all-time, both sides) ---'
SELECT 'wristbands' AS table_name,
       (SELECT COUNT(*) FROM wristbands)                     AS local_rows,
       (SELECT COUNT(*) FROM cloud_snapshot.wristbands)      AS cloud_rows
UNION ALL
SELECT 'bar_transactions',
       (SELECT COUNT(*) FROM bar_transactions),
       (SELECT COUNT(*) FROM cloud_snapshot.bar_transactions)
UNION ALL
SELECT 'kitchen_orders',
       (SELECT COUNT(*) FROM kitchen_orders),
       (SELECT COUNT(*) FROM cloud_snapshot.kitchen_orders)
UNION ALL
SELECT 'ticket_orders',
       (SELECT COUNT(*) FROM ticket_orders),
       (SELECT COUNT(*) FROM cloud_snapshot.ticket_orders);

\echo ''
\echo '--- Today''s sales by category: LOCAL vs CLOUD ---'
WITH cat AS (
  -- LOCAL ------------------------------------------------------------
  SELECT 'local' AS side, 1 AS ord, 'Food' AS category,
         COUNT(*) AS n, COALESCE(SUM(total), 0) AS amt
  FROM kitchen_orders
  WHERE payment_status = 'paid'
    AND COALESCE(booth, 'main') <> 'icecream'
    AND (created_at AT TIME ZONE :'event_tz')::date = :'report_date'::date

  UNION ALL
  SELECT 'local', 2, 'Ice cream', COUNT(*), COALESCE(SUM(total), 0)
  FROM kitchen_orders
  WHERE payment_status = 'paid'
    AND booth = 'icecream'
    AND (created_at AT TIME ZONE :'event_tz')::date = :'report_date'::date

  UNION ALL
  SELECT 'local', 3, 'Alcohol (bar drinks)', COUNT(*), COALESCE(SUM(amount), 0)
  FROM bar_transactions
  WHERE transaction_type = 'drink'
    AND created_date::date = :'report_date'::date

  UNION ALL
  SELECT 'local', 4, 'Alcohol refunds', COUNT(*), COALESCE(SUM(amount), 0)
  FROM bar_transactions
  WHERE transaction_type = 'refund'
    AND created_date::date = :'report_date'::date

  -- CLOUD ------------------------------------------------------------
  UNION ALL
  SELECT 'cloud', 1, 'Food', COUNT(*), COALESCE(SUM(total), 0)
  FROM cloud_snapshot.kitchen_orders
  WHERE payment_status = 'paid'
    AND COALESCE(booth, 'main') <> 'icecream'
    AND (created_at AT TIME ZONE :'event_tz')::date = :'report_date'::date

  UNION ALL
  SELECT 'cloud', 2, 'Ice cream', COUNT(*), COALESCE(SUM(total), 0)
  FROM cloud_snapshot.kitchen_orders
  WHERE payment_status = 'paid'
    AND booth = 'icecream'
    AND (created_at AT TIME ZONE :'event_tz')::date = :'report_date'::date

  UNION ALL
  SELECT 'cloud', 3, 'Alcohol (bar drinks)', COUNT(*), COALESCE(SUM(amount), 0)
  FROM cloud_snapshot.bar_transactions
  WHERE transaction_type = 'drink'
    AND ((created_date AT TIME ZONE :'cloud_naive_tz') AT TIME ZONE :'event_tz')::date
        = :'report_date'::date

  UNION ALL
  SELECT 'cloud', 4, 'Alcohol refunds', COUNT(*), COALESCE(SUM(amount), 0)
  FROM cloud_snapshot.bar_transactions
  WHERE transaction_type = 'refund'
    AND ((created_date AT TIME ZONE :'cloud_naive_tz') AT TIME ZONE :'event_tz')::date
        = :'report_date'::date
)
SELECT category,
       MAX(n)   FILTER (WHERE side = 'local')                  AS local_count,
       to_char(MAX(amt) FILTER (WHERE side = 'local'),  'FM$999,990.00') AS local_total,
       MAX(n)   FILTER (WHERE side = 'cloud')                  AS cloud_count,
       to_char(MAX(amt) FILTER (WHERE side = 'cloud'),  'FM$999,990.00') AS cloud_total
FROM cat
GROUP BY category, ord
ORDER BY ord;

\echo ''
\echo '--- Wristband UIDs with transactions on BOTH sides today ---'
\echo '(any bar_transactions row: drinks, food/merch redeems, top-ups, refunds.'
\echo ' Empty result = good — no wristband was charged in both databases.)'
WITH local_tx AS (
  SELECT UPPER(w.rfid_uid)                          AS uid,
         MAX(w.customer_name)                       AS customer,
         COUNT(*)                                   AS txns,
         SUM(bt.amount)                             AS amount,
         string_agg(DISTINCT bt.transaction_type, ', ' ORDER BY bt.transaction_type) AS types,
         MAX(bt.created_date)                       AS last_tx
  FROM bar_transactions bt
  JOIN wristbands w ON w.id = bt.wristband_id
  WHERE bt.created_date::date = :'report_date'::date
  GROUP BY UPPER(w.rfid_uid)
),
cloud_tx AS (
  SELECT UPPER(w.rfid_uid)                          AS uid,
         MAX(w.customer_name)                       AS customer,
         COUNT(*)                                   AS txns,
         SUM(bt.amount)                             AS amount,
         string_agg(DISTINCT bt.transaction_type, ', ' ORDER BY bt.transaction_type) AS types,
         MAX((bt.created_date AT TIME ZONE :'cloud_naive_tz') AT TIME ZONE :'event_tz') AS last_tx
  FROM cloud_snapshot.bar_transactions bt
  JOIN cloud_snapshot.wristbands w ON w.id = bt.wristband_id
  WHERE ((bt.created_date AT TIME ZONE :'cloud_naive_tz') AT TIME ZONE :'event_tz')::date
        = :'report_date'::date
  GROUP BY UPPER(w.rfid_uid)
)
SELECT l.uid                                        AS rfid_uid,
       COALESCE(l.customer, c.customer)             AS customer,
       l.txns                                       AS local_txns,
       to_char(l.amount, 'FM$999,990.00')           AS local_amount,
       l.types                                      AS local_types,
       c.txns                                       AS cloud_txns,
       to_char(c.amount, 'FM$999,990.00')           AS cloud_amount,
       c.types                                      AS cloud_types,
       l.last_tx                                    AS local_last_tx,
       c.last_tx                                    AS cloud_last_tx
FROM local_tx l
JOIN cloud_tx c USING (uid)
ORDER BY (COALESCE(l.amount, 0) + COALESCE(c.amount, 0)) DESC, l.uid;
