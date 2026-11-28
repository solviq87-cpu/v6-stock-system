import json,sys,time
from pathlib import Path
from datetime import datetime,timezone
from playwright.sync_api import sync_playwright
cfg=json.load(sys.stdin);out=Path(cfg['output']);rows=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for width,height in [(1366,900),(390,844),(320,740)]:
  ctx=browser.new_context(viewport={'width':width,'height':height},is_mobile=width<400,has_touch=width<400)
  ctx.add_init_script("localStorage.setItem('qd_device',"+json.dumps(cfg['token'])+");localStorage.setItem('qd_role','edit');globalThis.__testVisible=true;Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>globalThis.__testVisible?'visible':'hidden'});")
  page=ctx.new_page();errors=[];reads=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.on('request',lambda r:reads.append(r.url.split('?')[0]) if '/api/decision-center' in r.url and '/api/decision-center/' not in r.url else None)
  page.route('**/*',lambda r:r.continue_() if r.request.url.startswith(cfg['origin']+'/') else r.abort())
  at=datetime.fromtimestamp(cfg['now']/1000,timezone.utc);page.clock.install(time=at);page.clock.pause_at(at)
  with page.expect_response(lambda r:r.url==cfg['origin']+'/api/decision-center'):
   page.goto(cfg['origin']+('/m' if width<400 else '/')+'#/pulse/overview',wait_until='domcontentloaded')
  host=page.locator('.fy-decision-board');host.wait_for();time.sleep(.1)
  page.evaluate("globalThis.__mutations=0;new MutationObserver(x=>globalThis.__mutations+=x.length).observe(document.querySelector('.fy-decision-board'),{subtree:true,childList:true,characterData:true});globalThis.__testVisible=false;document.dispatchEvent(new Event('visibilitychange'))")
  before=len(reads);page.clock.run_for(10000);hidden_mutations=page.evaluate('globalThis.__mutations');hidden_reads=len(reads)-before
  if cfg['baseline']:assert hidden_mutations>0
  else:assert hidden_mutations==0,hidden_mutations
  assert hidden_reads==0,hidden_reads
  page.evaluate("globalThis.__testVisible=true;document.dispatchEvent(new Event('visibilitychange'))")
  if not cfg['baseline']:assert page.evaluate('globalThis.__mutations')>hidden_mutations,'resume did not immediately recheck display'
  time.sleep(.1);ctx.set_offline(True);page.evaluate("dispatchEvent(new Event('offline'))")
  before=len(reads);page.clock.run_for(15000);offline_reads=len(reads)-before
  if cfg['baseline']:assert offline_reads>0,offline_reads
  else:assert offline_reads==0,offline_reads
  assert host.get_by_text('今天空仓，等待信号',exact=True).is_visible()
  geometry=page.evaluate('({viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth})');assert geometry['scrollWidth']<=width+1,geometry
  page.screenshot(path=str(out/('idle-'+str(width)+'.png')),full_page=False)
  page.evaluate("location.hash='#/opportunities/all'")
  page.wait_for_function("!document.querySelector('.fy-decision-board')")
  before=len(reads);page.evaluate("document.dispatchEvent(new Event('visibilitychange'));dispatchEvent(new Event('online'))");page.clock.run_for(10000)
  assert len(reads)==before,'leaving the route resurrected a decision read'
  assert not errors,errors
  rows.append({'width':width,'baseline':cfg['baseline'],'hiddenWindowMs':10000,'hiddenMutations':hidden_mutations,'hiddenDecisionReads':hidden_reads,'offlineWindowMs':15000,'offlineDecisionReadAttempts':offline_reads,'routeAbortAddedDecisionReads':0,'noCandidates':True,'visibilityIsSimulated':True,'geometry':geometry,'pageErrors':errors})
  ctx.close()
  # navigator.onLine is only a coarse hint. A reachable local backend must
  # still get the existing one-time initial read, even with that flag false.
  local=browser.new_context(viewport={'width':width,'height':height})
  local.add_init_script("localStorage.setItem('qd_device',"+json.dumps(cfg['token'])+");localStorage.setItem('qd_role','edit');Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false});")
  q=local.new_page();q.route('**/*',lambda r:r.continue_() if r.request.url.startswith(cfg['origin']+'/') else r.abort())
  q.clock.install(time=at);q.clock.pause_at(at)
  with q.expect_response(lambda r:r.url==cfg['origin']+'/api/decision-center') as response:
   q.goto(cfg['origin']+('/m' if width<400 else '/')+'#/pulse/overview',wait_until='domcontentloaded')
  assert response.value.status==200;rows[-1]['initialLocalReadWithOfflineFlag']=200
  local.close()
 browser.close()
(out/'browser.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
