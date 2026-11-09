'use strict';
const {validateDataset,runValidatedBacktest}=require('./historical-validation');
const {createTradingCalendar}=require('./trading-calendar');
const {runNativeDaily}=require('./native-strategy-daily-runner');
const {buildSession}=require('./paper-session');
const {reconcileAccount}=require('./account-reconciliation');
const {aShareCalendarDate}=require('./a-share-calendar');
const {historicalExplanations}=require('./research-explanation-projection');
const {evaluatePublicRuleForwardAudit}=require('../strategy/public-rule-forward-audit');
const {buildEightPointEvidence}=require('./eight-point-research-pipeline');
function runCompleteWorkbench(payload,{previousWatchStates=[]}={}){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('研究输入必须是对象');
  const history=payload.history,ds=validateDataset(history);
  if(ds.stocks*ds.barsPerStock>20000||ds.barsPerStock>1000)throw Error('交互研究限制总K线20000条、每只1000条；更大任务使用离线CLI');
  if(history.asOf>aShareCalendarDate())throw Error('研究数据截至日期位于未来');
  const calendar=payload.calendar?createTradingCalendar(payload.calendar).assertDates(history.stocks[0].bars.map(b=>b.date)):{valid:null,reason:'未提供交易所日历，未进行开闭市核验'};
  const backtest=runValidatedBacktest(history);
  const session=buildSession(history,payload.paperConfig||{}).session;
  const native=runNativeDaily(history,{snapshots:payload.snapshots||{},pythonEvidence:payload.pythonEvidence||{},splitDay:history.splitDay});
  // Additional research explanation is isolated so unsupported optional market
  // evidence cannot break the existing ledger, strategy or replay results.
  let selectionEvidence;
  try {
    selectionEvidence=historicalExplanations(history,{market:payload.market&&typeof payload.market==='object'&&!Array.isArray(payload.market)?payload.market:{}});
  } catch(e) {
    selectionEvidence={schemaVersion:1,mode:'historical-selection-evidence',
      status:'unavailable',verifiedLive:false,canTrade:false,officialCandidates:0,
      source:history.source,reason:String(e?.message||'研究解释不可用').slice(0,180),
      candidates:[],researchWatchlist:[]};
  }
  // Optional fixed-rule forward audit: report unavailable evidence without
  // silently changing the already validated backtest, paper or original strategies.
  let publicRuleForwardAudit;
  if(payload.validatePublicRules===true){
    try{
      const options=payload.publicRuleAuditOptions===undefined?{}:payload.publicRuleAuditOptions;
      publicRuleForwardAudit=evaluatePublicRuleForwardAudit(history,options);
    }catch(e){
      publicRuleForwardAudit={schemaVersion:1,mode:'frozen-public-rule-forward-audit',
        status:'unavailable',historicalOnly:true,canTrade:false,verifiedLive:false,
        weightsChanged:false,autoPromotion:false,rules:[],events:[],
        reason:String(e?.message||'无法完成样本外评估').slice(0,180)};
    }
  }
  const reconciliation={backtest:reconcileAccount(backtest),paper:reconcileAccount(session.report)};
  const strategies={coverage:native.coverage,details:native.details,replay:native.replay};
  const eightPointFlow=buildEightPointEvidence({history,selectionEvidence,
    publicRuleForwardAudit,reconciliation,strategies,calendar,previousWatchStates});
  return {schemaVersion:1,mode:'integrated-research',canTrade:false,verifiedLive:false,dataset:ds,calendar,
    backtest,paper:session.report,reconciliation,
    strategies,selectionEvidence,eightPointFlow,
    ...(payload.validatePublicRules===true?{publicRuleForwardAudit}:{}),
    externalAcceptance:['供应商行情授权及对账','真实短信送达','生产HTTPS和跨机恢复','电脑手机真机验收']};
}
module.exports={runCompleteWorkbench};
