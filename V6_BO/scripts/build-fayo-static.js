#!/usr/bin/env node
'use strict';

// Builds a review artifact, not a service or a publication. The existing
// WorkBuddy release builder must separately attest and validate this HTML.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../..');
const FRONTEND=path.join(ROOT,'V6_BO/public/nova');
const CATALOG=path.join(ROOT,'V6_BO/public/assets/model-library-catalog.json');
const PINNED_ESBUILD='0.25.12';
const SCOPE='frontend-only-backend-required';
const MAX_BYTES=2*1024*1024;
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const inside=(root,file)=>file===root||file.startsWith(root+path.sep);
const safeJSON=value=>JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,char=>({'<':'\\u003c','>':'\\u003e','&':'\\u0026','\u2028':'\\u2028','\u2029':'\\u2029'}[char]));

function loadEsbuild(){
  let module;
  try{module=require(path.join(ROOT,'V6_WEB/node_modules/esbuild'));}
  catch{throw Error('Pinned esbuild 0.25.12 is required; run npm ci --prefix V6_WEB');}
  if(module.version!==PINNED_ESBUILD)throw Error('Pinned esbuild 0.25.12 is required; run npm ci --prefix V6_WEB');
  return module;
}
function regular(file,limit=MAX_BYTES){
  const stat=fs.statSync(file);
  if(!stat.isFile()||stat.size>limit)throw Error('Frontend source must be a bounded ordinary file');
  return fs.readFileSync(file,'utf8');
}
function validateCatalog(catalog){
  if(catalog?.schemaVersion!==1||typeof catalog.reviewDate!=='string'||!Array.isArray(catalog.entries)||catalog.entries.length>256)throw Error('Public model catalog is invalid');
  function credentials(value){if(!value||typeof value!=='object')return;for(const [key,item]of Object.entries(value)){if(/(?:api.?key|token|password|secret|credential|cookie)/i.test(key)&&typeof item==='string'&&item.trim())throw Error('Public catalog must not contain credentials');credentials(item);}}
  credentials(catalog);
  const ids=new Set();
  for(const entry of catalog.entries){
    if(!entry||typeof entry.id!=='string'||!entry.id||ids.has(entry.id)||typeof entry.name!=='string')throw Error('Public model catalog entry is invalid');
    ids.add(entry.id);
  }
}
function validateStyles(styles){
  for(const match of styles.matchAll(/(?:@import\s+(?:url\()?\s*|url\(\s*)(['"]?)([^'"\s)]+)\1/gi))if(!/^(?:data:|#)/i.test(match[2]))throw Error('FAYO artifact has an external CSS asset');
}
function validateArtifact(html){
  if(Buffer.byteLength(html)>MAX_BYTES||!/^\s*<!doctype html\s*>/i.test(html)||!html.includes('绯曜')||!html.includes('FAYO')||!html.includes('fayo-artifact-scope'))throw Error('FAYO artifact identity is invalid');
  // Validate markup, rather than rejecting functional source/download links
  // appearing as strings inside the bundle.
  const markup=html.replace(/<!--[^]*?-->/g,'').replace(/<(script|style)\b[^>]*>[^]*?<\/\1\s*>/gi,'');
  for(const tag of markup.match(/<(?:link|img|script|source|video|audio|iframe|object|embed)\b[^>]*>/gi)||[]){
    for(const match of tag.matchAll(/\b(?:src|srcset|href|poster|data)\s*=\s*(['"])(.*?)\1/gi))if(!/^data:/i.test(match[2]))throw Error('FAYO artifact has an external asset');
  }
  if(/<iframe\b|<object\b|<embed\b/i.test(markup))throw Error('FAYO artifact must not embed another application');
  if(/(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9_]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,})/.test(html)||
    /\b(?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*(['"])[^'"]+\1/i.test(html)||
    /https?:\/\/[^\s/'"<>]+:[^\s/@'"<>]+@/i.test(html))throw Error('FAYO artifact contains a possible embedded credential');
  if(/(?:api\.openai\.com|\bopenai[_-]api[_-]key\b)/i.test(html))throw Error('OpenAI runtime API access is forbidden');
  const styles=[...html.matchAll(/<style\b[^>]*>([^]*?)<\/style\s*>/gi)].map(match=>match[1]).join('\n');
  validateStyles(styles);
  return html;
}

async function buildFayoStatic({frontendDir=FRONTEND,catalogFile=CATALOG,outputFile}={}){
  const esbuild=loadEsbuild();
  const sourceRoot=fs.realpathSync(frontendDir);
  if(!fs.statSync(sourceRoot).isDirectory())throw Error('Frontend source directory is invalid');
  const source=regular(path.join(sourceRoot,'index.html'));
  if(!/<title\b[^>]*>[^<]*绯曜[^<]*FAYO[^<]*<\/title>/i.test(source))throw Error('FAYO canonical entry must identify the new product');
  const css=regular(path.join(sourceRoot,'fayo.css'));
  const mark=regular(path.join(sourceRoot,'mark.svg'),64*1024);
  if(!/^\s*<svg\b/i.test(mark)||/<script\b|\bon\w+\s*=|\b(?:href|src)\s*=/i.test(mark))throw Error('FAYO mark must be a passive self-contained SVG');
  const icon='data:image/svg+xml;base64,'+Buffer.from(mark).toString('base64');
  const catalogRaw=regular(catalogFile),catalog=JSON.parse(catalogRaw);validateCatalog(catalog);
  const snapshots=new Map([
    ['index.html',hash(source)],['fayo.css',hash(css)],['mark.svg',hash(mark)],
    ['../assets/model-library-catalog.json',hash(catalogRaw)]
  ]);
  const build=await esbuild.build({
    entryPoints:[path.join(sourceRoot,'app.js')],absWorkingDir:sourceRoot,
    bundle:true,write:false,metafile:true,format:'iife',platform:'browser',target:'es2020',
    charset:'utf8',sourcemap:false,legalComments:'none',minify:false,logLevel:'silent',
    plugins:[{name:'fayo-standalone-source',setup(builder){
      builder.onLoad({filter:/\.m?js$/},args=>{
        const real=fs.realpathSync(args.path);
        if(!inside(sourceRoot,real))throw Error('FAYO static entry may import only the independent frontend');
        let contents=regular(real);
        snapshots.set(path.relative(sourceRoot,real).split(path.sep).join('/'),hash(contents));
        contents=contents.replace(/(['"])\/nova\/mark\.svg\1/g,()=>safeJSON(icon));
        // Shadow-tree styles and the CSV download are loaded by JS on a running V6 server.
        // The single-file review artifact carries those same public bytes and source hashes.
        contents=contents.replace(/\/nova\/(shortline-sheet\.css|shortline\/overview\.css|shortline\/sample-kline\.csv)(?=['"])/g,(_match,file)=>{
          const asset=fs.realpathSync(path.join(sourceRoot,file));
          if(!inside(sourceRoot,asset))throw Error('FAYO static asset escapes the native frontend');
          const raw=regular(asset),isCss=file.endsWith('.css');
          if(isCss)validateStyles(raw);
          snapshots.set(file,hash(raw));
          return 'data:'+(isCss?'text/css':'text/csv')+';charset=utf-8;base64,'+Buffer.from(raw).toString('base64');
        });
        // A review document must not register a service worker on its host.
        contents=contents.replace(/navigator\.serviceWorker\.register\(\s*(['"])\/sw\.js\1\s*\)/g,'Promise.resolve(null)');
        return {contents,loader:'js'};
      });
    }}]
  });
  if(build.outputFiles.length!==1||build.metafile.outputs[Object.keys(build.metafile.outputs)[0]].imports.length)throw Error('FAYO bundle must contain every native module');
  for(const input of Object.keys(build.metafile.inputs)){
    const actual=fs.realpathSync(path.resolve(sourceRoot,input));
    if(!inside(sourceRoot,actual))throw Error('FAYO bundle imported a legacy or external module');
  }
  const bundle=build.outputFiles[0].text;
  if(/import\s*\(|navigator\.serviceWorker\.register\(/.test(bundle))throw Error('FAYO artifact contains an unresolved runtime asset');
  const wrapper=`(() => {\n'use strict';\nconst fayoPublicCatalog = ${safeJSON(catalog)};\nconst fayoNativeFetch = globalThis.fetch.bind(globalThis);\nconst fetch = (input,options={}) => {\n  const settings=options||{};\n  const address=typeof input==='string'?input:typeof input?.url==='string'?input.url:typeof input?.href==='string'?input.href:String(input);\n  const target=new URL(address,location.href);\n  const method=(settings.method||(typeof input?.method==='string'?input.method:'GET')).toUpperCase();\n  const signal=settings.signal||input?.signal;\n  if(target.origin===location.origin&&target.pathname==='/assets/model-library-catalog.json'&&method==='GET') {\n    if(signal?.aborted)return Promise.reject(new DOMException('Aborted','AbortError'));\n    return Promise.resolve(new Response(JSON.stringify(fayoPublicCatalog),{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}}));\n  }\n  return fayoNativeFetch(input,options);\n};\n${bundle}\n})();`;
  const script=wrapper.replace(/<\/script/gi,'<\\/script');
  let cssInline=css.replace(/url\(\s*(['"]?)\/nova\/mark\.svg\1\s*\)/g,'url("'+icon+'")').replace(/<\/style/gi,'<\\/style');
  const cssTags=[...source.matchAll(/<link\b[^>]*\brel=['"]stylesheet['"][^>]*>/gi)];
  const scripts=[...source.matchAll(/<script\b[^>]*\bsrc=['"][^'"]+['"][^>]*>[^]*?<\/script\s*>/gi)];
  if(cssTags.length!==1||scripts.length!==1)throw Error('FAYO canonical entry assets are ambiguous');
  let html=source.replace(cssTags[0][0],'<style data-fayo-inline="theme">\n'+cssInline+'\n</style>')
    .replace(scripts[0][0],'')
    .replace(/<link\b[^>]*\brel=['"]manifest['"][^>]*>\s*/gi,'')
    .replace(/\b(src|href)=(["'])\/nova\/mark\.svg(?:\?[^"']*)?\2/g,(_,attr,quote)=>attr+'='+quote+icon+quote);
  const banner='<aside class="fayo-static-notice" role="note">独立前端预览 · 行情、账户与研究需要连接同源后台服务；本文件不包含后台运行能力。</aside>';
  html=html.replace(/<\/head\s*>/i,'<meta name="fayo-artifact-scope" content="'+SCOPE+'">\n<style>.fayo-static-notice{padding:9px 18px;background:#2a1533;border-bottom:1px solid #68406d;color:#ecc8eb;font:12px/1.6 system-ui,sans-serif;text-align:center}</style>\n</head>')
    .replace(/(<body\b[^>]*>)/i,'$1\n'+banner)
    // Canonical type=module is deferred. The standalone classic bundle must
    // execute only after the root element and boot markup have been parsed.
    .replace(/<\/body\s*>/i,'<script data-fayo-inline="application">\n'+script+'\n</script>\n</body>');
  validateArtifact(html);
  if(outputFile){
    const output=path.resolve(outputFile);
    // Never overwrite the source, including through an existing hard link.
    if(inside(sourceRoot,output)||output===path.resolve(catalogFile))throw Error('Output must be outside the canonical frontend sources');
    if(fs.existsSync(output)){
      const dest=fs.statSync(output);
      for(const file of [...snapshots.keys()].filter(file=>!file.startsWith('..')).map(file=>path.join(sourceRoot,file)).concat(catalogFile)){
        const sourceStat=fs.statSync(file);if(dest.dev===sourceStat.dev&&dest.ino===sourceStat.ino)throw Error('Output must not overwrite canonical source bytes');
      }
    }
    fs.mkdirSync(path.dirname(output),{recursive:true});
    fs.writeFileSync(output,html,{encoding:'utf8',mode:0o600});
  }
  return {html,scope:SCOPE,artifactSha256:hash(html),sizeBytes:Buffer.byteLength(html),esbuildVersion:esbuild.version,
    embeddedCatalogCount:catalog.entries.length,sources:[...snapshots].sort(([a],[b])=>a.localeCompare(b)).map(([file,sha256])=>({file,sha256}))};
}
if(require.main===module){
  const args=process.argv.slice(2);
  if(args.length!==2||args[0]!=='--output'||!args[1]){process.stderr.write('Use node scripts/build-fayo-static.js --output FILE\n');process.exitCode=1;}
  else buildFayoStatic({outputFile:args[1]}).then(({html,...metadata})=>process.stdout.write(JSON.stringify(metadata)+'\n')).catch(error=>{process.stderr.write('FAYO static build failed: '+(error.message.startsWith('Pinned esbuild')?error.message:'invalid or unsupported frontend source')+'\n');process.exitCode=1;});
}
module.exports={buildFayoStatic,validateArtifact,PINNED_ESBUILD,SCOPE};
