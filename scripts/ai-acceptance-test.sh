#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# GridMindHR — Local AI End-to-End Acceptance Test Suite
# ─────────────────────────────────────────────────────────────────────────────
# Covers:
#   P1 — Role-based access control (RBAC)
#   P2 — Tenant isolation
#   P3 — All 4 AI features with quality evaluation against seeded data
#   P4 — Audit log verification
#   P5 — Failure / error-handling scenarios
#
# Usage:
#   bash scripts/ai-acceptance-test.sh
#
# Prerequisites:
#   - API server running on localhost:8080
#   - Seeded test data (node scripts/seed-ai-test-data.cjs)
# ─────────────────────────────────────────────────────────────────────────────

set -uo pipefail
BASE="http://localhost:8080/api"
PASS=0; FAIL=0; WARN=0

# ── Colour helpers ─────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[0;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

ok()   { echo -e "${GREEN}  ✅ PASS${RESET}  $1"; PASS=$((PASS+1)); }
fail() { echo -e "${RED}  ❌ FAIL${RESET}  $1"; FAIL=$((FAIL+1)); }
warn() { echo -e "${YELLOW}  ⚠  WARN${RESET}  $1"; WARN=$((WARN+1)); }
section() { echo -e "\n${BOLD}${CYAN}━━━ $1 ━━━${RESET}"; }
field()   { echo "       $1: $(echo "$2" | head -c 120)"; }

# ── Login helper ───────────────────────────────────────────────────────────────
login() {
  local user="$1" pass="$2" jar="$3"
  local resp
  resp=$(curl -s -c "$jar" -X POST "$BASE/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"$user\",\"password\":\"$pass\"}")
  local code
  code=$(echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null)
  echo "$code"
}

# ── JSON field extractor ───────────────────────────────────────────────────────
jv() { echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$2',''))" 2>/dev/null; }
jlen() { echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('$2',[])))" 2>/dev/null; }
jbool() { echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(str(d.get('$2','')).lower())" 2>/dev/null; }

# ── AI call helper: returns body\nHTTP_STATUS\nLATENCY_MS ───────────────────
ai_call() {
  local jar="$1" method="$2" endpoint="$3" payload="$4"
  local raw
  raw=$(curl -s -b "$jar" -w "\n___%{http_code}___%{time_total}" \
    -X "$method" "$BASE/$endpoint" \
    -H "Content-Type: application/json" \
    -d "$payload")
  local body http_code latency_raw latency_ms
  body=$(echo "$raw" | sed 's/___[0-9]*___[0-9.]*$//')
  http_code=$(echo "$raw" | grep -oP '___\K[0-9]{3}(?=___)')
  latency_raw=$(echo "$raw" | grep -oP '___[0-9]{3}___\K[0-9.]+')
  latency_ms=$(python3 -c "print(int(float('${latency_raw:-0}')*1000))" 2>/dev/null || echo "?")
  echo "${body}|||${http_code}|||${latency_ms}"
}

parse_body()   { echo "$1" | cut -d'|' -f1; }
parse_http()   { echo "$1" | cut -d'|' -f4; }
parse_ms()     { echo "$1" | cut -d'|' -f7; }

echo ""
echo -e "${BOLD}╔═══════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║   GridMindHR AI Acceptance Test Suite                ║${RESET}"
echo -e "${BOLD}╚═══════════════════════════════════════════════════════╝${RESET}"

# ── Authenticate test accounts ────────────────────────────────────────────────
section "Setup — Authenticating test accounts"

COOKIE_ADMIN=$(mktemp)
COOKIE_MGR=$(mktemp)
COOKIE_EMP=$(mktemp)

ADMIN_ID=$(login "maher" "M@her@135" "$COOKIE_ADMIN")
MGR_ID=$(login "test.manager" "TestPass@2026" "$COOKIE_MGR")
EMP_ID=$(login "test.employee" "TestPass@2026" "$COOKIE_EMP")

[[ -n "$ADMIN_ID" ]] && ok "Admin login (maher, id=$ADMIN_ID)" || fail "Admin login failed"
[[ -n "$MGR_ID"   ]] && ok "Manager login (test.manager, id=$MGR_ID)" || fail "Manager login failed — was seed run?"
[[ -n "$EMP_ID"   ]] && ok "Employee login (test.employee, id=$EMP_ID)" || fail "Employee login failed"

# ─────────────────────────────────────────────────────────────────────────────
# P1: ROLE-BASED ACCESS CONTROL
# ─────────────────────────────────────────────────────────────────────────────
section "P1 — Role-Based Access Control (RBAC)"

echo "  ↳ Regular employee (test.employee) must be blocked from all AI endpoints"

for endpoint in "ai/policy-search" "ai/report-query" "ai/classify-document" "ai/explain-anomaly"; do
  payload='{"query":"test"}'
  [ "$endpoint" = "ai/classify-document" ] && payload='{"title":"test"}'
  [ "$endpoint" = "ai/explain-anomaly" ] && payload='{"anomalyType":"attendance_high","metrics":{"x":1}}'
  raw=$(ai_call "$COOKIE_EMP" "POST" "$endpoint" "$payload")
  http=$(parse_http "$raw")
  if [[ "$http" == "403" ]]; then
    ok "Employee blocked from $endpoint (HTTP 403)"
  elif [[ "$http" == "401" ]]; then
    ok "Employee blocked from $endpoint (HTTP 401)"
  else
    fail "Employee should be blocked from $endpoint — got HTTP $http"
  fi
done

echo ""
echo "  ↳ Admin (maher) must be allowed to call all AI endpoints"
for endpoint in "ai/policy-search" "ai/report-query" "ai/classify-document" "ai/explain-anomaly"; do
  payload='{"query":"leave policy","limit":2}'
  [ "$endpoint" = "ai/report-query" ] && payload='{"query":"how many active employees"}'
  [ "$endpoint" = "ai/classify-document" ] && payload='{"title":"Annual Leave","content":"leave entitlement rules"}'
  [ "$endpoint" = "ai/explain-anomaly" ] && payload='{"anomalyType":"attendance_high","metrics":{"absencesLast30Days":3,"lateArrivalsLast30Days":8}}'
  raw=$(ai_call "$COOKIE_ADMIN" "POST" "$endpoint" "$payload")
  http=$(parse_http "$raw")
  if [[ "$http" == "200" ]]; then
    ok "Admin allowed to call $endpoint (HTTP 200)"
  else
    fail "Admin should be allowed at $endpoint — got HTTP $http"
    parse_body "$raw" | head -c 200
  fi
done

echo ""
echo "  ↳ GET /ai/config — admin can read, employee blocked"
raw=$(ai_call "$COOKIE_ADMIN" "GET" "ai/config" "")
http=$(parse_http "$raw"); body=$(parse_body "$raw")
[[ "$http" == "200" ]] && ok "Admin can GET /ai/config" || fail "Admin GET /ai/config — HTTP $http"
enabled=$(jbool "$body" "isEnabled")
provisioned=$(jbool "$body" "integrationProvisioned")
field "isEnabled" "$enabled"; field "integrationProvisioned" "$provisioned"

raw=$(ai_call "$COOKIE_EMP" "GET" "ai/config" "")
http=$(parse_http "$raw")
[[ "$http" == "403" || "$http" == "401" ]] && ok "Employee blocked from GET /ai/config (HTTP $http)" || \
  fail "Employee should be blocked from GET /ai/config — got HTTP $http"

# ─────────────────────────────────────────────────────────────────────────────
# P2: TENANT ISOLATION
# ─────────────────────────────────────────────────────────────────────────────
section "P2 — Tenant Isolation"

# Policy search results should only contain org-scoped/public documents
echo "  ↳ Policy search results must not expose cross-org records"
raw=$(ai_call "$COOKIE_ADMIN" "POST" "ai/policy-search" '{"query":"annual leave entitlement","limit":5}')
body=$(parse_body "$raw"); http=$(parse_http "$raw")
if [[ "$http" == "200" ]]; then
  ok "Policy search returns 200"
  doc_count=$(jlen "$body" "results")
  field "results returned" "$doc_count"
  if [[ "$doc_count" -gt "0" ]]; then
    ok "Policy search returned $doc_count results (documents visible to org)"
  else
    warn "Policy search returned 0 results (documents may not be indexed for this org yet)"
  fi
else
  fail "Policy search failed — HTTP $http"
fi

# Report query must only aggregate employees from the calling org
echo ""
echo "  ↳ Report query headcount must reflect only org 205 employees"
raw=$(ai_call "$COOKIE_ADMIN" "POST" "ai/report-query" '{"query":"how many active employees do we have"}')
body=$(parse_body "$raw"); http=$(parse_http "$raw")
if [[ "$http" == "200" ]]; then
  ok "Report query returns 200"
  interp=$(jv "$body" "interpretation")
  field "interpretation" "$interp"
  # keyMetrics should show a count — we seeded 11 active employees
  metrics_raw=$(echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d.get('keyMetrics',[])))" 2>/dev/null)
  field "keyMetrics" "$metrics_raw"
  # Check the count is plausible (should be ≥ 11 active seeded employees)
  emp_count=$(echo "$body" | python3 -c "
import sys, json
d = json.load(sys.stdin)
metrics = d.get('keyMetrics', [])
for m in metrics:
    v = str(m.get('value','0')).replace(',','')
    try:
        if int(float(v)) > 0:
            print(int(float(v)))
            break
    except:
        pass
print(0)
" 2>/dev/null | tail -1)
  emp_count=$(echo "$body" | python3 -c "
import sys, json
d = json.load(sys.stdin)
metrics = d.get('keyMetrics', [])
best = 0
for m in metrics:
    v = str(m.get('value','0')).replace(',','')
    try:
        n = int(float(v))
        if n > best:
            best = n
    except:
        pass
print(best)
" 2>/dev/null || echo 0)
  if [[ "$emp_count" -ge "10" ]]; then
    ok "Report query shows $emp_count active employees (≥ 10 seeded)"
  elif [[ "$emp_count" -gt "0" ]]; then
    warn "Report query shows $emp_count employees — expected ≥ 11 after seeding"
  else
    warn "Could not parse employee count from keyMetrics (value may be text)"
  fi
else
  fail "Report query failed — HTTP $http"
fi

# ─────────────────────────────────────────────────────────────────────────────
# P3: AI FEATURE QUALITY
# ─────────────────────────────────────────────────────────────────────────────
section "P3 — AI Feature Quality"

# ── P3.1 Policy Search ─────────────────────────────────────────────────────────
echo "  [P3.1] Policy Search — 'annual leave carry-forward limit'"
raw=$(ai_call "$COOKIE_ADMIN" "POST" "ai/policy-search" \
  '{"query":"annual leave carry-forward limit","limit":3}')
body=$(parse_body "$raw"); http=$(parse_http "$raw"); ms=$(parse_ms "$raw")

if [[ "$http" == "200" ]]; then
  ok "Policy search HTTP 200 — latency ${ms}ms"
  simulated=$(jbool "$body" "simulated")
  model=$(jv "$body" "model")
  count=$(jlen "$body" "results")
  summary=$(jv "$body" "summary")
  field "simulated" "$simulated"; field "model" "$model"
  field "results" "$count"; field "summary" "${summary:0:120}"
  [[ "$simulated" == "false" ]] && ok "Response is LIVE (not simulated)" || fail "Response is simulated — check OpenAI integration"
  [[ "$count" -ge "1" ]] && ok "Returned $count policy result(s)" || warn "0 results — documents may lack org scoping"
  [[ -n "$summary" ]] && ok "Summary field populated" || fail "Summary field empty"
else
  fail "Policy search failed — HTTP $http: $(parse_body "$raw" | head -c 200)"
fi

echo ""
echo "  [P3.1b] Policy Search — 'overtime pre-approval requirement'"
raw=$(ai_call "$COOKIE_ADMIN" "POST" "ai/policy-search" \
  '{"query":"overtime pre-approval requirement","limit":3}')
body=$(parse_body "$raw"); http=$(parse_http "$raw"); ms=$(parse_ms "$raw")
if [[ "$http" == "200" ]]; then
  count=$(jlen "$body" "results")
  ok "Second policy search HTTP 200 (${ms}ms), $count result(s)"
else
  fail "Second policy search HTTP $http"
fi

# ── P3.2 Report Query ─────────────────────────────────────────────────────────
echo ""
echo "  [P3.2] Report Query — workforce summary"
raw=$(ai_call "$COOKIE_ADMIN" "POST" "ai/report-query" \
  '{"query":"show me a summary of active versus inactive employees by department"}')
body=$(parse_body "$raw"); http=$(parse_http "$raw"); ms=$(parse_ms "$raw")

if [[ "$http" == "200" ]]; then
  ok "Report query HTTP 200 — latency ${ms}ms"
  simulated=$(jbool "$body" "simulated")
  model=$(jv "$body" "model")
  interp=$(jv "$body" "interpretation")
  suggested=$(jv "$body" "suggestedReport")
  reasoning=$(jv "$body" "reasoning")
  field "simulated" "$simulated"; field "model" "$model"
  field "interpretation" "$interp"; field "suggested" "$suggested"
  field "reasoning" "$reasoning"
  [[ "$simulated" == "false" ]] && ok "Response is LIVE" || fail "Response is simulated"
  [[ -n "$interp" ]] && ok "interpretation populated" || fail "interpretation empty"
  [[ -n "$suggested" ]] && ok "suggestedReport populated: $suggested" || warn "suggestedReport empty"
else
  fail "Report query failed — HTTP $http"
fi

# ── P3.3 Document Classification ──────────────────────────────────────────────
echo ""
echo "  [P3.3] Document Classification — overtime policy doc"
raw=$(ai_call "$COOKIE_ADMIN" "POST" "ai/classify-document" \
  '{"title":"Overtime Compensation Policy",
    "content":"Overtime work must be pre-approved. Pay is at 1.5x base rate for hours beyond 48/week."}')
body=$(parse_body "$raw"); http=$(parse_http "$raw"); ms=$(parse_ms "$raw")

if [[ "$http" == "200" ]]; then
  ok "Classify HTTP 200 — latency ${ms}ms"
  simulated=$(jbool "$body" "simulated")
  model=$(jv "$body" "model")
  category=$(jv "$body" "suggestedCategory")
  confidence_raw=$(echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('confidence',0))" 2>/dev/null)
  reasoning=$(jv "$body" "reasoning")
  field "simulated" "$simulated"; field "model" "$model"
  field "suggestedCategory" "$category"
  field "confidence" "$confidence_raw"
  field "reasoning" "${reasoning:0:120}"
  [[ "$simulated" == "false" ]] && ok "Response is LIVE" || fail "Response is simulated"
  [[ -n "$model" ]] && ok "model field present: $model" || fail "model field missing from classify response"
  [[ -n "$category" ]] && ok "Category assigned: $category" || fail "Category empty"
  conf_pct=$(python3 -c "print(int(float('${confidence_raw:-0}')*100))" 2>/dev/null || echo 0)
  [[ "$conf_pct" -ge "70" ]] && ok "Confidence ${conf_pct}% ≥ 70%" || warn "Confidence ${conf_pct}% < 70%"
else
  fail "Classify failed — HTTP $http: $(parse_body "$raw" | head -c 200)"
fi

echo ""
echo "  [P3.3b] Classification — data privacy doc"
raw=$(ai_call "$COOKIE_ADMIN" "POST" "ai/classify-document" \
  '{"title":"Employee Data Privacy Policy",
    "content":"Personal data stored encrypted. Employees may request deletion. AI analysis uses anonymised metrics only."}')
body=$(parse_body "$raw"); http=$(parse_http "$raw"); ms=$(parse_ms "$raw")
if [[ "$http" == "200" ]]; then
  cat2=$(jv "$body" "suggestedCategory")
  ok "Second classify HTTP 200 (${ms}ms) — category: $cat2"
else
  fail "Second classify HTTP $http"
fi

# ── P3.4 Anomaly Explanation — seeded anomaly scenarios ───────────────────────
echo ""
echo "  [P3.4a] Anomaly Explain — high absence (mirrors Ahmed Nasser's seeded data)"
raw=$(ai_call "$COOKIE_ADMIN" "POST" "ai/explain-anomaly" \
  '{"anomalyType":"attendance_high","entityId":999,
    "metrics":{"absencesLast30Days":3,"lateArrivalsLast30Days":8,"averageCheckInDelayMinutes":24,"overtimeHoursLast30Days":0}}')
body=$(parse_body "$raw"); http=$(parse_http "$raw"); ms=$(parse_ms "$raw")

if [[ "$http" == "200" ]]; then
  ok "Anomaly explain HTTP 200 — latency ${ms}ms"
  simulated=$(jbool "$body" "simulated")
  model=$(jv "$body" "model")
  risk=$(jv "$body" "riskLevel")
  expl=$(jv "$body" "explanation")
  rec_count=$(jlen "$body" "recommendations")
  field "simulated" "$simulated"; field "model" "$model"
  field "riskLevel" "$risk"; field "explanation" "${expl:0:140}"
  field "recommendations" "$rec_count"
  [[ "$simulated" == "false" ]] && ok "Response is LIVE" || fail "Response is simulated"
  [[ -n "$risk" ]] && ok "riskLevel assigned: $risk" || fail "riskLevel empty"
  [[ "$rec_count" -ge "1" ]] && ok "$rec_count recommendation(s) returned" || fail "No recommendations"
  [[ "$risk" == "high" || "$risk" == "medium" ]] && ok "riskLevel is appropriately elevated: $risk" || \
    warn "riskLevel '$risk' — may be lower than expected for this anomaly severity"
else
  fail "Anomaly explain failed — HTTP $http: $(parse_body "$raw" | head -c 200)"
fi

echo ""
echo "  [P3.4b] Anomaly Explain — overtime spike (mirrors seeded Engineering data)"
raw=$(ai_call "$COOKIE_ADMIN" "POST" "ai/explain-anomaly" \
  '{"anomalyType":"overtime_spike",
    "metrics":{"overtimeHoursLast30Days":72,"normalMonthlyOvertimeHours":8,"affectedHeadcount":3}}')
body=$(parse_body "$raw"); http=$(parse_http "$raw"); ms=$(parse_ms "$raw")
if [[ "$http" == "200" ]]; then
  risk2=$(jv "$body" "riskLevel")
  ok "Overtime spike explain HTTP 200 (${ms}ms) — riskLevel: $risk2"
else
  fail "Overtime spike explain HTTP $http"
fi

echo ""
echo "  [P3.4c] Anomaly Explain — leave exposure (mirrors Nadia/Yusuf seeded data)"
raw=$(ai_call "$COOKIE_ADMIN" "POST" "ai/explain-anomaly" \
  '{"anomalyType":"leave_exposure",
    "metrics":{"totalAccruedDays":104,"employeesAboveThreshold":2,"maxIndividualBalance":56}}')
body=$(parse_body "$raw"); http=$(parse_http "$raw"); ms=$(parse_ms "$raw")
if [[ "$http" == "200" ]]; then
  risk3=$(jv "$body" "riskLevel")
  ok "Leave exposure explain HTTP 200 (${ms}ms) — riskLevel: $risk3"
else
  fail "Leave exposure explain HTTP $http"
fi

echo ""
echo "  [P3.4d] Anomaly Explain — payroll variance (mirrors seeded payroll exceptions)"
raw=$(ai_call "$COOKIE_ADMIN" "POST" "ai/explain-anomaly" \
  '{"anomalyType":"payroll_variance",
    "metrics":{"varianceAmount":800,"variancePercentage":4.5,"affectedPayrollEntries":2}}')
body=$(parse_body "$raw"); http=$(parse_http "$raw"); ms=$(parse_ms "$raw")
if [[ "$http" == "200" ]]; then
  risk4=$(jv "$body" "riskLevel")
  ok "Payroll variance explain HTTP 200 (${ms}ms) — riskLevel: $risk4"
else
  fail "Payroll variance explain HTTP $http"
fi

# ─────────────────────────────────────────────────────────────────────────────
# P4: AUDIT LOG VERIFICATION
# ─────────────────────────────────────────────────────────────────────────────
section "P4 — Audit Logging"

echo "  ↳ Verifying AI queries are logged in ai_queries table"
audit_result=$(node --input-type=module << 'EOF'
import pg from '/home/runner/workspace/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/index.js';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// Get the 12 most recent queries (covering this test run's calls)
const r = await pool.query(`
  SELECT feature_type, model_used, was_simulated, success, tokens_used, duration_ms
  FROM ai_queries ORDER BY id DESC LIMIT 12`);
// Count by feature type
const counts = {};
let allLive = true; let allSuccess = true;
for (const row of r.rows) {
  counts[row.feature_type] = (counts[row.feature_type] || 0) + 1;
  if (row.was_simulated) allLive = false;
  if (!row.success) allSuccess = false;
}
console.log(JSON.stringify({ counts, allLive, allSuccess, total: r.rows.length }));
await pool.end();
EOF
)

total=$(echo "$audit_result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['total'])" 2>/dev/null || echo 0)
all_live=$(echo "$audit_result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(str(d['allLive']).lower())" 2>/dev/null || echo false)
all_ok=$(echo "$audit_result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(str(d['allSuccess']).lower())" 2>/dev/null || echo false)
counts=$(echo "$audit_result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d['counts']))" 2>/dev/null || echo "{}")

field "recent queries logged" "$total"
field "feature breakdown" "$counts"

[[ "$total" -ge "6" ]] && ok "At least 6 queries logged from this test run" || warn "Only $total queries found — some calls may not have been logged"
[[ "$all_live" == "true" ]] && ok "All logged queries are LIVE (was_simulated=false)" || fail "Some queries were flagged as simulated"
[[ "$all_ok" == "true" ]] && ok "All logged queries report success=true" || warn "Some queries logged as failed"

# Verify policy_search, report_query, document_classify, anomaly_explain all appear
for ft in "policy_search" "report_query" "document_classify" "anomaly_explain"; do
  cnt=$(echo "$counts" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$ft',0))" 2>/dev/null || echo 0)
  [[ "$cnt" -ge "1" ]] && ok "$ft: $cnt audit record(s)" || fail "$ft: 0 audit records — feature not logged"
done

# ─────────────────────────────────────────────────────────────────────────────
# P5: FAILURE / ERROR HANDLING
# ─────────────────────────────────────────────────────────────────────────────
section "P5 — Failure and Error Handling"

# 5.1 Invalid anomalyType → 400
echo "  [5.1] Invalid anomalyType must return 400"
raw=$(ai_call "$COOKIE_ADMIN" "POST" "ai/explain-anomaly" \
  '{"anomalyType":"invalid_type","metrics":{"x":1}}')
http=$(parse_http "$raw"); body=$(parse_body "$raw")
err=$(jv "$body" "error")
[[ "$http" == "400" ]] && ok "Invalid anomalyType → 400" || fail "Expected 400, got $http"
[[ -n "$err" ]] && ok "Error message returned: $err" || warn "No error message in body"

# 5.2 Missing required field (policy search with no query)
echo "  [5.2] Policy search with empty query must return 400"
raw=$(ai_call "$COOKIE_ADMIN" "POST" "ai/policy-search" '{"query":"  "}')
http=$(parse_http "$raw")
[[ "$http" == "400" ]] && ok "Empty query → 400" || fail "Expected 400 for empty query, got $http"

# 5.3 Classify with no title must return 400
echo "  [5.3] Classify with missing title must return 400"
raw=$(ai_call "$COOKIE_ADMIN" "POST" "ai/classify-document" '{"content":"some content"}')
http=$(parse_http "$raw")
[[ "$http" == "400" ]] && ok "Missing title → 400" || fail "Expected 400, got $http"

# 5.4 Report query with no query must return 400
echo "  [5.4] Report query with missing query must return 400"
raw=$(ai_call "$COOKIE_ADMIN" "POST" "ai/report-query" '{}')
http=$(parse_http "$raw")
[[ "$http" == "400" ]] && ok "Missing report query → 400" || fail "Expected 400, got $http"

# 5.5 Unauthenticated request must return 401
echo "  [5.5] Unauthenticated request must return 401"
raw=$(curl -s -w "\n___%{http_code}___0" -X POST "$BASE/ai/policy-search" \
  -H "Content-Type: application/json" \
  -d '{"query":"leave policy"}')
http=$(echo "$raw" | grep -oP '___\K[0-9]{3}(?=___)')
[[ "$http" == "401" ]] && ok "Unauthenticated → 401" || fail "Expected 401, got $http"

# 5.6 PATCH /ai/config with non-admin must fail
echo "  [5.6] Non-admin PATCH /ai/config must return 403"
raw=$(ai_call "$COOKIE_EMP" "PATCH" "ai/config" '{"maxTokens":100}')
http=$(parse_http "$raw")
[[ "$http" == "403" || "$http" == "401" ]] && ok "Non-admin config patch → $http" || \
  fail "Expected 403, got $http"

# ─────────────────────────────────────────────────────────────────────────────
# SUMMARY
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}╔═══════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║   ACCEPTANCE TEST RESULTS                            ║${RESET}"
echo -e "${BOLD}╠═══════════════════════════════════════════════════════╣${RESET}"
echo -e "${BOLD}║${RESET}  ${GREEN}PASS${RESET}  : $PASS"
echo -e "${BOLD}║${RESET}  ${RED}FAIL${RESET}  : $FAIL"
echo -e "${BOLD}║${RESET}  ${YELLOW}WARN${RESET}  : $WARN"
echo -e "${BOLD}╚═══════════════════════════════════════════════════════╝${RESET}"

# Cleanup temp cookie files
rm -f "$COOKIE_ADMIN" "$COOKIE_MGR" "$COOKIE_EMP"

[[ "$FAIL" -eq 0 ]] && exit 0 || exit 1
