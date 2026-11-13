# WorkBuddy static frontend source

This standalone document preserves the existing user-owned site at
`https://af3c7822e6aafc135.app.workbuddy.host`. It is intentionally separate
from `V6_WEB/dist` and the locked `V6_BO/public` homepages.

- Captured published timestamp: `2026-11-13T02:54:36.673Z`.
- Original remote HTML SHA-256: `f34d528f0f11f597a69ca526ef158a7c0585bce882ceba0389fb23c2257ed3db`.
- Imported canonical HTML SHA-256: `cbafb6712dc163d4f078159aa10d4ee327b47ff208783da83d12a9a5919d3a3a`.
- Deployment scope: `static-frontend-only`.

The original HTML contained an embedded site access code. Its value was never
imported into Git. The sole source change replaces that assignment with
`new URLSearchParams(location.search).get('sharecode')||''`. This explains why
the canonical digest differs from the remote digest. Opening the authorized
site URL with its access code continues to supply that code to the original
same-origin records API; code values must stay outside Git and logs.

All other document bytes, visual design, inline V6Core strategy, simulated
account, risk, cloud records and public quote code are preserved from the
capture. No account records or live ledger response was imported. Static
publication does not deploy the repository's Node/Python services, upgrade
server-side collectors, or certify market data or strategy performance.

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
