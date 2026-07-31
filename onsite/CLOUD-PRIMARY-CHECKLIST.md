# Cloud-primary — device & DNS setup checklist

**Goal:** the event runs live on the **cloud**. Every device talks to the cloud
so all screens agree and online ticket sales are instantly visible. The NUC is a
warm standby (see `CLOUD-BACKUP.md`) you fail over to only if the internet drops.

---

## The one golden rule

> **Load everything by the DOMAIN — `https://staff.holmdalerodeo.ca/…` — never by raw IP.**
> A raw-IP address (`http://192.168.0.101/…`) forces the page onto the **local**
> database (the 5-min-old mirror). This is the *opposite* of the old
> `NUC-SETUP.md` cheat-sheet, which used raw IP on purpose for local-primary.

## DNS = your failover switch (set on the NUC's Technitium)

The router hands every device the NUC (`192.168.0.101`) as its DNS server, so
Technitium decides where the names point. Two states:

| State | Technitium zones for `staff.` / `api.holmdalerodeo.ca` | Result |
|---|---|---|
| **Normal (cloud)** | **Disabled** (let them forward out to public DNS) | Devices resolve to the **cloud** |
| **Failover (internet down)** | **Enabled** → `192.168.0.101` | Devices resolve to the **NUC / local** |

Failover flip = enable those two zones + refresh devices (and **stop the mirror
first** — `CLOUD-BACKUP.md`). Cutback = disable them again after reconciling.

Also make sure devices aren't bypassing Technitium: Chrome **Secure DNS off**,
Android **Private DNS off** — otherwise you lose the switch on that device.

---

## Per-station setup

| Station | Open this | Card reader? |
|---|---|---|
| Staff phones / tablets (admin, bar redeem) | `https://staff.holmdalerodeo.ca` | — |
| **Main bars** (redeem only) | `https://staff.holmdalerodeo.ca/bar-service.html` | — |
| **Satellite bars** (redeem + reload) | **RodeoBar Android app** | WisePad (needs internet) |
| Gate / entry | `https://staff.holmdalerodeo.ca/entry-scanner.html` | — |
| Kiosks — food / ticket / merch (taking cards) | **RodeoKiosk app** (card flow) | WisePad (needs internet) |
| TVs / displays | `https://staff.holmdalerodeo.ca/rodeo-…-display.html` | — |

Notes:
- **Main bar terminals: use the domain URL, not raw IP** — that's the one change
  from how they ran during testing, and it's what puts them on the live cloud DB.
- **TVs:** load the domain so they show **live** data. If a TV refuses the https
  cert, that's the known TV-cert quirk — tell me and I'll sort the display path.

---

## Verify cloud-primary is actually on (2 min, before doors)

1. On a device, open `…/ticket-sales-report.html` → the number matches what you
   see logged into the real online sales. (If it's a stale number, that device
   is on local — check its DNS / that you used the domain, not raw IP.)
2. Buy one test ticket online → it appears on that report within seconds.
3. Redeem a drink on one bar; check the same wristband on another bar → balance
   matches immediately. All devices on one database = they always agree.

## Failover drill (do it ONCE before doors so it's not the first time live)

1. Stop the mirror (`nssm stop RodeoCloudBackup`).
2. In Technitium, **enable** the `staff.` / `api.` zones → `192.168.0.101`.
3. Refresh a device (or toggle its Wi-Fi) → it now reads the NUC mirror.
4. Flip back: **disable** the zones, restart the mirror. Confirm the device
   returns to live cloud data.

If steps 1–4 work both directions, your backup plan is real.
