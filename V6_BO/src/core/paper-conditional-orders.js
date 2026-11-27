'use strict';

// Durable user intentions and observed trigger evidence, never an account.
// The only execution callback is the existing decision adapter -> paperBuy.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {withAccountLock}=require('./account-process-lock');
const {privateRoot,canonical,digest}=require('./research-workspace-store');
const {atomicWrite}=require('./market-data-center');
const {aShareCalendarDate}=require('./a-share-calendar');
const {executionTimeOf}=require('./paper-fill-evidence');
const {validatePlan,planFill}=require('./paper-decision-plan');
const MAX_ORDERS=2000,MAX_BYTES=32*1024*1024;
const statuses=new Set(['pending','executed','cancelled','expired','unauthorized']);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const timestamp=value=>Number.isSafeInteger(value)&&value>0;
const clone=value=>JSON.parse(JSON.stringify(value));
const cutoff=day=>Date.parse(day+'T14:57:00+08:00');
const idOk=id=>typeof id==='string'&&/^cond-[a-f0-9-]{36}$/.test(id);
const safeReason=value=>String(value||'原门禁未给出可执行回执').replace(/[\r\n\x00-\x1f]/g,' ').slice(0,240);
const accountEpoch=book=>digest((book?.archives||[]).map(period=>({revision:period.revision??null,fingerprint:period.account?.fingerprint??null})));
const monitoringEnded=order=>order.monitoringComplete===true&&['fully-exited','account-period-ended'].includes(order.monitoringEndReason);

function quoteEvidence(quote,plan,now,day){
  // Reuse the original plan observer's complete quote/provenance gate. A
  // condition is evidence only, never a new authority or an executable order.
  const observer=require('./paper-plan-observer');
  try{
    if(!observer.sessions(day).some(([start,end])=>now>=start&&now<end)||
      quote?.quoteAt<Date.parse(plan.frozenAt)||quote?.sourceConflict===true||quote?.conflict===true||
      quote?.quoteStatus==='conflict'||quote?.evidenceStatus==='conflict'||
      quote?.source!=null&&quote.source!==quote.quoteSource||/demo/i.test(quote?.quoteSource||''))return null;
    const original=observer.quoteEvidence(quote,plan.code,day,now);
    return {planId:plan.id,code:plan.code,day,observedAt:now,quoteAt:original.quoteAt,receivedAt:original.receivedAt,
      source:original.source,price:original.price,lowerLimit:original.lowerLimit,upperLimit:original.upperLimit,
      inputProvenanceFingerprint:original.inputProvenanceFingerprint,originalFreshGate:true,continuous:true,canTrade:false};
  }catch{return null;}
}

function publicOrder(order,now){
  return {id:order.id,planId:order.planId,code:order.code,name:order.name,day:order.day,status:order.status,
    createdAt:order.createdAt,updatedAt:order.updatedAt,expiresAt:order.expiresAt,lastReason:order.lastReason,
    canCancel:order.status==='pending'&&now<order.expiresAt,fill:order.fill||null,
    monitoringActive:order.status==='executed'&&!monitoringEnded(order),remainingQuantity:order.remainingQuantity??order.fill?.shares??null,
    notificationOwner:order.notificationOwner||'plan-observer',
    observations:clone(order.observations),coverage:clone(order.coverage),alerts:clone(order.alerts),
    note:'仅原模拟账户可成交；条件意图不冻结资金，不保证成交；计划止损为预警，退出仍按原账户规则。'};
}

function createConditionalOrderStore({root,clock=Date.now,faultInjector}={}){
  const dir=privateRoot(root),file=path.join(dir,'conditional-orders.json'),lock=path.join(dir,'conditional-orders');
  const currentTime=()=>{const now=clock();if(!timestamp(now))throw Error('条件计划时钟无效');return now;};
  function load(){
    privateRoot(root);
    if(!fs.existsSync(file))return {schemaVersion:1,revision:0,orders:[]};
    const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));let value;
    try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.mode&0o077||stat.size>MAX_BYTES)throw Error('条件计划文件权限或容量无效');
      value=JSON.parse(fs.readFileSync(fd,'utf8'));
    }finally{fs.closeSync(fd);}
    const {fingerprint,...state}=value;
    if(fingerprint!==digest(state)||state.schemaVersion!==1||!Number.isSafeInteger(state.revision)||state.revision<0||
      !Array.isArray(state.orders)||state.orders.length>MAX_ORDERS)throw Error('条件计划完整性校验失败，禁止继续执行');
    const ids=new Set(),requests=new Set();
    for(const order of state.orders){
      if(!idOk(order.id)||ids.has(order.id)||requests.has(order.requestId)||!statuses.has(order.status)||
        !timestamp(order.createdAt)||!timestamp(order.updatedAt)||order.updatedAt<order.createdAt||
        order.planId!==order.plan?.id||order.code!==order.plan?.code||order.day!==order.plan?.intendedDate||
        order.expiresAt!==cutoff(order.day)||order.planFingerprint!==digest(order.plan)||
        !order.authorization||typeof order.authorization!=='object'||Array.isArray(order.authorization)||
        !Array.isArray(order.observations)||order.observations.length>1000||!Array.isArray(order.coverage)||
        !Array.isArray(order.alerts)||order.alerts.length>1000)throw Error('条件计划内容损坏，禁止继续执行');
      validatePlan(order.plan,currentTime());ids.add(order.id);requests.add(order.requestId);
    }
    return state;
  }
  function save(state){
    state.revision++;
    const raw=JSON.stringify({...state,fingerprint:digest(state)})+'\n';
    if(Buffer.byteLength(raw)>MAX_BYTES)throw Error('条件计划意图记录达到容量，请先归档；原文件保持');
    faultInjector?.('before-write',state);atomicWrite(file,raw);faultInjector?.('after-write',state);
  }
  function locked(operation){privateRoot(root,true);return withAccountLock(lock,()=>operation(load()));}
  function projection(state){const now=currentTime();return {revision:state.revision,orders:[...state.orders].reverse().map(order=>publicOrder(order,now)),
    account:'pool',paperOnly:true,brokerConnected:false,ledgerOwned:false,notificationOwner:'plan-observer'};}
  function read(){return projection(load());}
  function update(order,status,reason,now){
    const text=safeReason(reason);
    if(order.status===status&&order.lastReason===text)return false;
    order.status=status;order.lastReason=text;order.updatedAt=now;return true;
  }
  function fillRecord(event){return {eventId:event.eventId,price:event.price,shares:event.quantity,tradeDate:event.tradeDate,
    executionAt:executionTimeOf(event),source:'original-paper-ledger'};}
  function reconcile(order,book,now){
    const event=planFill(book,order.planId,{plan:order.plan,now});
    if(!event){
      if(order.fill!=null||order.status==='executed')
        throw Error('已有成交回执缺少原持久账本对应事件，停止执行');
      return false;
    }
    const fill=fillRecord(event);
    if(order.status==='executed'&&!order.fill||order.fill!=null&&digest(order.fill)!==digest(fill))
      throw Error('已记录成交与原持久成交冲突，停止执行');
    const changed=order.fill==null||order.status!=='executed';
    order.fill=fill;return update(order,'executed','已核对原持久成交，后续读取不会重复买入',now)||changed;
  }
  function assertIntentClock(state,now){
    for(const order of state.orders){
      const clocks=[order.createdAt,order.updatedAt,order.fill?.executionAt,
        ...order.coverage.map(row=>row.lastObservedAt),...order.observations.map(row=>row.observedAt),
        ...order.alerts.map(row=>row.recordedAt)].filter(v=>v!=null);
      if(clocks.some(at=>!timestamp(at)||at>now))
        throw Error('条件计划时钟倒退或原记录时点无效，停止执行');
    }
  }
  function pendingAccountChanged(order,book,prior=null){
    return order.accountEpoch!==accountEpoch(book)||
      [order.accountRevision,prior?.revision].some(rev=>Number.isSafeInteger(rev)&&
        (!Number.isSafeInteger(book.revision)||book.revision<rev))||
      prior!=null&&Number.isSafeInteger(prior.revision)&&prior.revision===book.revision&&
        typeof prior.fingerprint==='string'&&prior.fingerprint!==book.fingerprint;
  }
  function create({requestId,plan,authorization}={}, {readBook}={}){
    const now=currentTime();validatePlan(plan,now);
    if(typeof requestId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(requestId)||
      !authorization||typeof authorization!=='object'||Array.isArray(authorization)||
      Object.keys(authorization).some(key=>/token|password|secret|webhook/i.test(key)))throw Error('条件计划请求或授权摘要无效');
    const auth=canonical(authorization);if(JSON.stringify(auth).length>2048)throw Error('条件计划授权摘要超限');
    if(typeof readBook!=='function')throw Error('必须先核对原模拟账本');
    return locked(state=>{
      // Re-signing the same verified identity on an HTTP retry changes issuedAt
      // and its signature, not the user's intention. A role generation change
      // still conflicts; retrying is not a silent authorization renewal.
      const identity={mode:auth.mode??null,principal:auth.principal??null,generation:auth.generation??auth.gen??null};
      const requestHash=digest({planId:plan.id,planFingerprint:digest(plan),identity});
      const duplicate=state.orders.find(order=>order.requestId===requestId);
      if(duplicate){if(duplicate.requestHash!==requestHash)throw Error('同请求ID内容冲突');
        return {...projection(state),order:publicOrder(duplicate,now),reused:true};}
      if(plan.intendedDate!==aShareCalendarDate(now)||aShareCalendarDate(Date.parse(plan.frozenAt))!==plan.intendedDate||now>=cutoff(plan.intendedDate))throw Error('只能创建尚未到期的当日条件计划');
      const prior=state.orders.find(order=>order.planId===plan.id&&['pending','executed'].includes(order.status));
      if(prior)return {...projection(state),order:publicOrder(prior,now),reused:true};
      assertIntentClock(state,now);
      if(state.orders.length>=MAX_ORDERS)throw Error('条件计划记录达到容量，请先归档');
      const book=readBook();
      const order={id:'cond-'+crypto.randomUUID(),requestId,requestHash,planId:plan.id,plan:canonical(plan),planFingerprint:digest(plan),
        accountEpoch:accountEpoch(book),accountRevision:Number.isSafeInteger(book.revision)?book.revision:null,
        authorization:auth,code:plan.code,name:plan.name||plan.code,day:plan.intendedDate,status:'pending',
        createdAt:now,updatedAt:now,expiresAt:cutoff(plan.intendedDate),lastReason:'已记录当日条件意图，等待原行情与执行门禁',
        observations:[],coverage:[],alerts:[]};
      reconcile(order,book,now);state.orders.push(order);save(state);
      return {...projection(state),order:publicOrder(order,now),reused:false};
    });
  }
  function cancel({orderId,expectedRevision}={}, {readBook}={}){
    if(!idOk(orderId)||!Number.isSafeInteger(expectedRevision))throw Error('撤销条件计划参数无效');
    return locked(state=>{
      const order=state.orders.find(row=>row.id===orderId);if(!order)throw Error('条件计划不存在');
      if(order.status==='cancelled')return {...projection(state),order:publicOrder(order,currentTime()),reused:true};
      if(state.revision!==expectedRevision)throw Error('条件计划版本已变化，请刷新后再撤销');
      const now=currentTime();assertIntentClock(state,now);
      if(typeof readBook!=='function')throw Error('撤销前必须核对原持久账本');
      if(reconcile(order,readBook(),now)){save(state);return {...projection(state),order:publicOrder(order,now),reused:false};}
      if(order.status!=='pending')throw Error('条件计划已结束，不能撤销既有成交');
      update(order,now>=order.expiresAt?'expired':'cancelled',now>=order.expiresAt?'当日连续竞价已经结束':'用户已撤销待执行意图；原账户与既有成交保持',now);save(state);
      return {...projection(state),order:publicOrder(order,now),reused:false};
    });
  }
  function recordObservation(order,evidence,kind,extra={}){
    const point={...evidence,kind,...extra};
    // Preserve the first observed actionable trigger and blocked variants each
    // day. No finite set of observations claims coverage of an unobserved day.
    const old=order.observations.find(row=>row.day===point.day&&row.kind===kind&&row.sellable===point.sellable&&row.entryEventId===point.entryEventId);
    if(old)return null;
    if(order.observations.length>=1000)throw Error('条件触发证据达到容量，停止新增执行');
    const value={...point,fingerprint:digest(point)};order.observations.push(value);return value;
  }
  function coverage(order,day,now,valid){
    let item=order.coverage.find(row=>row.day===day);
    if(!item){item={day,firstObservedAt:now,lastObservedAt:now,observations:0,missing:0,maxGapMs:0,completeSession:false};order.coverage.push(item);}
    item.maxGapMs=Math.max(item.maxGapMs,now-item.lastObservedAt);item.lastObservedAt=now;
    if(valid)item.observations++;else item.missing++;
  }
  function tick({now=currentTime(),day=aShareCalendarDate(now),replica,continuous,authorized,planFor,quoteFor,readBook,execute,exitAllowedFor,
    notificationOwner='plan-observer',notify}={}){
    if(!timestamp(now)||day!==aShareCalendarDate(now))throw Error('条件执行时点无效');
    if(replica)return {...read(),skipped:'replica'};
    if(!['plan-observer','conditional-order'].includes(notificationOwner))throw Error('条件计划预警归属无效');
    if(typeof authorized!=='function'||typeof planFor!=='function'||typeof quoteFor!=='function'||typeof readBook!=='function'||typeof execute!=='function')throw Error('条件执行必须接入原授权、计划、报价与账本门禁');
    return locked(state=>{
      if(currentTime()<now)throw Error('条件计划时钟倒退，停止执行');
      assertIntentClock(state,now);
      let dirty=false;const notifications=[];
      for(const order of state.orders){
        if(!['pending','executed'].includes(order.status))continue;
        if(order.status==='executed'&&monitoringEnded(order))continue;
        const book=readBook();dirty=reconcile(order,book,now)||dirty;
        if(order.status==='pending'&&(day!==order.day||now>=order.expiresAt)){dirty=update(order,'expired','当日连续竞价结束，未成交意图已到期',now)||dirty;continue;}
        if(order.status==='pending'&&pendingAccountChanged(order,book)){
          dirty=update(order,'cancelled','原账户期次已重置或回退，旧条件意图停止，需重新确认计划',now)||dirty;continue;
        }
        if(authorized(order.authorization,order)!==true){dirty=update(order,'unauthorized','原设备授权已撤销、过期或实例已变化，后台执行停止',now)||dirty;continue;}
        const plan=planFor(order.planId,order);
        if(!plan||digest(plan)!==order.planFingerprint){dirty=update(order,order.status,'原冻结计划缺失或内容不一致，等待核验',now)||dirty;continue;}
        if(!continuous){if(order.status==='pending')dirty=update(order,'pending','非连续竞价时段暂停，原账户不会成交',now)||dirty;continue;}
        const quote=quoteFor(plan,order),evidence=quoteEvidence(quote,plan,now,day);
        if(order.status==='executed'){
          const context=require('./paper-plan-observer').planLedgerContext(book,plan,now);
          if(context.ambiguous||context.entry?.eventId!==order.fill.eventId){
            dirty=update(order,'executed',context.ambiguous||'原买入批次关联未完成核验，暂停触发判断',now)||dirty;continue;
          }
          order.remainingQuantity=context.remaining;
          // A partial sale is not a closed position. An old reset period and
          // a later same-code round trip must not inherit this monitoring job.
          if(!context.current||context.remaining===0){
            order.monitoringComplete=true;order.monitoringEndReason=context.current?'fully-exited':'account-period-ended';
            order.monitoringClosedAt=context.closedAt;order.updatedAt=now;dirty=true;continue;
          }
          order.monitoringComplete=false;delete order.monitoringEndReason;
          if(!finite(book.account?.positions?.[order.code]?.quantity)||book.account.positions[order.code].quantity<context.remaining){
            dirty=update(order,'executed','原剩余批次与当前持仓数量不一致，暂停触发判断',now)||dirty;continue;
          }
          coverage(order,day,now,!!evidence);dirty=true;
          if(!evidence)continue;
          const allowed=typeof exitAllowedFor==='function'?exitAllowedFor(plan,order,book,quote,now):null;
          const sellable=allowed?.allowed===true&&order.fill.tradeDate<day&&quote.price>quote.lowerLimit&&quote.price<quote.upperLimit;
          for(const kind of ['stop','target']){
            if(kind==='stop'?quote.price>plan.stop:quote.price<plan.target)continue;
            const observed=recordObservation(order,evidence,kind,{entryEventId:order.fill.eventId,remainingQuantity:context.remaining,sellable,
              reason:sellable?'原T+1与报价卖出窗口已核对':safeReason(allowed?.reason||'原可卖窗口未核实')});
            if(observed){
              const version=require('./paper-plan-observer').planVersion(plan);
              const alert={id:'alert-'+digest([order.id,observed.fingerprint]).slice(0,32),kind,day,planId:plan.id,
                planVersion:version,entryEventId:order.fill.eventId,observation:observed.fingerprint,
                observerAlertId:crypto.createHash('sha256').update(JSON.stringify([version,day,kind])).digest('hex'),
                owner:notificationOwner,status:notificationOwner==='plan-observer'?'delegated':'pending',recordedAt:now};
              order.notificationOwner=notificationOwner;order.alerts.push(alert);
              if(notificationOwner==='conditional-order')notifications.push({order,observed,alert});
            }
          }
          continue;
        }
        coverage(order,day,now,!!evidence);dirty=true;
        if(!evidence){update(order,'pending','缺少通过原15秒新鲜度门禁的完整报价，继续等待',now);continue;}
        if(quote.price<plan.entryMin||quote.price>plan.entryMax){update(order,'pending','最新原始报价尚未进入冻结买入区间',now);continue;}
        if(quote.price<=quote.lowerLimit||quote.price>=quote.upperLimit){update(order,'pending','原报价触及涨跌停限制，未尝试成交',now);continue;}
        recordObservation(order,evidence,'entry',{entryEventId:null,sellable:null,reason:'已观察到计划买区，成交仍须原paperBuy全部门禁'});
        // Trigger is durable BEFORE the original account is allowed to write.
        // A crash after the account commit is recovered by planFill on restart.
        save(state);dirty=false;faultInjector?.('before-execute',order);
        if(authorized(order.authorization,order)!==true){dirty=update(order,'unauthorized','成交前原授权已失效，未执行',now)||dirty;continue;}
        // The durable trigger is not permission to use a later/different quote.
        // Recheck after persistence and authorization, before the existing gate.
        const latestQuote=quoteFor(plan,order),executionBook=readBook();
        const stillAuthorized=authorized(order.authorization,order)===true,executeAt=currentTime();
        if(executeAt<now){dirty=update(order,'pending','成交前时钟倒退，等待重新核验',now)||dirty;continue;}
        // The durable trigger is NOT permission to enter a reset account.
        // A matching fill discovered here is reconciled, never executed twice.
        if(reconcile(order,executionBook,executeAt)){dirty=true;continue;}
        if(pendingAccountChanged(order,executionBook,book)){
          dirty=update(order,'cancelled','成交前原账户期次已重置、回退或同版本内容变化，需重新确认计划',executeAt)||dirty;continue;
        }
        if(!stillAuthorized){dirty=update(order,'unauthorized','成交前原授权已失效，未执行',executeAt)||dirty;continue;}
        if(executeAt>=order.expiresAt||aShareCalendarDate(executeAt)!==day){dirty=update(order,'expired','成交前原条件意图已到期',executeAt)||dirty;continue;}
        const latest=quoteEvidence(latestQuote,plan,executeAt,day);
        const identity=e=>digest({...e,observedAt:null});
        if(!latest||identity(latest)!==identity(evidence)){
          dirty=update(order,'pending','成交前原报价失效或已变化，等待下一次完整核验',executeAt)||dirty;continue;
        }
        try{
          const result=execute(plan,order);
          if(result&&typeof result.then==='function')throw Error('原执行适配必须在锁内同步完成');
          faultInjector?.('after-execute',order);
          const after=readBook(),finishedAt=currentTime();
          if(finishedAt<executeAt)throw Error('原模拟成交确认时钟倒退，等待核对持久回执');
          if(!reconcile(order,after,finishedAt))update(order,'pending','原执行门禁未产生该计划的持久成交，继续等待',finishedAt);
        }catch(error){
          // The fill may already be durable even if a downstream reply failed.
          const after=readBook(),finishedAt=currentTime();
          if(finishedAt<executeAt)throw Error('原模拟成交确认时钟倒退，等待核对持久回执');
          if(!reconcile(order,after,finishedAt))update(order,'pending','原执行门禁拒绝：'+safeReason(error.message),finishedAt);
        }
        dirty=true;
      }
      if(dirty)save(state);
      for(const {order,observed,alert}of notifications){
        // Record an unknown delivery BEFORE dispatch, preventing crash/restart
        // from silently duplicating a private message. The original sender owns
        // its queue/receipt; acceptance is never labelled as delivered.
        alert.status=typeof notify==='function'?'unknown':'unconfigured';save(state);
        if(typeof notify==='function'){
          try{const receipt=notify(publicOrder(order,now),observed,alert.id);
            alert.status=['sent','queued','unconfigured','failed','unknown'].includes(receipt?.status)?receipt.status:'unknown';
          }catch{alert.status='unknown';}
          save(state);
        }
      }
      return projection(state);
    });
  }
  return {read,create,cancel,tick};
}
module.exports={createConditionalOrderStore,quoteEvidence};
