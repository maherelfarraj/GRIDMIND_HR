---
name: drizzle-kit push needs a pty
description: How to apply schema drift non-interactively when drizzle-kit push prompts for column create/rename conflicts.
---
`drizzle-kit push` (even with `--force`) opens interactive create-vs-rename prompts for new columns and dies with "Interactive prompts require a TTY" in non-interactive shells; `yes '' | script` does not reliably answer them.

**Why:** After a rebase brings new tables/columns, tests fail with `relation ... does not exist` until push runs; prompts block automation.

**How to apply:** Drive it with a python `pty.fork()` loop that writes `\r` whenever output contains "create column"/"create table" (default choice = create). Verify afterwards with psql. Note: push can drop/recreate seeded rows in altered tables (e.g. system_config) — re-insert missing seed keys with `ON CONFLICT DO NOTHING`.
