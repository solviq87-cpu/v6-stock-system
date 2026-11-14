'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {normalize,parseContext,canonicalURL}=require('../public/assets/public-library-context');
const entries=['U02','U08','U09','T01'].map(id=>({id}));
const blank={category:'',adoption:'',ids:[]};

test('public context resolves known selections in catalog order, independently of visible filters',()=>{
 assert.deepEqual(parseContext('?category=interface&adoption=implemented&ids=U09,U02,U08',entries),{category:'interface',adoption:'implemented',ids:['U02','U08','U09']});
 assert.deepEqual(parseContext('?category=workflow&ids=U09,U02',entries),{category:'workflow',adoption:'',ids:['U02','U09']});
});
test('unresolved catalog IDs never become active selections before a validated catalog is available',()=>{
 assert.deepEqual(parseContext('?ids=U02,U08',null),blank);
 assert.deepEqual(parseContext('?ids=U02,U08',[]),blank);
 assert.deepEqual(parseContext('?ids=U02,U08',[null,{id:'<script>'}]),blank);
});
test('unknown and duplicate IDs do not consume the three known-selection slots',()=>{
 assert.deepEqual(parseContext('?ids=missing,U09,U09,U02,unknown,U08,T01',entries).ids,['U02','U08','U09']);
 assert.deepEqual(parseContext('?ids=U09,U09,unknown',entries).ids,['U09']);
});
test('repeated context query fields are discarded instead of choosing an ambiguous value',()=>{
 assert.deepEqual(parseContext('?category=interface&category=workflow&adoption=candidate&adoption=implemented&ids=U02&ids=U08',entries),blank);
 assert.deepEqual(parseContext('?category=interface&ids=U02&ids=U08',entries),{category:'interface',adoption:'',ids:[]});
});
test('malformed and executable selection text cannot produce links or active source IDs',()=>{
 for(const search of ['?ids=javascript:alert(1)','?ids=U02%00','?ids=U02%2f..%2fU08','?ids=%E0%A4%A','?category=__proto__&adoption=constructor'])assert.deepEqual(parseContext(search,entries),blank,search);
});
test('arbitrary URLs, executable schemes, relative paths and oversized query inputs are rejected',()=>{
 for(const search of ['https://example.com/model-library.html?ids=U02','javascript:?ids=U02','//example.com/?ids=U02','/model-library.html?ids=U02','ids=U02','?'+ 'x'.repeat(4096),null,{}])assert.deepEqual(parseContext(search,entries),blank);
});
test('canonical links include only fixed public keys, omitting freeform and private state',()=>{
 const context={category:'interface',adoption:'implemented',ids:['U09','U02'],q:'private typed search',search:'private typed search',token:'secret',runId:'private-run',asOf:'private-time',screenId:'private-screen',account:'private-account',forecast:{point:123},href:'javascript:alert(1)',path:'https://example.com/steal'};
 assert.equal(canonicalURL(context,entries),'/model-library.html?category=interface&adoption=implemented&ids=U02%2CU09#compareHeading');
 const url=new URL(canonicalURL(context,entries),'https://v6.example');
 assert.equal(url.origin,'https://v6.example');assert.equal(url.pathname,'/model-library.html');assert.deepEqual([...url.searchParams.keys()],['category','adoption','ids']);
});
test('private URL fields and freeform search are ignored while public context remains usable',()=>{
 const context=parseContext('?ids=U02&category=interface&token=secret&runId=private&asOf=1&screenId=private&account=pool&forecast=private&q=private&next=https://example.com',entries);
 assert.equal(canonicalURL(context,entries),'/model-library.html?category=interface&ids=U02#compareHeading');
});
test('canonical empty and filter-only views point to the catalog and round-trip public state',()=>{
 assert.equal(canonicalURL({},entries),'/model-library.html#catalogHeading');
 const url=canonicalURL({category:'workflow',adoption:'candidate',ids:[]},entries);
 assert.equal(url,'/model-library.html?category=workflow&adoption=candidate#catalogHeading');
 assert.deepEqual(parseContext(new URL(url,'https://v6.example').search,entries),{category:'workflow',adoption:'candidate',ids:[]});
});
test('context normalization does not mutate caller data or read unrelated private getters',()=>{
 const context={category:'interface',adoption:'candidate',ids:Object.freeze(['U09','U02'])};
 Object.defineProperty(context,'token',{get(){throw Error('private field was read');}});Object.freeze(context);
 assert.deepEqual(normalize(context,Object.freeze(entries)),{category:'interface',adoption:'candidate',ids:['U02','U09']});
 assert.deepEqual(context.ids,['U09','U02']);
});
