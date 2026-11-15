const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../public/assets/app.css'),'utf8');
const js=fs.readFileSync(path.join(__dirname,'../public/assets/ui-navigation.js'),'utf8');
test('migrated developer research shortcut and private settings retain existing data-eo visibility',()=>{assert.match(html,/href="\/research\.html" data-eo="hide"/);for(const id of ['hdrTools','lockPanel','holdSec1','holdSec2'])assert.match(html.match(new RegExp('<[^>]*id="'+id+'"[^>]*>'))?.[0]||'',/data-eo="hide"/,id);});
test('keyboard skip link targets the unified dashboard and visible focus is present',()=>{assert.match(html,/class="v6-skip-link" href="#vx-dashboard"/);assert.match(fs.readFileSync(path.join(__dirname,'../public/assets/terminal-dashboard.js'),'utf8'),/dashboard.id='vx-dashboard'/);assert.match(css,/\.v6-skip-link:focus/);});
test('navigation highlights sections without altering market calculations',()=>{assert.match(js,/IntersectionObserver/);assert.match(js,/aria-current/);assert.doesNotMatch(js,/fetch\(|XMLHttpRequest|localStorage/);});
test('navigation script is loaded defer and reduced-motion preference respected',()=>{assert.match(html,/ui-navigation\.js\?v=20261105nav1" defer/);assert.match(css,/prefers-reduced-motion:no-preference/);});
