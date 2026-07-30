<#
  Insert-only ticket sync  (cloud -> local NUC)

  Pulls CONFIRMED, non-sample ticket_orders from the cloud (Railway) production
  database and inserts any that are MISSING from the local NUC database. It
  never updates existing rows, so gate-scan status (scanned / scanned_at /
  rfid_tag_id) set locally is always preserved. Wristband credits are NOT
  touched -- balances live only where they are written. Loops every
  $IntervalSeconds.

  ONE-TIME PREP on the NUC (run once in PowerShell, then reopen the window):
    setx PROD_URL   "postgresql://postgres:PASSWORD@mainline.proxy.rlwy.net:31899/railway"
    setx PGPASSWORD "<LOCAL postgres password>"

  RUN (for testing -- watch the output):
    cd C:\rodeo\holmdale-staff-portal\onsite
    powershell -ExecutionPolicy Bypass -File .\ticket-sync.ps1

  See TICKET-SYNC.md for installing it as an always-on service and the test plan.
#>
param([int]$IntervalSeconds = 30)

$PSQL  = "C:\Program Files\PostgreSQL\17\bin\psql.exe"
$CSV   = "C:\rodeo\ticket-sync.csv"
$LOAD  = "C:\rodeo\holmdale-staff-portal\onsite\ticket-sync-load.sql"
$CLOUD = $env:PROD_URL

if (-not (Test-Path $PSQL))  { Write-Error "psql not found at $PSQL"; exit 1 }
if (-not $CLOUD)             { Write-Error "PROD_URL is not set (cloud connection string). See prep steps above."; exit 1 }
if (-not $env:PGPASSWORD)    { Write-Error "PGPASSWORD is not set (LOCAL postgres password). See prep steps above."; exit 1 }
if (-not (Test-Path $LOAD))  { Write-Error "Load script not found at $LOAD"; exit 1 }

Write-Host "Ticket sync running every $IntervalSeconds s.  Ctrl-C to stop."
while ($true) {
  try {
    # 1. Export confirmed, non-sample tickets from the CLOUD (password is in the URL)
    & $PSQL "$CLOUD" -v ON_ERROR_STOP=1 -c "\copy (SELECT * FROM ticket_orders WHERE status='confirmed' AND is_sample IS NOT TRUE) TO '$CSV' WITH (FORMAT csv)" | Out-Null

    # 2. Insert-only load into the LOCAL DB (PGPASSWORD used for -U postgres)
    $before = [int]((& $PSQL -U postgres -d rodeo_db -tAc "SELECT count(*) FROM ticket_orders") -join '').Trim()
    & $PSQL -U postgres -d rodeo_db -f $LOAD | Out-Null
    $after  = [int]((& $PSQL -U postgres -d rodeo_db -tAc "SELECT count(*) FROM ticket_orders") -join '').Trim()

    Write-Host ("{0}  ok   local tickets: {1}  (+{2} new)" -f (Get-Date -Format 'HH:mm:ss'), $after, ($after - $before))
  } catch {
    Write-Warning ("{0}  sync error: {1}" -f (Get-Date -Format 'HH:mm:ss'), $_)
  }
  Start-Sleep -Seconds $IntervalSeconds
}
