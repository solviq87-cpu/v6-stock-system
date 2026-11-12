import {build} from 'esbuild';
import {writeFile, mkdir} from 'node:fs/promises';

await mkdir('dist/assets', {recursive: true});
await build({
  entryPoints: ['src/index.mjs'],
  bundle: true,
  format: 'iife',
  globalName: 'V6Research',
  platform: 'browser',
  target: ['es2022'],
  outfile: 'dist/assets/analysis.bundle.js',
  minify: true,
  legalComments: 'eof'
});

await writeFile('dist/build.json', JSON.stringify({
  app: 'V6 browser research',
  version: '20261113provider-neutral',
  engineSource: 'solviq87-cpu/v6-stock-system@6bead0b78792323848a16806f2d3115171127095',
  mode: 'local-browser-research',
  deployment: 'provider-neutral',
  liveMarket: false,
  serverModelTraining: false
}, null, 2) + '\n');
