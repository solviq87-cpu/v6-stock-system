'use strict';
const {validateDataset,runValidatedBacktest}=require('./historical-validation');
const {createTradingCalendar}=require('./trading-calendar');
const {runNativeDaily}=require('./native-strategy-daily-runner');
const {buildSession}=require('./paper-session');
const {reconcileAccount}=require('./account-reconciliation');
const {aShareCalendarDate}=require('./a-share-calendar');
function runCompleteWorkbench(payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('研究输入必须是对象');
  const history=payload.history,ds=validateDataset(history);
  if(ds.stocks*ds.barsPerStock>20000||ds.barsPerStock>1000)throw Error('交互研究限制总K线20000条、每只1000条；更大任务使用离线CLI');
  if(history.asOf>aShareCalendarDate())throw Error('研究数据截至日期位于未来');
  const calendar=payload.calendar?createTradingCalendar(payload.calendar).assertDates(history.stocks[0].bars.map(b=>b.date)):{valid:null,reason:'未提供交易所日历，未进行开闭市核验'};
  const backtest=runValidatedBacktest(history);
  const session=buildSession(history,payload.paperConfig||{}).session;
  const native=runNativeDaily(history,{snapshots:payload.snapshots||{},pythonEvidence:payload.pythonEvidence||{},splitDay:history.splitDay});
  return {schemaVersion:1,mode:'integrated-research',canTrade:false,verifiedLive:false,dataset:ds,calendar,
    backtest,paper:session.report,reconciliation:{backtest:reconcileAccount(backtest),paper:reconcileAccount(session.report)},
    strategies:{coverage:native.coverage,details:native.details,replay:native.replay},
    externalAcceptance:['供应商行情授权及对账','真实短信送达','生产HTTPS和跨机恢复','电脑手机真机验收']};
}
module.exports={runCompleteWorkbench};
