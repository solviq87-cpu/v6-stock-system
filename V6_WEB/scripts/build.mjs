import {build} from 'esbuild';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
await mkdir('dist/assets', {recursive: true});
await build({entryPoints: ['src/index.mjs'], bundle: true, format: 'iife',
  globalName: 'V6Research', platform: 'browser', target: ['es2022'],
  outfile: 'dist/assets/analysis.bundle.js', minify: true, legalComments: 'eof'});
const manifest = JSON.parse(await readFile('.openai/hosting.json', 'utf8'));
if (manifest.project_id !== 'appgprj_6aee0b82f2848191b846023eafa4349c' || manifest.static?.directory !== 'dist') {
  throw Error('Existing Site identity or static output changed');
}
await writeFile('dist/build.json', JSON.stringify({app: 'V6 browser research', version: '20261108strategy1',
  engineSource: 'solviq87-cpu/v6-stock-system@6bead0b78792323848a16806f2d3115171127095',
  mode: 'local-browser-research', liveMarket: false, serverModelTraining: false}, null, 2) + '\n');
