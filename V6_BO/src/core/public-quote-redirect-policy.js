'use strict';
/**
 * A manual/no-follow request can still be served a redirected HTTP 200 by a
 * noncompliant injected transport or an intermediary. Never trust that as a
 * direct quote source. Do not expose or fetch the reported final URL.
 */
function hasQuoteRedirect(response,requestedUrl){
 if(!response||typeof requestedUrl!=='string'||!requestedUrl)
  return false;
 if(response.type==='opaqueredirect'||response.redirected===true)
  return true;
 if(Number.isInteger(response.status)&&response.status>=300&&response.status<400)
  return true;
 return typeof response.url==='string'&&response.url.length>0&&
  response.url!==requestedUrl;
}
module.exports={hasQuoteRedirect};
