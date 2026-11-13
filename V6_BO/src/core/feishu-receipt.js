'use strict';
// Gateway acceptance is not proof of a phone notification. Never echo response bodies.
function classifyFeishuReceipt(statusCode, payload) {
  const unknown = msg => ({ok:false,status:'unknown',msg:'送达结果未知：'+msg});
  if (!Number.isInteger(statusCode) || statusCode < 200 || statusCode >= 500 || statusCode === 408)
    return unknown('HTTP 回执未确认');
  if (statusCode >= 300 && statusCode < 400) return unknown('未跟随重定向');
  if (statusCode >= 400) return {ok:false,status:'rejected',msg:'HTTP '+statusCode};
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return unknown('响应格式异常');
  const codes = ['code','StatusCode'].filter(key => Object.hasOwn(payload,key)).map(key => payload[key]);
  if (!codes.length || codes.some(code => !Number.isInteger(code))) return unknown('缺少有效业务回执码');
  // Contradictory envelopes cannot prove rejection: releasing deduplication could resend an accepted message.
  if (codes.includes(0) && codes.some(code => code !== 0)) return unknown('业务回执码互相矛盾');
  if (codes.some(code => code !== 0)) {
    const code = codes.find(value => value !== 0);
    const rateLimited = /too many requests?|rate limit/i.test(String(payload.msg || payload.StatusMessage || ''));
    return {ok:false,status:'rejected',msg:'code='+code+(rateLimited?' too many requests':' 业务拒绝')};
  }
  return {ok:true,status:'accepted',msg:'ok'};
}
module.exports = {classifyFeishuReceipt};
