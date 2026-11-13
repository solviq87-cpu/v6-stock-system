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

The historical collector hardening candidate had canonical HTML SHA-256
`bea502023e8246360e409196ff64fca1e57d8bc15e166fff18d498e4939ba9e1`.
The integrated baseline at commit
`3ef08a2c8704e5e4e511fc54ccd8a04b24fe3434` had canonical HTML SHA-256
`a4c941745abd79fc84dc089fa561d0e7a4c17e5e5b718d5a98190c09c0538844`.
An earlier explicit-continue classification fix produced historical candidate
`0e4a32825735809162ca7c8efb9fa667a40eaa3a93cf1723397e6b23809374bc`.

The later upstream commit
`f6b57140ab5c7c518af25b82ca33e0f1ef891e0e` added trading-session automation,
four observation modules and per-module collapse preferences; its canonical
HTML SHA-256 was
`b61c135ae075b1c3ebbb4e516eaa0f5846e301b1dca511ea6bd0a4bdd2465951`.
The merged source preserves those changes and reconnects non-forced sector
classification refresh at the single session transition into active collection.
This covers explicit resume, authorized default automatic startup, and the next
opening after an enabled closed-session wait, while retaining persistent manual
pause, the same-day cache, attempt interval and shared provider budgets.
Its canonical HTML SHA-256 was
`30a60400b792510603be8a5446bebf2c60e184aa11dd490d8d5089df8872ff5d`.
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

The subsequent session/module candidate uses explicit 2026 trading sessions, four read-only observation modules and persistent per-module collapse preferences. See `SESSION_CONTROL.md`, `SESSION_MODULES.md` and `FOCUS_MODULES.md`. Source preservation of account protocols does not imply that missing auction/ladder evidence is available or that the hosted site has been updated.

## Foreground and reconnect recovery

Device lifecycle recovery preserves manual pause and the existing collection gates.
That candidate canonical HTML SHA-256 was `408025b1fe9f42da6d4f8df574e61185c410558d6928a4ae2e911995572a29d3`.
See `SESSION_CONTROL.md` for behavior and offline validation boundaries.

## Selection freshness

That selection-freshness candidate canonical HTML SHA-256 was `f1773bd287b7a3919417b96bce7315628cc4f9184e84c5ab6a4af1b30ee221b3`.
See `SELECTION_FRESHNESS.md` for row-clock eligibility, clock-driven cache
invalidation, actual quote-probe limitations and verification scope. This is
source provenance, not a production publication receipt.

## Bounded news pool and recommendation filtering

The current canonical HTML SHA-256 is `a1d58f5d95e5bc65a71f281068efc9f0bfadc3983e300b4d7790ebb4f79edcc6`. The standalone page now shows bounded public news summaries and direct/explicit industry associations, and filters primary candidates using the current news status. Source failures, unknown times and stale evidence keep candidates pending. News freshness and original quote freshness invalidate their own cache layers; refreshing news never refreshes a quote clock. The BO delivery gate is a separate server-side change and is not deployed by publishing this static HTML. See `NEWS_POOL.md` and `V6_BO/docs/NEWS_POOL_PUSH_GUARD_20261113.md`; this remains source provenance rather than proof of live publication or phone delivery.
