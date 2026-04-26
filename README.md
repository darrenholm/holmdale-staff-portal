# holmdale-staff-portal

Staff and operations site for Holmdale Pro Rodeo. Deployed at **staff.holmdalerodeo.ca**.

## What's here

Static HTML pages in `public/`. Each page is self-contained (inline `<script>` and `<style>`). No build step today.

| Page | Purpose | Auth |
|------|---------|------|
| `index.html` | Post-login portal menu (role-gated tiles) | Required |
| `login.html` | Email/password login form; supports `?expired=1` notice | — |
| `entry-scanner.html` | Scan ticket QR + assign RFID wristbands at the gate | Required |
| `age-verification.html` | NFC-tap to mark wristbands as 19+ approved | Required |
| `bar-service.html` | Serve drinks, redeem credits, search by name | Required |
| `gatescanner1.html` | Alternate gate scanner (manual entry path) | Required |
| `inventory-manager.html` | Drink stock CRUD + sales totals | Required |
| `shift-manager.html` | Admin shift CRUD | Required |
| `shift-picker.html` | Self-serve shift sign-up | Required |
| `ticket-resend.html` | Search tickets and re-send confirmation emails | Required |
| `vendor-invite.html` | Send vendor registration invites by email | Required |
| `rodeo-balance-checker.html` | Public NFC kiosk: tap wristband to see balance | Public |
| `rodeo-kiosk.html` | Public drink-ticket purchase kiosk (Moneris) | Public |
| `vendor-register.html` | Public vendor signup form | Public |

## Backend API

All authenticated pages talk to `https://rodeo-fresh-production-7348.up.railway.app/api`. JWT stored in `localStorage` under `auth_token`.

On `401`/`403`, the page calls a local `redirectToLogin()` helper that clears the token and redirects to `login.html?expired=1` (which surfaces a "Your session expired" notice).

Source for the API lives in the [`rodeo-fresh`](../rodeo-fresh) repo.

## Auth flow

- POST `/api/auth/staff-login` with `{ email, password }` → `{ token, staff }`
- First login uses default password `rodeo2026` and forces a password change
- Forgot-password flow exists in `login.html` but currently broken — depends on `reset-password.html` which was deleted in commit `e46326b` and needs to be recreated

## Deploy

**Where this deploys is currently configured externally** (Vercel/Netlify dashboard, or web host) — there is no deploy config file in this repo. To be added once the deploy target is confirmed.

## Sibling repos

- [`holmdale-pro-rodeo`](../holmdale-pro-rodeo) — public site at holmdalerodeo.ca
- [`rodeo-fresh`](../rodeo-fresh) — backend API on Railway

## Migration in progress

See `~/.claude/plans/silly-finding-newell.md` for the full plan. Outstanding:

- React staff pages in `holmdale-pro-rodeo/src/pages/` need to be moved here (~17 pages with no HTML equivalent)
- `reset-password.html` and `forgot-password.html` need to be recreated (deleted in commit `e46326b`)
- `index.html` menu was trimmed of dead links; new tiles for migrated React pages need to be added
