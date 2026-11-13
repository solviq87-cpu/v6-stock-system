'use strict';

// The real-function freshness and failure-path cases now live with the durable
// budget tests. Keep this historical command as an entry point, without a second
// injection harness that silently omits new production dependencies.
require('./tests/history-backfill-budget.test.js');
