# WorkBuddy static frontend source

This standalone document preserves the existing user-owned site at
`https://af3c7822e6aafc135.app.workbuddy.host`. It is intentionally separate
from `V6_WEB/dist` and the locked `V6_BO/public` homepages.

- Current captured published timestamp: `2026-11-13T06:02:50.147Z`.
- Current original remote HTML SHA-256: `1bcd78d41743f85b719466558ffe46379d0cf290dfc1ea7a6a1a19ac58a0c689`.
- Current imported canonical HTML SHA-256: `e0072043ee4605f6c12e9bcb26c5390aa2853cfba4f0b9e95cace2338fa10e8b`.
- Deployment scope: `static-frontend-only`.

The initial capture was published at `2026-11-13T02:54:36.673Z`, with original
remote SHA-256 `f34d528f0f11f597a69ca526ef158a7c0585bce882ceba0389fb23c2257ed3db`
and imported canonical SHA-256
`cbafb6712dc163d4f078159aa10d4ee327b47ff208783da83d12a9a5919d3a3a`.
Before the first automatic-update initialization, another user tool published
the newer full-market 43-strategy scanner. The strict expected-content hash
guard rejected the initialization before any publish request, preserving that
newer content. The current import adopts this newer document instead of
overwriting it with the initial capture. That 43-strategy capture was published
at `2026-11-13T05:36:05.321Z`, with original remote SHA-256
`1c9b0e706e1f7d5d160846935ed07b17997c386e58d97c79836eb48e8f868b3d`
and canonical SHA-256
`d102aef5e7cf52b7c99930d7985011f62a2cc9fa0c7a46f1bd5cbaa05bd21137`.

A later external publication added responsive table scrolling and preservation
of table scroll positions and expanded details during refresh. The guarded
legacy restoration rejected this changed target before any publish request.
The current capture adopts those additions too; it contains no Unicode
replacement characters. Compared with the previous 43-strategy capture, the
changes are limited to table CSS, the inline `V6TableScroll` module, and its
render capture/restore calls. Strategy, account and records logic is preserved.

The original HTML contained an embedded site access code. Its value was never
imported into Git. The sole source change replaces that assignment with
`new URLSearchParams(location.search).get('sharecode')||''`. This explains why
the canonical digest differs from the remote digest. Opening the authorized
site URL with its access code continues to supply that code to the original
same-origin records API; code values must stay outside Git and logs.

At import, all other document bytes, visual design, inline V6Core strategy, V6Battle
43-strategy scanner, simulated account, risk, cloud records, financial and
strategy-data modules, and public quote code were preserved from the current
capture. No account records or live ledger response was imported. Static
publication does not deploy the repository's Node/Python services, upgrade
server-side collectors, or certify market data or strategy performance.

The collector hardening candidate subsequently changes this imported source.
Its canonical HTML SHA-256 is
`bea502023e8246360e409196ff64fca1e57d8bc15e166fff18d498e4939ba9e1`.
It retains the four core strategies and all 43 playbooks, with explicit pause,
shared browser request budgets, historical-cache controls and same-row quote
checks at the manual paper-order boundary. See `RATE_CONTROL.md` for the
changes, preserved payloads, verification scope and remaining limitations.
This source update is not a claim that the hosted page has been replaced.

`V6_BO/scripts/build-workbuddy-static.js` reads this file without modifying it
and inserts only nonvisual release metadata. The metadata records the full
Git commit SHA, canonical SHA-256, release identifier and static scope.
Verification removes the exact metadata block and hashes every remaining
UTF-8 byte; it does not derive a version from the URL, title or query string.

Example build (write to a temporary artifact directory):

```sh
node V6_BO/scripts/build-workbuddy-static.js --source V6_WEB/workbuddy/index.html --sha FULL_40_CHARACTER_COMMIT_SHA --output /tmp/workbuddy-release.html
```

The builder rejects embedded credential patterns, OpenAI runtime API access,
external rendering assets, invalid commit IDs, and malformed release markers.
Pattern checks supplement source review; they are not a general proof that
arbitrary future HTML contains no sensitive information.
