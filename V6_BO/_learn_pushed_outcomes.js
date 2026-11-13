'use strict';
// Legacy CLI retained. Date-specific descriptive review writes a separate v2 file;
// historical learn_pushed_outcomes.json is never overwritten. Prospective learning
// remains in the existing immutable signal-evidence pipeline.
try { require('./scripts/pushed-outcome-review').main(); }
catch (error) { console.error(error.message); process.exitCode=1; }
