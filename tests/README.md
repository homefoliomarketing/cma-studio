# Tests

Security-focused tests added during the hardening audit.

## Run everything

```bash
# Backend (Python, offline — boots service.py in-process, stubs Supabase):
python -m unittest discover -s tests -p "test_*.py"

# Frontend sanitizers (Node, offline, no deps):
node --test "tests/**/*.test.mjs"

# (npm equivalents)
npm test            # node sanitizer tests
npm run test:py     # python tests
```

## What each file proves

| File | Proves |
|------|--------|
| `test_service_security.py` | `/api/parse` requires a signed-in agent in production; admin endpoints reject non-admins / missing tokens; email + password + UUID input validation; an admin can't delete themselves; static-file path traversal is blocked; errors don't leak internals; CORS is never `*`. |
| `test_parser_caps.py` | A hostile/huge PDF can't exhaust memory — page-count cap, per-page pixel cap, and the embedded-image size guard all hold. |
| `sanitize.test.mjs` | The frontend sanitizers (`safeHexColor`, `safeImageUrl`, `cssUrl`) accept only legitimate values and reject CSS-injection / unsafe-URL payloads. |

## User-data isolation acceptance test (run against the LIVE project)

`rls_isolation.py` proves, with the public anon key, that Agent B cannot read,
list, update, delete, or spoof-create Agent A's CMAs **and cannot self-promote to
`is_admin`**. It is the acceptance test for `supabase/harden_security.sql` — run
it **after** applying that migration, with two real accounts:

```bash
# PowerShell
$env:RLS_A_EMAIL='agentA@example.com'; $env:RLS_A_PASSWORD='...'
$env:RLS_B_EMAIL='agentB@example.com'; $env:RLS_B_PASSWORD='...'
python tests/rls_isolation.py
```

It SKIPs (exit 0) when those env vars aren't set, so it won't break CI.
