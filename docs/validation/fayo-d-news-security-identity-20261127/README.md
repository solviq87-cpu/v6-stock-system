# D40 / D65 / D77: news evidence input identity integrity

Baseline: `05f92132f1d9356b4448560ca27ebe110a0997a8`, PR #560. No other group changes.

## Defects and remediation
- Sparse security arrays skip Array.prototype.some callbacks. One hole can pass uniqueness validation, then serialize to null, causing a valid-looking append to poison recovery. Require an own, six-digit string at each index. Dense empty arrays and valid ordering are preserved.
- Both current and point-in-time query regexes previously coerced numeric and array inputs to a string; actual matching used the original value. Reject non-string security identifiers except explicit null (all securities).

## Verification
Actual isolated V8 execution of the exact old/new production source with mock filesystem and crypto (no disk/hash certification): 6/12 before; 12/12 after. Six failing cases: single hole, mixed hole, numeric/array current query, numeric/array historical query. Controls: null member, duplicate member, dense sorting, empty array, valid current and historical query. No network or deployment.

Two native node:test cases appended to the existing news-evidence-journal.test.js for pre-write rejection, actual filesystem recovery, and query identity/normal controls; they were not executed in the isolated environment. New commit requires native CI, and prior CI does not certify it. Existing news evidence flags and time/permission gates unchanged. No new claims of original task closure or real data authorization.
