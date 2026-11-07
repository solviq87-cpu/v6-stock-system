#!/usr/bin/env python3
"""Optional research collectors. Bounded subprocesses; never a trading feed."""
import argparse, concurrent.futures, datetime, importlib.metadata, json, math, os, pathlib, re, subprocess, sys, tempfile, time, urllib.parse, urllib.request
PROVIDERS=('mootdx','efinance','cninfo','ashare','baostock')
def catalog():
    return json.loads((pathlib.Path(__file__).resolve().parent.parent/'config/data-source-catalog.json').read_text(encoding='utf-8'))['sources']
def permitted(provider):
    return any(x['id']==provider and x['access']=='enabled-private-research' for x in catalog())
def code_check(code):
    if not re.fullmatch(r'(60|68|00|30)\d{4}',code): raise ValueError('只支持沪深A股')
    return code

def announcements(data,code,observed):
    if not isinstance(data,dict) or not isinstance(data.get('announcements'),list): raise ValueError('公告结构无效')
    result={}
    for x in data['announcements'][:20]:
        if x.get('secCode')!=code: continue
        ident=x.get('announcementId'); at=x.get('announcementTime'); url=x.get('adjunctUrl'); title=x.get('announcementTitle')
        if not isinstance(ident,str) or not ident.isdigit() or not isinstance(at,(int,float)) or isinstance(at,bool) or not math.isfinite(at) or at<=0 or at>observed: raise ValueError('公告ID或时点无效')
        if not isinstance(url,str) or not re.fullmatch(r'finalpage/\d{4}-\d{2}-\d{2}/\d+\.pdf',url,re.I): raise ValueError('公告文件路径无效')
        if not isinstance(title,str) or not title.strip() or len(title)>1000: raise ValueError('公告标题无效')
        item={'id':ident,'code':code,'title':re.sub('<[^>]*>','',title),'publishedAt':at,'firstObservedAt':observed,'url':'https://static.cninfo.com.cn/'+url,'source':'巨潮资讯','direction':'中性','reason':'公告原文，尚未进行利好利空分析','publicationPrecision':'provider-value-not-certified'}
        if ident in result and result[ident]!=item: raise ValueError('重复公告ID内容冲突')
        result[ident]=item
    return list(result.values())

def frame_records(frame):
    if frame is None or frame.empty: raise ValueError('未返回数据')
    if len(frame)>1000: frame=frame.tail(1000)
    return json.loads(frame.to_json(orient='records',date_format='iso',force_ascii=False))

def worker(provider,code,start,end):
    if not permitted(provider): raise ValueError('数据许可范围待核实，未发起请求')
    observed=int(time.time()*1000)
    if provider=='cninfo':
        fields={'pageNum':1,'pageSize':20,'tabName':'fulltext','column':'sse' if code.startswith('6') else 'szse','searchkey':code,'seDate':start+'~'+end,'sortName':'time','sortType':'desc','isHLtitle':'false'}
        req=urllib.request.Request('https://www.cninfo.com.cn/new/hisAnnouncement/query',data=urllib.parse.urlencode(fields).encode())
        with urllib.request.urlopen(req,timeout=10) as r:
            raw=r.read(2*1024*1024+1)
            if len(raw)>2*1024*1024: raise ValueError('公告响应过大')
            data=json.loads(raw)
        return {'upstream':'cninfo','announcements':announcements(data,code,int(time.time()*1000)),'publicationNotSentiment':True}
    if provider=='efinance':
        import efinance as ef
        # Explicit unadjusted daily bars; do not mix unfinished current bar into backtests.
        bars=frame_records(ef.stock.get_quote_history(code,beg=start.replace('-',''),end=end.replace('-',''),klt=101,fqt=0))
        try: flow={'status':'observed','records':frame_records(ef.stock.get_history_bill(code))[-20:]}
        except Exception: flow={'status':'unavailable','records':[]}
        return {'upstream':'eastmoney','sdkVersion':importlib.metadata.version('efinance'),'bars':bars,'flows':flow,'flowQueryRangeApplied':False,'priceAdjustment':'unadjusted-requested','volumeUnit':'provider-native','intradayFinalityVerified':False}
    if provider=='mootdx':
        from mootdx.quotes import Quotes
        c=Quotes.factory(market='std',timeout=3)
        try: bars=frame_records(c.bars(symbol=code,frequency=9,offset=20))
        finally:
            if hasattr(c,'disconnect'): c.disconnect()
        return {'upstream':'tdx','sdkVersion':importlib.metadata.version('mootdx'),'bars':bars,'volumeUnit':'provider-native','intradayFinalityVerified':False,'queryRangeApplied':False}
    if provider=='ashare':
        from Ashare import get_price
        prefix='sh' if code.startswith('6') else 'sz'
        bars=frame_records(get_price(prefix+code,end_date=end,count=250,frequency='1d').reset_index())
        return {'upstream':'sina/tencent','bars':bars,'queryRangeApplied':False,'priceAdjustment':'provider-dependent','volumeUnit':'provider-native','intradayFinalityVerified':False}
    if provider=='baostock':
        import baostock as bs, contextlib, io
        # BaoStock writes login messages to stdout; keep worker protocol clean.
        with contextlib.redirect_stdout(io.StringIO()):
            lg=bs.login()
            if lg.error_code!='0': raise ValueError('BaoStock登录失败')
            try:
                rs=bs.query_history_k_data_plus(('sh.' if code.startswith('6') else 'sz.')+code,'date,code,open,high,low,close,volume,amount,adjustflag,tradestatus',start_date=start,end_date=end,frequency='d',adjustflag='3')
                if rs.error_code!='0': raise ValueError('BaoStock查询失败')
                rows=[]
                while rs.next():
                    if len(rows)>=1000: raise ValueError('记录数超限')
                    rows.append(dict(zip(rs.fields,rs.get_row_data())))
                if not rows: raise ValueError('BaoStock未返回数据')
            finally: bs.logout()
        return {'upstream':'baostock','sdkVersion':importlib.metadata.version('baostock'),'bars':rows,'priceAdjustment':'unadjusted-requested','volumeUnit':'provider-native','intradayFinalityVerified':False,'queryRangeApplied':True}
    raise ValueError('未知来源')

def collect(provider,code,start,end,timeout=25):
    if not permitted(provider): return {'provider':provider,'status':'permission-pending','error':'仅登记适配器，当前未发起网络请求'}
    try:
        r=subprocess.run([sys.executable,str(pathlib.Path(__file__).resolve()),'--worker',provider,'--code',code,'--start',start,'--end',end],capture_output=True,timeout=timeout)
        if r.returncode or len(r.stdout)>3*1024*1024: raise ValueError('worker')
        payload=json.loads(r.stdout)
        if not isinstance(payload,dict): raise ValueError('payload')
        return {'provider':provider,'status':'observed','data':payload}
    except subprocess.TimeoutExpired: return {'provider':provider,'status':'timeout','error':'SDK进程超时，已终止'}
    except Exception: return {'provider':provider,'status':'unavailable','error':'依赖缺失、网络不可达或返回校验失败'}

def publish(file,data):
    dest=pathlib.Path(file).absolute();dest.parent.mkdir(parents=True,exist_ok=True)
    fd,temp=tempfile.mkstemp(prefix='.research-sources-',dir=dest.parent)
    try:
        with os.fdopen(fd,'w',encoding='utf-8') as f: json.dump(data,f,ensure_ascii=False,allow_nan=False);f.write('\n');f.flush();os.fsync(f.fileno())
        os.link(temp,dest) # never overwrite an earlier observation
        d=os.open(dest.parent,os.O_RDONLY)
        try: os.fsync(d)
        finally: os.close(d)
    finally: os.unlink(temp)

def main():
    p=argparse.ArgumentParser();p.add_argument('--worker',choices=PROVIDERS);p.add_argument('--code',required=True);p.add_argument('--start',required=True);p.add_argument('--end',required=True);p.add_argument('--output');a=p.parse_args();code_check(a.code)
    start=datetime.date.fromisoformat(a.start);end=datetime.date.fromisoformat(a.end);today=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).date()
    if start>end or end>today or (end-start).days>366: raise ValueError('区间无效或超出366天')
    if a.worker: print(json.dumps(worker(a.worker,a.code,a.start,a.end),ensure_ascii=False,allow_nan=False));return
    if not a.output: raise ValueError('需要新输出文件')
    with concurrent.futures.ThreadPoolExecutor(3) as pool: results=list(pool.map(lambda x:collect(x,a.code,a.start,a.end),PROVIDERS))
    now=int(time.time()*1000);report={'catalog':catalog(),'schemaVersion':2,'mode':'optional-research-sources','code':a.code,'start':a.start,'end':a.end,'observedAt':now,'canTrade':False,'verifiedLive':False,'sources':results,'warning':'原始研究证据，未转换为实盘行情；SDK不等于独立上游，缺项不补零'}
    publish(a.output,report);print(json.dumps({'output':str(pathlib.Path(a.output).absolute()),'sources':[{'provider':x['provider'],'status':x['status']} for x in results]}))
if __name__=='__main__':
    try: main()
    except Exception: print('采集参数、网络或新文件发布失败；旧证据未覆盖',file=sys.stderr);sys.exit(1)
