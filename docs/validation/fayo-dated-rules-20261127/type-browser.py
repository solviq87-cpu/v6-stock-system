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
  page.goto(cfg['origin']+('/m' if width<400 else '/')+'#/lab/evidence',wait_until='domcontentloaded')
  with page.expect_response(lambda r:'/api/research/news-evidence?' in r.url,timeout=20000) as response:
   page.get_by_role('button',name='读取新闻与公告证据',exact=True).click()
  assert response.value.status==200
  for text in ['600000','普通股A股 · 原文字样','360003','优先股 · 原文字样','510300','ETF基金 · 原文字样','原始时间未知']:
   assert page.get_by_text(text,exact=False).count()>0,text
  target=page.get_by_role('heading',name='证券类型线索',exact=True).first
  target.scroll_into_view_if_needed();page.screenshot(path=str(out/('type-'+str(width)+'.png')),full_page=False)
  assert not errors,errors
  records.append({'viewport':[width,height],'http':response.value.status,'typeCards':page.get_by_role('heading',name='证券类型线索',exact=True).count(),'pageErrors':errors,'originalPublicationShownUnknown':page.get_by_text('原始时间未知',exact=True).count()>0,'realDocumentExcerpts':True,'permission':'editor-research-view-only'})
  ctx.close()
 browser.close()
(out/'type-browser.json').write_text(json.dumps(records,ensure_ascii=False,indent=2)+'\n')
