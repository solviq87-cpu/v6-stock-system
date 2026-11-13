'use strict';
// Compatibility entry point. Exercise production code instead of maintaining a
// mirrored classifier which could stay green while the actual service regresses.
const {spawnSync}=require('node:child_process');
const result=spawnSync(process.execPath,['--test','tests/news-sentiment.test.js','tests/news-current-projection.test.js','tests/picks-three-k.test.js'],{cwd:__dirname,stdio:'inherit'});
process.exit(result.status??1);
