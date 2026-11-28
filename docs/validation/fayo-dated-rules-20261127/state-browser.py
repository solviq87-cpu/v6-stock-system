import json,sys
from pathlib import Path
from datetime import datetime,timezone,timedelta
from playwright.sync_api import sync_playwright
cfg=json.load(sys.stdin);out=Path(cfg['output']);rows=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for width,height in [(1366,900),(390,844),(320,740)]:
  ctx=browser.new_context(viewport={'width':width,'height':height},is_mobile=width<400,has_touch=width<400)
  ctx.add_init_script("localStorage.setItem('qd_device',"+json.dumps(cfg['token'])+");localStorage.setItem('qd_role','edit')")
  page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.route('**/*',lambda r:r.continue_() if r.request.url.startswith(cfg['origin']+'/') else r.abort())
  page.goto(cfg['origin']+('/m' if width<400 else '/')+'#/lab/evidence',wait_until='domcontentloaded')
  for c in cfg['cases']+[{'id':'actual-stock','symbol':'600000','label':'普通股A股 · 原文字样'},{'id':'actual-preferred','symbol':'360003','label':'优先股 · 原文字样'},{'id':'actual-etf','symbol':'510300','label':'ETF基金 · 原文字样'}]:
   if c['id']=='superseded':
    with page.expect_response(lambda r:'/api/research/news-evidence?' in r.url) as pending:
     page.get_by_role('button',name='更早版本',exact=True).click()
   else:
    page.get_by_label('证券代码（留空查看全部）',exact=True).fill(c['symbol'])
    value=(datetime.fromtimestamp(c['asOf']/1000,timezone.utc)+timedelta(hours=8)).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] if 'asOf' in c else ''
    page.get_by_label('历史截点（北京时间，留空查看当前）',exact=True).fill(value)
    with page.expect_response(lambda r:'/api/research/news-evidence?' in r.url) as pending:
     page.get_by_role('button',name='读取新闻与公告证据',exact=True).click()
   assert pending.value.status==200
   target=page.get_by_role('heading',name='证券类型线索',exact=True).first
   target.wait_for();target.scroll_into_view_if_needed()
   assert page.get_by_text(c['label'],exact=False).count()>0,c
   if c['id']=='incomplete':assert page.get_by_text('旧版本，当前停用',exact=False).count()==0
   if c['id']!='historical':assert page.get_by_text('最新归档版本',exact=True).count()>0
   geometry=page.evaluate('({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth})')
   assert geometry['scrollWidth']<=geometry['viewport']+1,geometry
   assert not errors,errors
   if c['id'] in ['incomplete','retracted','conflict']:page.screenshot(path=str(out/(c['id']+'-'+str(width)+'.png')),full_page=False)
   rows.append({'case':c['id'],'viewport':[width,height],'http':pending.value.status,'label':c['label'],'geometry':geometry,'pageErrors':errors[:]})
  ctx.close()
 browser.close()
(out/'state-browser.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
