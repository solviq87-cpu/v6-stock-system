from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from threading import Thread
from functools import partial
from playwright.sync_api import sync_playwright
import argparse,json,hashlib,subprocess
p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--output',required=True);args=p.parse_args();root=Path(args.source);out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
html='''<!doctype html><meta charset="utf-8"><h1>隔离合成样本：原回放组件</h1><div id="mount"></div><script type="module">
import {createResearchReplay} from '/nova/evidence-workbench.mjs';
const cutoff=Date.parse('2026-11-10T15:30:00+08:00'),run={id:'a'.repeat(64),symbol:'600000'};
window.__apiCalls=[];
const ctx={role:'edit',api:async(path,options)=>{if(options?.method&&options.method!=='GET')throw Error('Fixture is read-only');window.__apiCalls.push({path,method:options?.method||'GET'});const query=new URL(path,location.origin).searchParams,identity='b'.repeat(64),point={value:1,knownAt:cutoff-1000,source:'isolated-original',ref:run.id,kind:'daily-change',seriesIdentity:identity};return {ok:true,result:{researchOnly:true,canTrade:false,canNotify:false,accountMutated:false,productionWeightsChanged:false,protocol:'fayo-evidence-replay-v1',scope:'historical-readonly',symbol:query.get('symbol'),asOf:Number(query.get('asOf')),runId:run.id,rows:['2026-11-08','2026-11-09','2026-11-10'].map(date=>({date,stock:point,sector:null,index:null})),boards:[],selectedBoard:null,missing:[],markers:[{researchOnly:true,canTrade:false,canNotify:false,accountMutated:false,productionWeightsChanged:false,kind:'news',at:cutoff-1000,knownAt:cutoff-500,ref:'news-original',source:'isolated-original',detail:{title:'合成原始证据'}}]}};}};
window.__view=createResearchReplay(ctx,{symbol:run.symbol,runId:run.id,asOf:cutoff});document.getElementById('mount').append(window.__view);
</script>'''.encode()
class Handler(SimpleHTTPRequestHandler):
 def do_GET(self):
  if self.path=='/__probe.html':self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.end_headers();self.wfile.write(html)
  else:super().do_GET()
 def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(root/'V6_BO/public')));Thread(target=server.serve_forever,daemon=True).start();origin=f'http://127.0.0.1:{server.server_port}';rows=[]
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  for width,height in [(1366,900),(390,844)]:
   ctx=browser.new_context(viewport={'width':width,'height':height});page=ctx.new_page();external=[];errors=[]
   page.route('**/*',lambda r:r.continue_() if r.request.url.startswith(origin+'/') else (external.append(r.request.url),r.abort())[-1]);page.on('pageerror',lambda e:errors.append(str(e)))
   page.goto(origin+'/__probe.html');page.get_by_role('button',name='读取联动回放',exact=True).click();page.wait_for_function('window.__apiCalls.length===1&&window.__view.textContent.includes("逐日数值")')
   facts=page.evaluate('''()=>{const marker=[],walk=document.createTreeWalker(window.__view,NodeFilter.SHOW_TEXT);while(walk.nextNode())if(['null','undefined'].includes(walk.currentNode.data))marker.push(walk.currentNode.data);return {nullPlaceholders:marker,apiCalls:window.__apiCalls,hasOriginalDetails:window.__view.textContent.includes('逐日数值')};}''');assert not external and not errors;facts.update(width=width,externalRequests=external,pageErrors=errors)
   page.screenshot(path=str(out/f'component-{width}.png'),full_page=True);rows.append(facts);ctx.close()
  browser.close()
finally:server.shutdown();server.server_close()
source=root/'V6_BO/public/nova/evidence-workbench.mjs';r={'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'componentSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'rows':rows,'scope':'Actual native component in Chromium with explicitly synthetic read-only API; no account, live market, physical device or product-wide acceptance.'};(out/'browser.json').write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'widths':[x['width'] for x in rows],'literalNullCounts':[len(x['nullPlaceholders']) for x in rows],'externalRequests':0}))
