// Quality and archive purpose are independent dimensions. Existing paper
// executions are real research observations unless explicitly marked as tests.
const yes=value=>value===true||value===1||['1','true','是'].includes(value);
export function isTestSample(row={}){
  return row?.sampleSet==='test'||row?.scope==='demo'||yes(row?.testSample)||yes(row?.isTest)||
    row?.quality==='教学样本'||row?.sampleSource==='教学样本'||/^合成教学样本/.test(row?.name||'');
}
export function sampleMatches(row={},selection='all'){
  if(!row)return false;
  const quality=row.quality;
  const black=yes(row.blackSwan)||quality==='黑天鹅'||quality==='黑天鹅行情'||quality==='blackSwan';
  const extreme=yes(row.extreme)||yes(row.extremeMarket)||quality==='extreme'||/不可复制|极端行情/.test(quality||'')||row.repeatable===false&&!black;
  switch(selection){
    case 'all':return true;
    case 'standard':return !black&&!extreme;
    case 'blackSwan':return black;
    case 'extreme':return extreme;
    case 'excludeBlackSwan':return !black;
    case 'excludeExtreme':return !extreme;
    default:return false;
  }
}
