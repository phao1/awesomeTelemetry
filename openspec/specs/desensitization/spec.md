# Spec: Desensitization

> PII desensitization engine. Source files: `server/desensitization/`

## Purpose

Provide legacy optional redaction utilities. User-approved monitoring bypasses these utilities and preserves original observed data. Monitoring capture behavior is defined by proxy-capture REQ-004 and contracts/data-model.md.

## Requirements

### REQ-001: 10 built-in rules
| # | id | Pattern | Replacement | Default |
|---|-----|---------|-------------|---------|
| 1 | api_key | `sk-[a-zA-Z0-9]{20,}` | `sk-***` | enabled |
| 2 | api_key_generic | `key-[a-zA-Z0-9]{20,}` | `key-***` | enabled |
| 3 | bearer_token | `Bearer\s+\S+` | `Bearer ***` | enabled |
| 4 | email | email | `u***@e***.c***` | enabled |
| 5 | ip_address | IPv4 | `***.***.***.***` | enabled |
| 6 | file_path_win | `C:\...` | `C:\***` | enabled |
| 7 | file_path_unix | `/home\|/Users\|/root/...` | `/home/***` | enabled |
| 8 | aws_access_key | `AKIA[A-Z0-9]{16}` | `AKIA***` | enabled |
| 9 | aws_secret_key | 40-char base64 | `***` | **disabled** (too many false positives) |
| 10 | private_key | PEM blocks | `***PRIVATE KEY REDACTED***` | enabled |

### REQ-002: Sequential application and lastIndex reset
`desensitize(text, opts)` SHALL apply all enabled rules in order. Every global
regex MUST reset `lastIndex` before each replace, otherwise matches are
intermittently missed.

### REQ-003: Object desensitization
`desensitizeObject<T>(obj, opts, fields?)` SHALL desensitize the specified
string fields.

### REQ-004: Rule merging
`resolveRules(opts)` SHALL merge built-in defaults with user overrides and
return the full rule set.

### REQ-005: Config endpoints
`GET` / `PUT /api/desensitization/rules`; PUT MUST write atomically.

### REQ-006: Monitoring preserves originals
Monitoring SHALL bypass automatic redaction and retain original data per proxy-capture REQ-004. Legacy keepRawBodies remains available only for legacy callers; it does not disable original capture in the fusion monitoring path.

### REQ-007: Performance constraint
Monitoring SHALL NOT run regex redaction on forwarding callbacks. Original files are streamed asynchronously within the file-store budgets; legacy opt-in callers retain their existing utility behavior.

## Gotchas
- G8.2: aws_secret_key disabled by default
- global regexes must reset lastIndex every time
- G11.13 (new): desensitization runs on the request sync path; regex
  backtracking explosions stall the proxy directly. Every rule must avoid
  nested quantifiers
