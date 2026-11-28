import json,sys
from pathlib import Path
from datetime import datetime,timezone
from playwright.sync_api import sync_playwright
cfg=json.load(sys.stdin);out=Path(cfg['output']);rows=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for width,height in [(1366,900),(390,844),(320,740)]:
  ctx=browser.new_context(viewport={'width':width,'height':height},is_mobile=width<400,has_touch=width<400)
  ctx.add_init_script("localStorage.setItem('qd_device',"+json.dumps(cfg['token'])+");localStorage.setItem('qd_role','edit');")
  page=ctx.new_page();errors=[];requests=[]
  page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append(r.url.split('?')[0]))
  page.route('**/*',lambda r:r.continue_() if r.request.url.startswith(cfg['origin']+'/') else r.abort())
  at=datetime.fromtimestamp(cfg['now']/1000,timezone.utc);page.clock.install(time=at);page.clock.pause_at(at)
  page.goto(cfg['origin']+('/m' if width<400 else '/')+'#/opportunities/all',wait_until='domcontentloaded')
  card=page.locator('.fy-stock-card[data-code="600001"]').first;card.wait_for();card.click()
  drawer=page.get_by_role('dialog',name='股票研究面板');drawer.wait_for();meta=drawer.locator(':scope > .fy-quote-time')
  assert '原始报价' in meta.inner_text(),meta.inner_text()
  summary=drawer.locator('.fy-drawer-summary');assert '可关注' in summary.inner_text(),summary.inner_text()
  original=meta.inner_text();price=drawer.locator('.fy-drawer-quote').inner_text()
  # The existing network poller stops offline. The deadline must still repaint
  # the original observation, without adding a read or advancing its raw time.
  ctx.set_offline(True);page.evaluate("dispatchEvent(new Event('offline'))")
  page.clock.run_for(15000);assert '原始报价' in meta.inner_text(),meta.inner_text()
  reads_before=sum('/api/' in url for url in requests)
  page.clock.run_for(1);expired='历史报价' in meta.inner_text()
  assert sum('/api/' in url for url in requests)==reads_before,'expiry initiated a network read'
  if cfg['baseline']:assert not expired,'baseline unexpectedly fixed'
  else:assert expired,meta.inner_text()
  assert ('尚未取得有效后台结论' in summary.inner_text())==expired,summary.inner_text()
  assert drawer.locator('.fy-drawer-quote').inner_text()==price
  assert '10:00:00' in meta.inner_text() and 'expiry-fixture' in meta.inner_text()
  assert ('历史报价' in page.locator('.fy-stock-card[data-code="600001"]').first.inner_text())==expired
  geometry=page.evaluate('({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth})');assert geometry['scrollWidth']<=width+1,geometry
  page.screenshot(path=str(out/('expiry-'+str(width)+'.png')),full_page=False)
  drawer.get_by_role('button',name='关闭股票研究面板').click();page.clock.run_for(60000);assert not drawer.is_visible()
  assert not errors,errors
  rows.append({'width':width,'baseline':cfg['baseline'],'originalLabel':original,'expired':expired,'expiredConclusionRejected':expired,'originalPriceRetained':True,'originalTimestampRetained':True,'expiryAddedNetworkReads':0,'offline':True,'geometry':geometry,'pageErrors':errors,'syntheticInputs':True})
  ctx.close()
 browser.close()
(out/'browser.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
