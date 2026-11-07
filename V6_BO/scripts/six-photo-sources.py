#!/usr/bin/env python3
"""Explicit six-photo small-sample runner. No account creation, paid requests or orders."""
import argparse,contextlib,copy,datetime,importlib.metadata,io,json,math,os,pathlib,re,signal,subprocess,sys,tempfile,threading,time,urllib.request
ROOT=pathlib.Path(__file__).resolve().parent.parent
CATALOG=json.loads((ROOT/'config/six-photo-sources.json').read_text())
ENTRIES={e['id']:e for e in CATALOG['entries']}

def validate(code,start,end,fund):
    if not re.fullmatch(r'(60|68|00|30)\d{4}',code) or not re.fullmatch(r'\d{6}',fund): raise ValueError('证券代码无效')
    a,b=datetime.date.fromisoformat(start),datetime.date.fromisoformat(end)
    if a>b or (b-a).days>31 or b>datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).date(): raise ValueError('区间无效')

def frame(df):
    if df is None or len(df)==0: raise ValueError('empty-data')
    # Project only public fields. Keep exact native names/units; normalization is separately verified.
    columns=[str(c) for c in df.columns]
    for key in ['日期','时间','date','day']:
        if key in df.columns:
            df=df.sort_values(key,kind='stable');break
    if len(columns)>80: raise ValueError('too-many-fields')
    return {'columns':columns,'records':json.loads(df.tail(200).to_json(orient='records',date_format='iso',force_ascii=False)),'truncated':len(df)>200}

def worker(ident,code,start,end,fund):
    e=ENTRIES[ident]
    if e['requires']!='public': return {'status':'client-required' if e['requires']=='client' else 'credentials-required','requestAttempted':False,'reason':'本批不创建账号、使用付费额度或连接交易客户端'}
    if e['provider']=='akshare':
        import akshare as ak
        if ident=='akshare.daily': df=ak.stock_zh_a_hist(symbol=code,period='daily',start_date=start.replace('-',''),end_date=end.replace('-',''),adjust='')
        elif ident=='akshare.minute.em': df=ak.stock_zh_a_hist_min_em(symbol=code,start_date=start+' 09:30:00',end_date=end+' 15:00:00',period='5',adjust='')
        else: df=ak.stock_zh_a_minute(symbol=('sh' if code.startswith('6') else 'sz')+code,period='5',adjust='')
        return {'status':'returned','data':frame(df),'sdkVersion':importlib.metadata.version('akshare')}
    if e['provider']=='efinance':
        import efinance as ef
        if ident=='efinance.daily': df=ef.stock.get_quote_history(code,beg=start.replace('-',''),end=end.replace('-',''),klt=101,fqt=0)
        elif ident=='efinance.fund.nav': df=ef.fund.get_quote_history(fund)
        else: df=ef.stock.get_realtime_quotes()
        if ident=='efinance.realtime':
            if '股票代码' not in df.columns: raise ValueError('missing-stock-code')
            df=df[df['股票代码'].astype(str)==code]
        return {'status':'returned','data':frame(df),'sdkVersion':importlib.metadata.version('efinance')}
    if e['provider']=='baostock':
        import baostock as bs
        with contextlib.redirect_stdout(io.StringIO()):
            lg=bs.login()
            if lg.error_code!='0': raise ValueError('login-failed')
            try:
                minute=e['kind']=='minute';fields='date,time,code,open,high,low,close,volume,amount,adjustflag' if minute else 'date,code,open,high,low,close,volume,amount,adjustflag,tradestatus'
                rs=bs.query_history_k_data_plus(('sh.' if code.startswith('6') else 'sz.')+code,fields,start_date=start,end_date=end,frequency='5' if minute else 'd',adjustflag='3')
                if rs.error_code!='0':raise ValueError('query-failed')
                rows=[]
                while rs.next():
                    if len(rows)>=200:break
                    rows.append(dict(zip(rs.fields,rs.get_row_data())))
                if not rows:raise ValueError('empty-data')
            finally:bs.logout()
        return {'status':'returned','data':{'records':rows,'columns':rs.fields,'truncated':len(rows)==200},'sdkVersion':importlib.metadata.version('baostock')}
    if e['provider']=='easyquotation':
        import easyquotation
        # Exact provider from photo 06; no silent switch to Tencent and claim Sina success.
        result=easyquotation.use('sina').real([code])
        row=result.get(code) or result.get(('sh' if code.startswith('6') else 'sz')+code)
        if not isinstance(row,dict) or not row:raise ValueError('empty-data')
        return {'status':'returned','data':{'records':[{'code':code,**row}],'columns':list(row),'truncated':False},'sdkVersion':importlib.metadata.version('easyquotation')}
    if e['provider']=='cninfo':
        import urllib.parse
        fields={'pageNum':1,'pageSize':5,'tabName':'fulltext','column':'sse' if code.startswith('6') else 'szse','searchkey':code,'seDate':start+'~'+end,'sortName':'time','sortType':'desc','isHLtitle':'false'}
        req=urllib.request.Request('https://www.cninfo.com.cn/new/hisAnnouncement/query',data=urllib.parse.urlencode(fields).encode())
        with urllib.request.urlopen(req,timeout=10) as r:
            raw=r.read(1024*1024+1)
            if len(raw)>1024*1024:raise ValueError('size')
            payload=json.loads(raw)
        rows=payload.get('announcements')
        if not isinstance(rows,list) or not rows:raise ValueError('empty-data')
        rows=[{k:x.get(k) for k in ['secCode','announcementId','announcementTitle','announcementTime','adjunctUrl']} for x in rows if x.get('secCode')==code]
        if not rows:raise ValueError('wrong-symbol-or-empty')
        return {'status':'returned','data':{'records':rows,'columns':list(rows[0]),'truncated':False},'structuredApiTested':False}
    raise ValueError('unimplemented')

def collect(ident,code,start,end,fund,timeout=25):
    entry=ENTRIES[ident];base={**entry,'instrument':{'kind':'fund' if entry['kind']=='fund-nav' else 'stock','code':fund if entry['kind']=='fund-nav' else code}}
    if entry['requires']!='public': return {**base,**worker(ident,code,start,end,fund),'observedAt':int(time.time()*1000)}
    try:
        r=subprocess.run([sys.executable,str(pathlib.Path(__file__).resolve()),'--worker',ident,'--code',code,'--start',start,'--end',end,'--fund-code',fund],capture_output=True,timeout=timeout)
        if r.returncode or len(r.stdout)>2*1024*1024:raise ValueError('worker-failed')
        result=json.loads(r.stdout)
        return {**base,**result,'requestAttempted':result.get('status')!='dependency-missing','observedAt':int(time.time()*1000)}
    except subprocess.TimeoutExpired:return {**base,'status':'timeout','requestAttempted':True,'observedAt':int(time.time()*1000)}
    except Exception:return {**base,'status':'unavailable','requestAttempted':True,'observedAt':int(time.time()*1000)}

def safe_path(file):
    p=pathlib.Path(file).absolute()
    if any(x.is_symlink() for x in [p,*p.parents]):raise ValueError('symlink')
    return p

def publish(file,data):
    dest=safe_path(file);dest.parent.mkdir(parents=True,exist_ok=True)
    fd,temp=tempfile.mkstemp(prefix='.six-photo-',dir=dest.parent)
    try:
        with os.fdopen(fd,'w',encoding='utf8') as f:json.dump(data,f,ensure_ascii=False,allow_nan=False);f.write('\n');f.flush();os.fsync(f.fileno())
        os.link(temp,dest);d=os.open(dest.parent,os.O_RDONLY)
        try:os.fsync(d)
        finally:os.close(d)
    finally:os.unlink(temp)

def refresh_quote(report,code,start,end,fund,collector=None):
    if report.get('schemaVersion')!=1 or report.get('mode')!='six-photo-source-backups' or report.get('scope')!=CATALOG['scope'] or report.get('code')!=code or report.get('start')!=start or report.get('end')!=end or report.get('canTrade') is not False or report.get('paidServicesUsed') is not False or report.get('verifiedLive') is not False: raise ValueError('refresh-base')
    rows=report.get('sources')
    if not isinstance(rows,list) or len(rows)!=len(ENTRIES) or {x.get('id') for x in rows}!=set(ENTRIES):raise ValueError('refresh-rows')
    result=(collector or collect)('easyquotation.realtime',code,start,end,fund)
    updated=copy.deepcopy(report)
    updated['sources']=[result if x['id']=='easyquotation.realtime' else x for x in updated['sources']]
    updated['generatedAt']=int(time.time()*1000)
    return updated

def activate(file,data):
    dest=safe_path(file);dest.parent.mkdir(parents=True,exist_ok=True)
    if dest.exists() and not dest.is_file():raise ValueError('active-type')
    fd,temp=tempfile.mkstemp(prefix='.six-photo-active-',dir=dest.parent)
    try:
        with os.fdopen(fd,'w',encoding='utf8') as f:json.dump(data,f,ensure_ascii=False,allow_nan=False);f.write('\n');f.flush();os.fsync(f.fileno())
        os.replace(temp,dest);d=os.open(dest.parent,os.O_RDONLY)
        try:os.fsync(d)
        finally:os.close(d)
    finally:
        if os.path.exists(temp):os.unlink(temp)

def plan():
    # Publish the cheap timestamped quote last; a slow historical/market call must not age it out.
    return [ident for ident in ENTRIES if ident!='easyquotation.realtime']+['easyquotation.realtime']

def main():
    p=argparse.ArgumentParser();p.add_argument('--code',required=True);p.add_argument('--fund-code',default='161725');p.add_argument('--start',required=True);p.add_argument('--end',required=True);p.add_argument('--output');p.add_argument('--refresh-quote-from');p.add_argument('--active-output');p.add_argument('--interval-seconds',type=int,default=0);p.add_argument('--worker',choices=list(ENTRIES));a=p.parse_args();validate(a.code,a.start,a.end,a.fund_code)
    if a.interval_seconds!=0 and not 15<=a.interval_seconds<=3600:raise ValueError('interval')
    if a.refresh_quote_from:
        if a.worker or a.output or not a.active_output:raise ValueError('refresh-mode')
        source=safe_path(a.refresh_quote_from);target=safe_path(a.active_output)
        if source==target or not source.is_file() or source.stat().st_size>8*1024*1024:raise ValueError('refresh-path')
        report=json.loads(source.read_text(encoding='utf8'));stopping=threading.Event()
        signal.signal(signal.SIGTERM,lambda *args:stopping.set());signal.signal(signal.SIGINT,lambda *args:stopping.set())
        while not stopping.is_set():
            report=refresh_quote(report,a.code,a.start,a.end,a.fund_code)
            activate(target,report)
            print(json.dumps({'mode':'quote-refresh','generatedAt':report['generatedAt'],'quoteStatus':next(x['status'] for x in report['sources'] if x['id']=='easyquotation.realtime')},ensure_ascii=False),flush=True)
            if not a.interval_seconds or stopping.wait(a.interval_seconds):break
        return
    if a.active_output or a.interval_seconds:raise ValueError('refresh-required')
    if a.worker:
        try:
            with contextlib.redirect_stdout(io.StringIO()):r=worker(a.worker,a.code,a.start,a.end,a.fund_code)
        except ModuleNotFoundError:r={'status':'dependency-missing','error':'需要隔离环境安装对应SDK'}
        except Exception as e:r={'status':'unavailable','errorType':type(e).__name__}
        print(json.dumps(r,ensure_ascii=False,allow_nan=False));return
    if not a.output:raise ValueError('output-required')
    dest=safe_path(a.output)
    if dest.exists():raise ValueError('no-overwrite')
    # Serial workers avoid competing BaoStock sessions and unbounded full-market requests.
    results_by_id={}
    for ident in plan():
        result=collect(ident,a.code,a.start,a.end,a.fund_code);results_by_id[ident]=result
        print(json.dumps({'id':ident,'status':result['status']},ensure_ascii=False),flush=True)
    results=[results_by_id[ident] for ident in ENTRIES]
    report={'schemaVersion':1,'mode':'six-photo-source-backups','scope':CATALOG['scope'],'code':a.code,'start':a.start,'end':a.end,'generatedAt':int(time.time()*1000),'canTrade':False,'verifiedLive':False,'paidServicesUsed':False,'sources':results,'photo08Checks':CATALOG['photo08Checks']}
    publish(dest,report)
if __name__=='__main__':
    try:main()
    except Exception:print('六图取数参数或发布失败，旧文件未覆盖',file=sys.stderr);sys.exit(1)
