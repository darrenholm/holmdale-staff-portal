-- Insert-only load of freshly-exported confirmed tickets into the local NUC DB.
--
-- Safe by construction: ON CONFLICT (id) DO NOTHING never updates an existing
-- row, so a ticket already scanned locally (scanned=true, rfid_tag_id, status)
-- is ALWAYS left untouched. This script can only ever ADD tickets that the
-- local database is missing (i.e. new online purchases). It cannot corrupt,
-- reset, or overwrite anything already here.
--
-- Column mapping is positional (SELECT * -> LIKE ticket_orders). The local DB
-- was restored from the same cloud dump, so the column order matches. If you
-- ever change the ticket_orders schema on only one side, re-dump local from
-- cloud (NUC-SETUP.md §3) before trusting this again.

\set ON_ERROR_STOP on
BEGIN;
CREATE TEMP TABLE _incoming (LIKE ticket_orders INCLUDING DEFAULTS) ON COMMIT DROP;
\copy _incoming FROM 'C:/rodeo/ticket-sync.csv' WITH (FORMAT csv)
INSERT INTO ticket_orders
SELECT * FROM _incoming
ON CONFLICT (id) DO NOTHING;
COMMIT;
