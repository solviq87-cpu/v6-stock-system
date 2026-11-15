'use strict';
// curl respects the host's existing HTTPS proxy settings; Node's native fetch
// does not on all supported Node 22 versions. No proxy settings are changed.
const {spawnSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const PROXIES=['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'];
function proxyEnv(env){return Object.fromEntries(PROXIES.filter(k=>typeof env[k]==='string').map(k=>[k,env[k]]));}
async function readPublic(url,options={},deps={}){
 const github=url.startsWith('https://api.github.com/repos/solviq87-cpu/v6-stock-system/');
 const pip=url==='https://files.pythonhosted.org/packages/44/3c/d717024885424591d5376220b5e836c2d5293ce2011523c9de23ff7bf068/pip-25.3-py3-none-any.whl';
 if(!github&&!pip)throw Object.assign(Error('network-target-refused'),{code:'network-target-refused'});
 const args=['--disable','--fail','--silent','--show-error','--proto','=https','--max-time',pip?'180':'15'];
 if(pip)args.push('--connect-timeout','15','--retry','2','--retry-delay','2','--retry-max-time','540');
 for(const [name,value]of Object.entries(options.headers||{})){if(!['Accept','User-Agent','Authorization'].includes(name)||/[\r\n]/.test(value))throw Error('invalid-network-header');args.push('--header',name+': '+value);}
 args.push('--url',url);
 let temporary,output;
 try {
  if(pip){
   temporary=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-bootstrap-download-'));fs.chmodSync(temporary,0o700);
   output=path.join(temporary,'pip.whl');fs.writeFileSync(output,'',{flag:'wx',mode:0o600});
   // curl can truncate this seekable file before retry. Retrying stdout would
   // concatenate a partial response with the next attempt and break its hash.
   args.push('--output',output,'--max-filesize','4194304');
  }
  const r=(deps.run||spawnSync)('curl',args,{encoding:null,timeout:pip?550000:20000,maxBuffer:12*1024*1024,env:{PATH:process.env.PATH,LANG:'C.UTF-8',...proxyEnv(process.env)}});
  if(r.error||r.status!==0){
   const code=pip?(r.status===28||r.error?.code==='ETIMEDOUT'?'bootstrap-download-timed-out':'bootstrap-download-failed'):'public-network-unavailable';
   throw Object.assign(Error(code),{code});
  }
  if(pip&&fs.statSync(output).size>4*1024*1024)throw Object.assign(Error('model-tools-download-too-large'),{code:'model-tools-download-too-large'});
  const data=pip?fs.readFileSync(output):Buffer.from(r.stdout||'');return{ok:true,body:[data],json:async()=>JSON.parse(data.toString('utf8'))};
 } finally {if(temporary)fs.rmSync(temporary,{recursive:true,force:true});}

}
module.exports={readPublic,proxyEnv};
