'use strict';
// Hosting gateways may own Authorization. The application header carries the
// same session credential; this parser grants no role and accepts no URL/body data.
function sessionHeaderToken(req,{strictBearerSpace=false}={}){
 const headers=req?.headers||{};
 const pattern=strictBearerSpace?/^Bearer ([A-Za-z0-9._~-]{8,256})$/i:/^Bearer\s+([A-Za-z0-9._~-]{8,256})$/i;
 const bearer=typeof headers.authorization==='string'&&headers.authorization.match(pattern);
 if(bearer)return bearer[1];
 const token=headers['x-qd-token'];
 return typeof token==='string'&&/^[A-Za-z0-9._~-]{8,256}$/.test(token)?token:'';
}
module.exports={sessionHeaderToken};
