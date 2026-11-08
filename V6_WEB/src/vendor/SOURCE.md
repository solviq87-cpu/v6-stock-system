# Engine provenance

These pure modules are copied without edits from the user's repository
`solviq87-cpu/v6-stock-system`, code included in merged commit
`e3be4ceff9ff90408a0a1ebf4ebfb8b4baf19e31` (PR #1).

They retain OHLCV validation, historical feature definitions, optional screening
conditions and the existing research pattern library. The browser wrapper adds
input limits, evidence grouping and factor diagnostics; it does not grant trade
permissions or copy account state. This directory contains no credentials.

`historical-session.js` reuses the existing board-limit/opening execution
checks from the same repository for the standalone strategy simulator.
