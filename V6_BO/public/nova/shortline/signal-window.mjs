// Last accepted, rather than last matching, bar anchors the refractory window.
// Count only bars of the same instrument/period that were visible to this
// decision. A suspended week or a late backfill cannot advance the counter.
export function selectSignalWindow(names,position,series,accepted,point,width,isVisible){
  const keep=[],suppressed=[];
  for(const name of new Set(names.filter(Boolean))){
    const last=accepted.get(name);
    let elapsed=0;
    if(last!=null){
      for(let j=position;j>last && elapsed<width;j--)if(isVisible(series[j],point))elapsed++;
    }
    if(last==null||elapsed>=width){keep.push(name);accepted.set(name,position);}
    else suppressed.push({strategy:name,first:series[last].date,barsSince:elapsed,window:width});
  }
  return {keep,suppressed};
}
