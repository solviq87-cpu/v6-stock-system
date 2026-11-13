#!/usr/bin/env node
'use strict';
const { runForPublisher } = require('./managed-repository-auto-update');
function main(args, dependencies = {}) {
  const env = dependencies.env || process.env;
  return runForPublisher(args, 'github-actions', env.V6_APPROVED_PUBLISHER_SHA, dependencies);
}
if (require.main === module) main(process.argv.slice(2)).then(output => {
  process.stdout.write(JSON.stringify(output) + '\n');
  if (!['up-to-date', 'applied', 'recovered', 'update-available'].includes(output.code)) process.exitCode = 2;
});
module.exports = { main };
