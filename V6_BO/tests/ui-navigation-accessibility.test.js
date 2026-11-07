const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../public/assets/app.css'),'utf8');
const js=fs.readFileSync(path.join(__dirname,'../public/assets/ui-navigation.js'),'utf8');
test('developer research shortcut is governed by existing data-eo visibility',()=>{assert.match(html,/class="v6-research-entry" data-eo="hide"/);});
test('keyboard skip link and visible focus are present',()=>{assert.match(html,/class="v6-skip-link" href="#v6-market"/);assert.match(css,/\.v6-skip-link:focus/);});
test('navigation highlights sections without altering market calculations',()=>{assert.match(js,/IntersectionObserver/);assert.match(js,/aria-current/);assert.doesNotMatch(js,/fetch\(|XMLHttpRequest|localStorage/);});
test('navigation script is loaded defer and reduced-motion preference respected',()=>{assert.match(html,/ui-navigation\.js\?v=20261105nav1" defer/);assert.match(css,/prefers-reduced-motion:no-preference/);});
