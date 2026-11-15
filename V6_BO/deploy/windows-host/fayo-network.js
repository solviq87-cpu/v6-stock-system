'use strict';
// curl respects the host's existing HTTPS proxy settings; Node's native fetch
// does not on all supported Node 22 versions. No proxy settings are changed.
const {spawnSync}=require('node:child_process');
const PROXIES=['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'];
function proxyEnv(env){return Object.fromEntries(PROXIES.filter(k=>typeof env[k]==='string').map(k=>[k,env[k]]));}
async function readPublic(url,options={},deps={}){
 const github=url.startsWith('https://api.github.com/repos/solviq87-cpu/v6-stock-system/');
 const pip=url==='https://files.pythonhosted.org/packages/44/3c/d717024885424591d5376220b5e836c2d5293ce2011523c9de23ff7bf068/pip-25.3-py3-none-any.whl';
 if(!github&&!pip)throw Object.assign(Error('network-target-refused'),{code:'network-target-refused'});
 const args=['--disable','--fail','--silent','--show-error','--proto','=https','--max-time',pip?'60':'15'];
 for(const [name,value]of Object.entries(options.headers||{})){if(!['Accept','User-Agent','Authorization'].includes(name)||/[\r\n]/.test(value))throw Error('invalid-network-header');args.push('--header',name+': '+value);}
 args.push('--url',url);
 const r=(deps.run||spawnSync)('curl',args,{encoding:null,timeout:pip?65000:20000,maxBuffer:12*1024*1024,env:{PATH:process.env.PATH,LANG:'C.UTF-8',...proxyEnv(process.env)}});
 if(r.error||r.status!==0)throw Object.assign(Error('public-network-unavailable'),{code:'public-network-unavailable'});
 const data=Buffer.from(r.stdout||'');return{ok:true,body:[data],json:async()=>JSON.parse(data.toString('utf8'))};
}
module.exports={readPublic,proxyEnv};
