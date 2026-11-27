import sys,json
from pathlib import Path
from playwright.sync_api import sync_playwright
cfg=json.load(sys.stdin);out=Path(cfg['output']);seen=[]
with sync_playwright() as play:
 browser=play.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for width,height in [(1366,900),(390,844)]:
  ctx=browser.new_context(viewport={'width':width,'height':height},is_mobile=width<400,has_touch=width<400)
  ctx.add_init_script("localStorage.setItem('qd_device',"+json.dumps(cfg['token'])+");localStorage.setItem('qd_role','edit')")
  page=ctx.new_page();reads=[];visual=[]
  def record(r):
   if r.url.endswith('/api/decision-center/research'):reads.append(r.json().get('code') or ('ok' if r.json().get('ok') else 'failed'))
   if '/api/decision-center/visuals?' in r.url:visual.append(r.status)
  page.on('response',record)
  page.goto(cfg['origin']+('/m' if width<400 else '/')+'#/home',wait_until='domcontentloaded')
  page.locator('#fy-intelligence-center > summary').click(timeout=25000)
  title=page.get_by_text('买入决策价与已结算成交',exact=True);retry=page.get_by_role('button',name='重试研究档案');retries=0
  while True:
   title.or_(retry).first.wait_for(timeout=25000)
   if title.is_visible():break
   assert retries<3,reads
   # Emulate a user returning to the readout after the admitted work drains.
   with page.expect_response(lambda r:r.url.endswith('/api/decision-center/research')):
    page.wait_for_timeout(800);retry.click()
   retries+=1
  title.click()
  detail=title.locator('..');text=detail.inner_text();assert '2 / 2' in text and '300' in text and '11.00' in text and '6.00' in text and '5.00' in text and '待独立证据' in text,text
  title.scroll_into_view_if_needed();assert reads==['WORKSPACE_BUSY']*retries+['ok'] and len(visual)==1,(reads,visual)
  page.screenshot(path=str(out/f'original-{width}.png'));seen.append({'viewport':[width,height],'path':page.url.split(cfg['origin'])[-1],'text':text,'researchResponses':reads,'visualRequests':len(visual),'manualRetries':retries});ctx.close()
 browser.close()
(out/'browser.json').write_text(json.dumps(seen,ensure_ascii=False,indent=2)+'\n')
