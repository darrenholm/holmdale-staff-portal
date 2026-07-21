# Dual-Screen Terminal (Rockchip, Android 11) — Handoff Notes

Vendor hardware: double-sided screen terminal on a Rockchip board
(RK3288/RK3399/PX30/RK3326/RK3568 family), Android 11. Vendor sent
"Rockchip Android11 异显开发指南" (dual-display dev guide, Chinese) plus a
DualScreenDemo Android Studio project. The demo's two source files are in
`vendor-demo-src/` here; the guide's useful content is summarized below.

## Goal

A small kiosk APK that shows a staff page (front screen) and a
customer-facing page (rear screen) from https://staff.holmdalerodeo.ca:

- Main activity = fullscreen WebView loading the staff URL (e.g.
  bar-service.html or rodeo-merch-pos.html)
- android.app.Presentation on the rear display = second WebView loading the
  customer page (e.g. rodeo-kitchen-customer.html)
- URLs configurable (intent extras persisted to SharedPreferences is fine)
- Auto-start on boot (RECEIVE_BOOT_COMPLETED receiver), keep screen on
- Find the rear display via DisplayManager.getDisplays(DISPLAY_CATEGORY_PRESENTATION)
  (see vendor-demo-src MainActivity.showSecondByDisplayManager)

The terminal has wireless debugging enabled — connect with
`adb pair <ip>:<pairing-port>` (first time) then `adb connect <ip>:<port>`,
install with `adb install -r kiosk.apk`.

## Key facts from the Rockchip guide

- Two ways to drive the rear screen:
  1. Presentation API — one app owns both screens (what we want).
  2. Launch a *different* app onto the rear display:
     `adb shell am start --display 1 <package/activity>` — same-package
     activities are rejected ("App does not support launch on secondary
     displays"). Requires `android:resizeableActivity="true"` on the target.
- Rear touch (if rear panel is touch): the rear touch device must be flagged
  external — either an IDC file for that touch device with
  `device.internal=0`, or (vendor-side) EventHub.cpp change. Verify with
  `adb shell dumpsys input` → the rear TP should show `IsExternal: true`.
- Rear screen rotation: `setprop persist.sys.rotation.einit <0|1|2|3>`
  (RK3568 uses `persist.sys.rotation.einit-1` / `-2` per secondary screen).
  Values are 0/90/180/270. Reboot required.
- Show soft keyboard on rear screen: `shouldShowIme="true"` for that display
  in device/rockchip/common/display_settings.xml (vendor/firmware side).
  Rear DPI: `forcedDensity` in the same file.
- Mouse can cross to the rear screen: `setprop sys.mouse.presentation 1`
  (mouse jumps to rear screen when pushed past the edge).

## Status / environment notes

- The cloud session could NOT reach the terminal (LAN-only wireless
  debugging) and its egress proxy blocks dl.google.com, so the Android SDK
  couldn't be downloaded there. Build + install from a machine on the shop
  network (Android Studio, or command-line SDK).
- Vendor demo uses 2018-era support libraries; don't build on top of it
  directly — a fresh minimal project (minSdk 30, no AndroidX needed) with
  two WebViews is simpler. Its value is the Display lookup pattern.
