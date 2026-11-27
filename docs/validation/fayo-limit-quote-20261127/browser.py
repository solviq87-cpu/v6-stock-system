import json,sys
from pathlib import Path
from playwright.sync_api import sync_playwright
cfg=json.load(sys.stdin);out=Path(cfg['output']);results=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for width,height in [(1366,900),(390,844)]:
  ctx=browser.new_context(viewport={'width':width,'height':height},is_mobile=width<400,has_touch=width<400)
  ctx.add_init_script("localStorage.setItem('qd_device',"+json.dumps(cfg['token'])+");localStorage.setItem('qd_role','edit')")
  page=ctx.new_page();errors=[];writes=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.on('request',lambda r:writes.append(r.post_data_json) if r.url.endswith('/api/research/order-account') and r.method=='POST' else None)
  page.route('**/*',lambda route:route.continue_() if route.request.url.startswith(cfg['origin']+'/') else route.abort())
  page.goto(cfg['origin']+('/m' if width<400 else '/')+'#/assets/authority',wait_until='domcontentloaded')
  page.get_by_role('button',name='读取账户',exact=True).click(timeout=15000)
  region=page.locator('[data-operations-sub="authority"]')
  region.get_by_role('heading',name='委托状态',exact=True).wait_for()
  table=region.locator('table').filter(has=page.get_by_role('columnheader',name='股数',exact=True)).first
  row=table.locator('tbody tr').filter(has_text='600000').first
  if cfg['shares']:
   assert row.locator('td').nth(1).inner_text()==str(cfg['shares']),row.inner_text()
  else:assert table.locator('tbody tr').filter(has_text='600000').count()==0
  if cfg['sellStatus']:
   orders=region.locator('table').filter(has=page.get_by_role('columnheader',name='剩余数量',exact=True)).first
   sell=orders.locator('tbody tr').filter(has=page.get_by_role('cell',name='s',exact=True)).first
   assert sell.get_by_role('cell',name=cfg['sellStatus'],exact=True).count()==1,sell.inner_text()
   assert sell.locator('td').last.inner_text()==str(cfg['remaining']),sell.inner_text()
  assert not errors,errors
  assert all(w.get('action')=='read' for w in writes),writes
  region.scroll_into_view_if_needed();page.screenshot(path=str(out/(cfg['stage']+'-'+str(width)+'.png')),full_page=True)
  if cfg['stage']=='partial-exit':
   orders.evaluate('(table)=>{table.parentElement.scrollLeft=table.scrollWidth;}')
   orders.scroll_into_view_if_needed()
   page.screenshot(path=str(out/('partial-exit-order-'+str(width)+'.png')))
  results.append({'viewport':[width,height],'stage':cfg['stage'],'shares':cfg['shares'],'sellStatus':cfg['sellStatus'],'remaining':cfg['remaining'],'readActions':len(writes),'otherAccountActions':0,'errors':errors})
  ctx.close()
 browser.close()
(out/(cfg['stage']+'-browser.json')).write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
