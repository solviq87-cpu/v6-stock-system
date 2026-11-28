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
  page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.route('**/*',lambda r:r.continue_() if r.request.url.startswith(cfg['origin']+'/') else r.abort())
  at=datetime.fromtimestamp(cfg['now']/1000,timezone.utc);page.clock.install(time=at);page.clock.pause_at(at)
  page.goto(cfg['origin']+('/m' if width<400 else '/')+'#/lab/backtest',wait_until='domcontentloaded')
  page.get_by_role('button',name='多期限原回测',exact=True).wait_for()
  page.locator('input[type=file]').first.set_input_files(cfg['history'])
  with page.expect_response(lambda r:r.url==cfg['origin']+'/api/research/complete-run') as response:
   page.get_by_role('button',name='多期限原回测',exact=True).click()
  data=response.value.json()['result']['holdingPeriodComparison'];assert data['datasetFingerprint']==cfg['expectedDatasetFingerprint'];assert data['protocolFingerprint']==cfg['expectedProtocolFingerprint']
  panel=page.get_by_role('region',name='多期限原回测');panel.wait_for()
  assert '不选择最佳期限' in panel.inner_text();assert panel.locator('tbody tr').count()==5
  assert panel.get_by_text('无买入成交',exact=True).count()==5
  assert panel.get_by_text('无买入成交，不评价',exact=True).count()==5
  assert '0.00%' not in panel.inner_text()
  page.clock.run_for(10000)
  with page.expect_response(lambda r:r.url==cfg['origin']+'/api/state'):
   page.get_by_role('button',name='刷新云端数据',exact=True).click()
  assert panel.is_visible(),'a real state refresh replaced the frozen comparison'
  workbench=page.locator('section.fy-panel').filter(has=page.get_by_role('heading',name='历史实验',exact=True)).first
  with page.expect_download() as download:
   workbench.get_by_role('button',name='导出本次证据',exact=True).click()
  exported_path=out/('export-'+str(width)+'.json');download.value.save_as(str(exported_path))
  exported=json.loads(exported_path.read_text());comp=exported['holdingPeriodComparison'];assert comp['datasetFingerprint']==cfg['expectedDatasetFingerprint']
  assert len(comp['periods'])==5 and comp['eligibleForPromotion'] is False
  assert all(len(x['report']['equity'])==93 and not x['report']['trades'] and not x['report']['orders'] for x in comp['periods'])
  geometry=page.evaluate('({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth})');assert geometry['scrollWidth']<=width+1,geometry
  page.clock.run_for(2500)
  panel.scroll_into_view_if_needed();page.evaluate('scrollBy(0,-110)');page.screenshot(path=str(out/('horizons-'+str(width)+'.png')),full_page=False)
  wrap=panel.locator('.fy-table-wrap');scroll=wrap.evaluate('(el)=>({width:el.clientWidth,scroll:el.scrollWidth})')
  if width<400:
   assert scroll['scroll']>scroll['width'];wrap.evaluate('(el)=>el.scrollLeft=el.scrollWidth')
   box=panel.locator('th').last.bounding_box();wbox=wrap.bounding_box();assert box['x']>=wbox['x']-1 and box['x']+box['width']<=wbox['x']+wbox['width']+1
  panel.locator('summary').click();assert '未认证独立预注册' in panel.inner_text()
  open_geometry=page.evaluate('({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth})');assert open_geometry['scrollWidth']<=width+1,open_geometry
  page.screenshot(path=str(out/('horizons-expanded-'+str(width)+'.png')),full_page=False)
  assert not errors,errors
  rows.append({'width':width,'rows':5,'allNoBuyFills':True,'noZeroReturnWinner':True,'frozenResultSurvivedStateRead':True,'completeExportVerified':True,'tableScroll':scroll,'geometry':geometry,'expandedGeometry':open_geometry,'pageErrors':errors,'realHistoricalSource':'archived-sina-current-vintage','actualFills':False})
  ctx.close()
 browser.close()
(out/'browser.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
