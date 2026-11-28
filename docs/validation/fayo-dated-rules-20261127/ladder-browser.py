import json,sys
from pathlib import Path
from playwright.sync_api import sync_playwright
cfg=json.load(sys.stdin);out=Path(cfg['output']);records=[]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for width,height in [(1366,900),(390,844)]:
  ctx=browser.new_context(viewport={'width':width,'height':height},is_mobile=width<400,has_touch=width<400)
  ctx.add_init_script("localStorage.setItem('qd_device',"+json.dumps(cfg['token'])+");localStorage.setItem('qd_role','edit')")
  page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.route('**/*',lambda r:r.continue_() if r.request.url.startswith(cfg['origin']+'/') else r.abort())
  page.goto(cfg['origin']+('/m' if width<400 else '/')+'#/lab/backtest',wait_until='domcontentloaded')
  for filename,matched in [('ladder-normal.json',True),('ladder-no-limit.json',False),('ladder-ipo.json',False),('ladder-dated.json',True),('ladder-gap.json',False)]:
   page.locator('input[type=file]').first.set_input_files(str(out/filename))
   with page.expect_response(lambda r:r.url.endswith('/api/research/complete-run'),timeout=60000) as pending:
    page.get_by_role('button',name='运行完整实验',exact=True).click(timeout=15000)
   reply=pending.value;body=reply.json();assert reply.status==200 and body.get('ok'),body
   result=body['result'];rules=result['selectionEvidence']['candidates'][0]['rationale']['selection']['rules']
   assert any(r['id']=='playbook:first_board_quality' for r in rules)==matched,rules
   assert result['canTrade'] is False and result['verifiedLive'] is False
   try:
    page.get_by_text('完整证据与检验链',exact=True).last.click(timeout=8000)
   except Exception:
    (out/'browser-diagnostic.txt').write_text(page.locator('main').inner_text()+'\nErrors '+repr(errors))
    page.screenshot(path=str(out/'browser-diagnostic.png'),full_page=True)
    raise

   if matched:
    target=page.get_by_text('首板质量',exact=True).first
    target.wait_for(state='attached')
    target.evaluate('(node)=>{for(let p=node.parentElement;p;p=p.parentElement)if(p.tagName==="DETAILS")p.open=true;}')
    target.scroll_into_view_if_needed()
   assert not errors,errors
   page.screenshot(path=str(out/(filename[:-5]+'-'+str(width)+'.png')),full_page=False)
   records.append({'viewport':[width,height],'input':filename,'http':reply.status,'matched':matched,'canTrade':result['canTrade'],'coverage':result['dataset']['historicalCoverage']['status'],'errors':errors})
  ctx.close()
 browser.close()
(out/'browser.json').write_text(json.dumps(records,ensure_ascii=False,indent=2)+'\n')
