---
name: expo-print web adapter quirk
description: expo-print's web build ignores the html argument; use a hidden iframe instead
---

On web, `Print.printAsync({ html })` from expo-print ignores the supplied HTML and just calls `window.print()` on the current app page.

**Why:** SDK 54's web adapter has no HTML rendering path; discovered when a payslip-PDF share printed the mobile UI instead of the document (code review catch).

**How to apply:** For print/save-as-PDF of generated HTML on web, write the HTML into a hidden same-origin iframe (`doc.open()/write()/close()`), wait for load (with a short timeout fallback), then call `iframe.contentWindow.print()`. Iframes are not popup-blocked. Also: Expo SDK modules must be installed via `npx expo install` so versions match the SDK's bundled-module manifest — a plain `pnpm add` pulls incompatible majors and fails review/native builds.
