# V6 BO import status

Source baseline: V6_1090_full_20261107bo.zip (70,795,284 bytes; 4,355 ZIP entries).

**Status: source import pending.** This repository does not yet contain the complete runnable V6 project. The workflow is scaffolded but cannot pass until the source is imported.

Safety gate before import:
- Scan source and historical objects for credentials, tokens, private account data and operational logs.
- Exclude history/objects and other generated/private data unless separately reviewed.
- Preserve original archive unchanged and verify its SHA-256.
- Import the working source tree, then run npm run check and npm test.
- Deploy only after test and production configuration review.

Do not use this partial repository as a production deployment.
