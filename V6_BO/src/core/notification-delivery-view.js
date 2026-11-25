'use strict';

// A read-only projection for the legacy push log. Preserve its historical
// status verbatim because deduplication, quotas and outcome review consume it.
// None of those legacy labels contains a verified receiving-device receipt.
function projectPushLogDelivery(row) {
  const value=row&&typeof row==='object'?row:{};
  const original=typeof value.status==='string'?value.status:'';
  const error=String(value.error||value.detail||'');
  let status='unknown',label=original||'投递状态未知',gatewayAccepted=null;
  let basis='原流水未提供可核验的接收端回执';
  if(/送达结果未知|送达未知|结果未知|未确认|unconfirmed|receiver-confirmed/.test(original)||
      /超时|timeout|timed?\s*out|ETIMEDOUT|ECONN|socket|断连|回执.*矛盾|HTTP\s+(?:408|5\d\d)\b/i.test(error)) {
    status='unconfirmed';label='投递未确认';basis='结果不确定，原去重记录保留；不据此重发';
  } else if(/^✅ 已送达(?:\(私密\))?$/.test(original)||original==='gateway-accepted'||original==='验证码(安全通道)') {
    status='gateway-accepted';label='网关受理 · 接收端未确认';gatewayAccepted=true;
    basis='原通道网关受理记录，不代表设备收到或用户查看';
  } else if(/排队|queued/.test(original)) {
    status='queued';label='已排队 · 接收端未确认';basis='仅有本地排队记录，尚未取得通道或接收端确认';
  } else if(original==='gateway-rejected'||/未发送|不外发|拦截|未配置|条数闸门/.test(original)) {
    status='not-sent';label=original||'本次未外发';gatewayAccepted=false;
    basis='原通道或本地门禁记录本次未外发；风险与原限制继续生效';
  } else if(/失败|未送达|拒绝|拒收/.test(original)) {
    status='unconfirmed';label='通道失败记录 · 接收端未确认';
    basis='失败标签本身不能证明接收端状态，须核对原通道回执';
  } else if(/已送达|送达成功|已接收|接收端确认/.test(original)) {
    label='投递依据待核对 · 接收端未确认';
    basis='历史文字标签没有关联可核验的接收证据';
  }
  return {...value,deliveryStatus:status,deliveryLabel:label,deliveryBasis:basis,
    gatewayAccepted,receiverConfirmed:false};
}

module.exports={projectPushLogDelivery};
