# V6 source import status

The `dev` branch contains the runnable project under `V6_BO/`. On 2026-11-07, every one of the 1,093 JS/HTML/CSS/Python source files in the BO archive was found in this branch. Local reconstruction was checked against every existing GitHub blob SHA before editing.

Archive baseline: `V6_1090_full_20261107bo.zip`, SHA-256 `28e73e364a846339bd9394ef7210dcdab8a0ae6aacfde4ad92c0a9f19cde22cb`.

GitHub contains the source and selected documentation, not the complete archive's runtime/private data or operational history. Preserve runtime credentials, accounts and state separately. No archive data files were imported by this update.

BP corrects repository-root npm entrypoints and supplies Python/curl/flock in the Dockerfile. Test evidence and remaining limitations are in `V6_BO/docs/GITHUB_UPDATE_20261107bp.md`. Successful CI is not server deployment or continuous live-feed certification.
