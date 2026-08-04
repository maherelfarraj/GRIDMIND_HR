---
name: Publish build environment detection
description: How to detect "running inside a Replit publish build" for pre-build hooks
---

**Rule:** `REPLIT_DEPLOYMENT` is NOT set during the publish *build* phase (only at production runtime). To make a pre-build hook behave differently during publishes, pass an explicit flag via `.replit` `[deployment.build].env` (e.g. `PUBLISH_BUILD = "1"`) and check it in the script.

**Why:** A publish failed twice: the pre-build regression gate ran a live-DB schema-drift test that always fails during publishes (prod schema syncs only after the build — chicken-and-egg). The first fix keyed on `REPLIT_DEPLOYMENT` and silently didn't trigger in the build container.

**How to apply:** Never run live-DB integration tests in deploy pre-build hooks; gate them behind the explicit build-env flag. `.replit` edits must go through `verifyAndReplaceDotReplit` with a temp file.
