import json,sys
from pathlib import Path
from datetime import datetime,timezone,timedelta
from playwright.sync_api import sync_playwright
cfg=json.load(sys.stdin);out=Path(cfg['output']);records=[]
cases=[('actual-buyback','003025','材料称已实施完毕',None),('actual-disposal','600050','材料称尚未实施完毕',None),('synthetic-withdrawn','600001','该截点已停用，仅供历史核对',None),('synthetic-historical','600001','材料声明，未独立核实',cfg['historicalAsOf'])]
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
  page.route('**/*',route);page.goto(cfg['origin']+('/m' if width<400 else '/')+'#/lab/evidence',wait_until='domcontentloaded')
  for case,symbol,label,at in cases:
   page.get_by_label('证券代码（留空查看全部）',exact=True).fill(symbol)
   value=(datetime.fromtimestamp(at/1000,timezone.utc)+timedelta(hours=8)).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] if at else ''
   page.get_by_label('历史截点（北京时间，留空查看当前）',exact=True).fill(value)
   with page.expect_response(lambda r:'/api/research/news-evidence?' in r.url,timeout=20000) as pending:page.get_by_role('button',name='读取新闻与公告证据',exact=True).click()
   assert pending.value.status==200
   target=page.get_by_text(label,exact=False).first;target.wait_for();target.scroll_into_view_if_needed()
   if case=='actual-buyback':
    for text in ['3,000 万元 · 人民币','5,000 万元 · 人民币','34,789,896.38 元 · 人民币','2,620,000 股']:
     assert page.get_by_text(text,exact=True).count()>0,text
    assert page.get_by_role('heading',name='累计执行声明',exact=True).count()==1
   if case=='actual-disposal':
    assert page.get_by_text('40,700,300 股',exact=True).count()>0
    assert page.get_by_role('heading',name='指数调样计划',exact=True).count()==1
   geometry=page.evaluate('({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth})');assert geometry['scrollWidth']<=geometry['viewport']+1,geometry;assert not errors,errors
   if case in ['actual-buyback','actual-disposal']:page.screenshot(path=str(out/(case+'-'+str(width)+'.png')),full_page=False)
   records.append({'case':case,'inputClass':'actual factual excerpt' if case.startswith('actual') else 'synthetic isolated control','viewport':[width,height],'http':200,'label':label,'geometry':geometry,'pageErrors':errors[:]})
  assert all(not r.startswith('/api/paper') for r in requests);ctx.close()
 browser.close()
(out/'browser.json').write_text(json.dumps({'scope':'Original program, 3 CSS viewports, external browser requests blocked. Not physical-device/mainland-network acceptance.','records':records},ensure_ascii=False,indent=2)+'\n')
