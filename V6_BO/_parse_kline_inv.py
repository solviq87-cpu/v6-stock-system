import json
def load(p):
    try: return json.load(open(p))
    except: return None
def gr_rows(o):
    rows=[]
    for k,v in o.items():
        if k in ('at','ztSlice','universe'): continue
        if not isinstance(v,dict): continue
        bk=v.get('buckets')
        if isinstance(bk,dict): bk=list(bk.values())   # gr 桶是 dict 形态
        if isinstance(bk,list): rows.append((k,v))
    return rows
def gs_rows(o): return [('gs',c) for c in (o.get('results',[]) if isinstance(o,dict) else [])]
def hf_rows(o): return [('hf',c) for c in (o if isinstance(o,list) else [])]
def analyze(tag,c):
    bn=c.get('n'); base=c.get('baseZtT'); bk=c.get('buckets',[])
    best=None; any_same=False; worst_down=None; bestk=None
    for b in bk:
        if not isinstance(b,dict): continue
        d=b.get('delta')
        if not isinstance(d,(int,float)): continue
        if best is None or d>best: best=d; bestk=b.get('k')
        if b.get('half')=='同向': any_same=True
        dn=(b.get('reg') or {}).get('down',{})
        if isinstance(dn,dict) and isinstance(dn.get('delta'),(int,float)):
            if worst_down is None or dn['delta']<worst_down: worst_down=dn['delta']
    edge=(best is not None and best>=3 and any_same and (worst_down is None or worst_down>-5))
    return dict(tag=tag,id=c.get('id'),name=c.get('name'),n=bn,base=base,best=best,bestk=bestk,
                same=any_same,down=worst_down,edge=edge)
allc=[]
for k,v in gr_rows(load('_research_gr_out.json')): allc.append(analyze('gr',v))
for tag,c in gs_rows(load('_research_gs_out.json')): allc.append(analyze(tag,c))
for tag,c in hf_rows(load('_research_hf_out.json')): allc.append(analyze(tag,c))
adopted=[r for r in allc if r['edge']]
pending=[r for r in allc if not r['edge']]
print('总测量候选:',len(allc),' 有edge(已采纳倾向):',len(adopted),' 剩余未采纳:',len(pending))
print('\n=== 剩余未采纳（无 edge / 半窗背离 / 普跌显著恶化）===')
for r in sorted(pending,key=lambda x:-(x['best'] or -99)):
    print(f"  {r['tag']}|{str(r['id']):<5} {str(r['name'])[:22]:<22} n={r['n']} base={r['base']} bestΔ={r['best']}({r['bestk']}) 同向={r['same']} 普跌Δ={r['down']}")
print('\n=== 有edge候选（bestΔ 降序）===')
for r in sorted(adopted,key=lambda x:-(x['best'] or 0)):
    print(f"  {r['tag']}|{str(r['id']):<5} {str(r['name'])[:22]:<22} n={r['n']} bestΔ={r['best']}({r['bestk']}) 普跌Δ={r['down']}")
json.dump({'adopted':[r['id'] for r in adopted],'pending':[r['id'] for r in pending],
           'pending_detail':pending}, open('_kline_inv.json','w'), ensure_ascii=False)
print('\n→ 已落盘 _kline_inv.json')
