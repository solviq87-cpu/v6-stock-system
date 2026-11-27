import json,sys
from pathlib import Path
from playwright.sync_api import sync_playwright
cfg=json.load(sys.stdin);out=Path(cfg['output']);rows=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for width,height in [(1366,900),(390,844),(320,740)]:
  ctx=browser.new_context(viewport={'width':width,'height':height},is_mobile=width<400,has_touch=width<400)
  ctx.add_init_script("localStorage.setItem('qd_device',"+json.dumps(cfg['token'])+");localStorage.setItem('qd_role','edit');const RealDate=Date;globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:["+str(cfg['now'])+"]));}static now(){return "+str(cfg['now'])+"}}")
  page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.route('**/*',lambda r:r.continue_() if r.request.url.startswith(cfg['origin']+'/') else r.abort())
  page.goto(cfg['origin']+('/m' if width<400 else '/')+'#/pulse/market-overview',wait_until='domcontentloaded')
  detail=page.locator('details.fy-recovery-status');detail.wait_for();detail.locator('summary').click()
  page.get_by_text(cfg['label'],exact=False).wait_for();page.get_by_text('本交易日重新采样，不恢复旧报价或旧异动结论。',exact=False).wait_for()
  if cfg['case']=='restored':page.get_by_text('首次异动',exact=False).first.wait_for()
  geometry=page.evaluate('({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth})')
  assert geometry['scrollWidth']<=geometry['viewport']+1,geometry
  assert not errors,errors
  detail.scroll_into_view_if_needed();page.screenshot(path=str(out/(cfg['case']+'-'+str(width)+'.png')),full_page=False)
  rows.append({'case':cfg['case'],'viewport':[width,height],'geometry':geometry,'pageErrors':errors,'label':cfg['label'],'syntheticInputs':True})
  ctx.close()
 browser.close()
(out/(cfg['case']+'-browser.json')).write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
