import {build} from 'esbuild';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
await mkdir('dist/assets', {recursive: true});
await build({entryPoints: ['src/analysis.mjs'], bundle: true, format: 'iife',
  globalName: 'V6Research', platform: 'browser', target: ['es2022'],
  outfile: 'dist/assets/analysis.bundle.js', minify: true, legalComments: 'eof'});
const manifest = JSON.parse(await readFile('.openai/hosting.json', 'utf8'));
if (manifest.project_id !== 'appgprj_6aee0b82f2848191b846023eafa4349c' || manifest.static?.directory !== 'dist') {
  throw Error('Existing Site identity or static output changed');
}
await writeFile('dist/build.json', JSON.stringify({app: 'V6 browser research', version: '20261107web2',
  engineSource: 'solviq87-cpu/v6-stock-system@e3be4ceff9ff90408a0a1ebf4ebfb8b4baf19e31',
  mode: 'local-browser-research', liveMarket: false, serverModelTraining: false}, null, 2) + '\n');
