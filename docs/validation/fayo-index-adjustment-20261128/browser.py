import json,sys
from pathlib import Path
from datetime import datetime,timezone,timedelta
from playwright.sync_api import sync_playwright
cfg=json.load(sys.stdin);out=Path(cfg['output']);records=[]
cases=[('actual-current','600176','计划日期未到',None),('actual-old','','已过计划日期，实施未核实',None),('synthetic-withdrawn','600000','该截点不作为有效计划',None),('synthetic-historical','600000','计划日期未到',cfg['historicalAsOf'])]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for width,height in [(1366,900),(390,844),(320,740)]:
  ctx=browser.new_context(viewport={'width':width,'height':height},is_mobile=width<400,has_touch=width<400)
  ctx.add_init_script("localStorage.setItem('qd_device',"+json.dumps(cfg['token'])+");localStorage.setItem('qd_role','edit')")
  page=ctx.new_page();errors=[];requests=[];page.on('pageerror',lambda e:errors.append(str(e)))
  def route(r):
   if r.request.url.startswith(cfg['origin']+'/'):
    requests.append(r.request.url.removeprefix(cfg['origin']));r.continue_()
   else:r.abort()
  page.route('**/*',route)
  page.goto(cfg['origin']+('/m' if width<400 else '/')+'#/lab/evidence',wait_until='domcontentloaded')
  for case,symbol,label,at in cases:
   page.get_by_label('证券代码（留空查看全部）',exact=True).fill(symbol)
   value=(datetime.fromtimestamp(at/1000,timezone.utc)+timedelta(hours=8)).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] if at else ''
   page.get_by_label('历史截点（北京时间，留空查看当前）',exact=True).fill(value)
   with page.expect_response(lambda r:'/api/research/news-evidence?' in r.url,timeout=20000) as pending:
    page.get_by_role('button',name='读取新闻与公告证据',exact=True).click()
   reply=pending.value;assert reply.status==200
   target=page.get_by_text(label,exact=True).first;target.wait_for();target.scroll_into_view_if_needed()
   if case=='actual-current':
    assert page.get_by_text('600176 中国巨石',exact=False).count()>0
    assert page.get_by_text('600050 中国联通',exact=False).count()>0
    assert page.get_by_text('2026-12-11 · 收市后，未提供具体时分',exact=True).count()>0
   if case=='actual-old':assert page.get_by_text('2025-12-12 · 收市后，未提供具体时分',exact=True).count()>0
   if case=='synthetic-withdrawn':assert page.get_by_text('来源已撤稿',exact=True).count()>0
   geometry=page.evaluate('({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth})')
   assert geometry['scrollWidth']<=geometry['viewport']+1,geometry
   assert not errors,errors
   if case in ['actual-current','synthetic-withdrawn']:page.screenshot(path=str(out/(case+'-'+str(width)+'.png')),full_page=False)
   records.append({'case':case,'inputClass':'actual public excerpt' if case.startswith('actual') else 'synthetic isolated control','viewport':[width,height],'http':reply.status,'label':label,'geometry':geometry,'pageErrors':errors[:]})
  assert all(not x.startswith('/api/paper') for x in requests)
  ctx.close()
 browser.close()
(out/'browser.json').write_text(json.dumps({'scope':'Original software, CSS viewports only, all external browser requests blocked. Not physical-device or mainland-network acceptance.','records':records},ensure_ascii=False,indent=2)+'\n')
