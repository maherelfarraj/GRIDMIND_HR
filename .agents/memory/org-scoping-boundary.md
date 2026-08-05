---
name: Tenant org scoping is an authorization boundary
description: What completion review requires before header-based org scoping passes.
---
Rule: an org-context header is only acceptable when it is a full authz boundary, and scoping must cover derived paths, not just list/detail routes.

**Why:** Completion review rejected header-based org scoping four times for, in order: (1) payroll/no-show calculations reading cross-org attendance/leave/holidays; (2) any authenticated user selecting any org via the header (no membership check); (3) omitting the header falling back to the default org instead of the user's home org; (4) bulk ops (leave-balance provision/reset) and admin governance detail/mutation routes left unscoped.

**How to apply:** when adding tenant scoping — derive home org from user membership; explicit org selection needs a privilege check (system role); no-header = home org under enforced auth; scope every derived/bulk/admin path; back each class with authenticated negative tests (forged header 403, cross-org row 404, pollution fixtures leaving results unchanged); migrations must backfill to the actual default org (is_default), never a hard-coded id.
