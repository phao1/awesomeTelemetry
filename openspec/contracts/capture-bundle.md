# Local original-evidence capture bundle (CB-001..005)

## CB-001 Types

Types below live verbatim in src/core/capture-bundle.ts; root normalized DTOs and
SQLite schema remain unchanged. File paths are fixed ASCII archive members, not
local paths or user filenames. SHA256 values are64 lowercase hex.

```ts
export interface CaptureBundleFile { path: string; bytes: number; sha256: string }
export interface CaptureBundlePlan {
  format: 'awesome-telemetry.capture-bundle';
  formatVersion: 1;
  proxyId: number;
  requestId: string;
  generatedAt: string;
  revision: string;
  mode: 'originals' | 'metadata';
  files: CaptureBundleFile[];
  originalBytes: number;
  omissions: string[];
}
export interface CaptureBundleReceipt {
  format: 'awesome-telemetry.capture-bundle-receipt';
  formatVersion: 1;
  revision: string;
  integrity: 'verified_in_transfer';
  files: CaptureBundleFile[];
}
```

## CB-002 HTTP and ownership

GET `/api/proxy/requests/:id/bundle/manifest?mode=originals|metadata` returns
CaptureBundlePlan with fresh UTC generatedAt and SHA revision binding the exact
metadata/reference snapshot. Default originals. No original/source file IO,
analysis, mutations or upstream requests. Existing bounded evidence snapshot
uses metadata mode (no body-derived analysis), retaining original headers,
refs/transport/processing and first100 identity/link pages with coverage.

GET `/api/proxy/requests/:id/bundle?mode=...&at=<generatedAt>&revision=<sha>`
reconstructs and matches that plan before transfer; require canonical millisecond
UTC and64 lowercase hex. Source revision mismatch409 CAPTURE_BUNDLE_CHANGED.
Same local connection/Host/Origin and foreground guards, no-store, static ApiError
for all non-2xx. Unknown/duplicate params or unsafe positive ID400 BAD_REQUEST;
absent capture404 PROXY_REQUEST_NOT_FOUND; originals plus deletion intent409
CAPTURE_ORIGINALS_DELETED; limit503 CAPTURE_EXPORT_LIMIT; busy503
CAPTURE_BUNDLE_BUSY; source/open/integrity failure503 CAPTURE_BUNDLE_UNAVAILABLE;
closing503 SERVER_SHUTTING_DOWN. No filesystem paths or input error text.

At most2 transfers per exporter,120s total deadline. Cancellation/disconnect/
shutdown aborts owned streams and settles work before SQLite can close.
No new dependency, original-file copy, archive spool, runtime config or parser.

## CB-003 Archive layout and byte fidelity

200 application/x-tar attachment `capture-<numericId>.tar`, with Content-Length.
Uncompressed POSIX ustar regular-file members, mode0600, uid/gid/mtime0, no link
entries or source-derived member names. Members in order: manifest.json,
evidence.json, README.txt, optional originals/request.body and response.body,
receipt.json, then two zero blocks. All paths unique. Size fields use standard
octal; each file<=8589934591bytes (ustar representational bound). Larger originals
remain individually downloadable and this archive explicitly refuses, never
clips. Default100MiB directions are fully supported, independent of analysis
limits. Missing refs are recorded in omissions; no empty placeholder original.

evidence.json is the existing CaptureEvidenceExport v1 metadata-mode snapshot;
its own no-inline-original and page limitations stay valid. manifest.files lists
evidence.json,README.txt and included originals with exact bytes/expected SHA256.
manifest.json is the exact plan prepared with supplied at/revision. receipt.json
lists those same entries plus manifest.json with measured hashes; it is emitted
only after every retained original's streamed byte count/hash matches its ref.
receipt integrity verifies transferred retained files, not original network/
protocol/Agent completeness. HTTP/WS encoded bytes remain unchanged; existing
capture status/transport/processing evidence stays independent. No causal or
cross-source accounting merge and no native/raw scan file is implied.

## CB-004 Async access and deletion

Preflight opens at most2 regular files through CaptureBodyStore, checks lstat
and descriptor inode/device/type/size; reject symlinks/nonregular/missing sources.
Keep readers owned until transfer/cleanup. No async SQLite transaction. Recheck
snapshot after all opens and source identity/ref/deletion before each transfer
chunk and final receipt. Any deletion intent or changed refs aborts transfer.
After headers start, failure destroys the response (never appends an ApiError
inside tar or emits a success receipt/end blocks). Earlier downloaded bytes
cannot be revoked. Consumer must require receipt and compare hashes; incomplete
HTTP/download/archive is not valid evidence. Metadata mode does not open files
and remains available for deleted originals. No automatic clear/retention.

## CB-005 UI

Lazy explicit preparation in selected capture maintenance; no mount/locale IO.
Display mode, original bytes, exact included paths, missing refs/metadata pages,
headers sensitivity, retained-prefix limits and unknown complete-source history.
Only an explicit Prepare reads the bounded plan with5s owned wait/cancel/late
suppression. Validate ID/mode/version/path allowlist/sha/bounds before offering
the native download link. ID/deletion/invalidation/unmount cancels old preparation
and hides the old link. Browser handles streaming and cancellation in its own
downloads UI; do not fetch large bodies into JS or claim file saving succeeded.
The server revalidates revision on the actual download. A changed/error source
requires explicit prepare retry; no automatic download, model/tool call or upload.
Both locales and keyboard access follow frontend requirements.
