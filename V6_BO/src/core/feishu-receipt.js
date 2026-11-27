'use strict';
// Gateway acceptance is not proof of a phone notification. Never echo response bodies.
const RATE_LIMIT = /too many requests?|rate limit/i;
const UNCERTAIN = /结果未知|未确认|超时|未回调|timeout|timed?\s*out|ETIMEDOUT|socket|ECONN|EPIPE|ENOTFOUND|EAI_AGAIN|EHOST|ENET|网络异常|请求失败|premature|aborted|断连|回执.*矛盾|HTTP\s+(?:408|5\d\d)\b/i;
function classifyFeishuReceipt(statusCode, payload) {
  const unknown = msg => ({ok:false,status:'unknown',msg:'送达结果未知：'+msg});
  if (!Number.isInteger(statusCode) || statusCode < 200 || statusCode >= 500 || statusCode === 408)
    return unknown('HTTP 回执未确认');
  if (statusCode >= 300 && statusCode < 400) return unknown('未跟随重定向');
  const record = payload && typeof payload === 'object' && !Array.isArray(payload);
  const codes = record ? ['code','StatusCode'].filter(key => Object.hasOwn(payload,key)).map(key => payload[key]) : [];
  if (codes.some(code => !Number.isSafeInteger(code))) return unknown('缺少有效业务回执码');
  // Distinct business aliases can imply different retry decisions, even if
  // both are nonzero. Never choose the first alias as the authoritative one.
  if (new Set(codes).size > 1) return unknown('业务回执码互相矛盾');
  const messages = record ? ['msg','StatusMessage'].filter(key => Object.hasOwn(payload,key)).map(key => payload[key]).filter(v => v != null) : [];
  if (messages.some(v => typeof v !== 'string')) return unknown('业务回执文本格式异常');
  const present = messages.filter(v => v.trim());
  if (present.some(v => UNCERTAIN.test(v))) return unknown('业务回执含未确认信息');
  const rateLimited = present.some(v => RATE_LIMIT.test(v));
  if (rateLimited && present.some(v => !RATE_LIMIT.test(v))) return unknown('业务回执限频说明互相矛盾');
  if (statusCode >= 400) {
    // Some callers retain a parsed error body; an explicit acceptance in it
    // contradicts the HTTP rejection. Status-only HTTP rejections remain valid.
    if (codes.includes(0)) return unknown('HTTP 与业务回执互相矛盾');
    return {ok:false,status:'rejected',msg:'HTTP '+statusCode};
  }
  if (!record) return unknown('响应格式异常');
  if (!codes.length) return unknown('缺少有效业务回执码');
  if (codes[0] !== 0) return {ok:false,status:'rejected',msg:'code='+codes[0]+(rateLimited?' too many requests':' 业务拒绝')};
  if (rateLimited) return unknown('业务成功码与限频说明互相矛盾');
  return {ok:true,status:'accepted',msg:'ok'};
}
module.exports = {classifyFeishuReceipt};
