#!/usr/bin/env python3
"""Export one no-look-ahead AFI feature row per nflverse regular-season game."""
import argparse, pathlib, urllib.request
from collections import defaultdict
import numpy as np
import pandas as pd
ROOT = pathlib.Path(__file__).parent
URL = "https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{year}.parquet"
def weighted(x, half_life=5):
    if not x: return np.nan
    w=np.exp(-np.log(2)*np.arange(len(x)-1,-1,-1)/half_life); return float(np.average(x,weights=w))
def val(x): return float(x) if pd.notna(x) else np.nan
def stats(p, team, offense=True):
    q=p[p.posteam.eq(team) if offense else p.defteam.eq(team)]; q=q[q.epa.notna() & q.qb_kneel.ne(1) & q.two_point_attempt.ne(1)]
    if q.empty:return {}
    pas,rush=q[q["pass"].eq(1)],q[q["rush"].eq(1)]
    return {"epa":val(q.epa.mean()),"pass_epa":val(pas.epa.mean()),"rush_epa":val(rush.epa.mean()),"success":val((q.epa>0).mean()),"early_pass":val(q[q.down.isin([1,2])]["pass"].mean()),"pressure":val(pas.sack.mean())}
def hist(h,t,k):return weighted([x[k] for x in h[t] if pd.notna(x.get(k))])
def diff(h,a,b,k):
    x,y=hist(h,a,k),hist(h,b,k);return x-y if pd.notna(x) and pd.notna(y) else np.nan
def put(r,k,x):r[k]=0.0 if pd.isna(x) else round(float(x),6);r[f"{k}_missing"]=int(pd.isna(x))
def get(year,cache):
    path=cache/f"play_by_play_{year}.parquet"
    if not path.exists(): print(f"downloading {year}",flush=True);urllib.request.urlretrieve(URL.format(year=year),path)
    return pd.read_parquet(path)
def feature_row(gid, kickoff, season, week, home, away, h, elo, last, spread=np.nan, total=np.nan):
    """The single point-in-time feature accumulator used for training and serving."""
    r={"game_id":gid,"kickoff":pd.Timestamp(kickoff).isoformat(),"season":int(season),"week":int(week),"home":home,"away":away,"closing_spread":val(spread),"closing_total":val(total),"home_field":1.0}
    put(r,"adj_epa_diff",(hist(h,home,"epa")-hist(h,away,"def_epa"))-(hist(h,away,"epa")-hist(h,home,"def_epa")));put(r,"pass_epa_diff",diff(h,home,away,"pass_epa"));put(r,"rush_epa_diff",diff(h,home,away,"rush_epa"));put(r,"success_diff",diff(h,home,away,"success"));put(r,"margin_diff",diff(h,home,away,"margin"));put(r,"early_pass_diff",diff(h,home,away,"early_pass"));put(r,"pressure_diff",diff(h,home,away,"pressure"));put(r,"pass_epa_x_pressure",hist(h,home,"pass_epa")*hist(h,away,"pressure")-hist(h,away,"pass_epa")*hist(h,home,"pressure"));put(r,"rush_epa_x_rush_def",hist(h,home,"rush_epa")*hist(h,away,"def_epa")-hist(h,away,"rush_epa")*hist(h,home,"def_epa"))
    rh=(pd.Timestamp(kickoff).date()-last[home]).days if home in last else np.nan;ra=(pd.Timestamp(kickoff).date()-last[away]).days if away in last else np.nan;put(r,"rest_diff",rh-ra if pd.notna(rh) and pd.notna(ra) else np.nan);put(r,"availability_diff",np.nan);r["availability_missing"]=1;put(r,"recent_margin_diff",diff(h,home,away,"margin"));put(r,"upset_diff",diff(h,home,away,"upset"));r["elo_diff"]=round(elo[home]+48-elo[away],6);r["elo_home_prob"]=round(1/(1+10**(-r["elo_diff"]/400)),6);r["legacy_v1_margin"]=r["recent_margin_diff"]*.6+1.5
    return r
def record_result(g, h, elo, last):
    g=g.sort_values("play_id");z=g.iloc[0];final=g.iloc[-1];home,away=z.home_team,z.away_team;hs,aas=val(final.total_home_score),val(final.total_away_score)
    if not isinstance(home,str) or not isinstance(away,str) or pd.isna(hs) or pd.isna(aas): return False
    ho,ao,hd,ad=stats(g,home),stats(g,away),stats(g,home,False),stats(g,away,False);ex=1/(1+10**(-(elo[home]+48-elo[away])/400));mov=np.log(abs(hs-aas)+1)*(2.2/((elo[home]-elo[away])*.001+2.2));d=20*mov*(float(hs>aas)-ex);elo[home]+=d;elo[away]-=d;h[home].append({**ho,"margin":hs-aas,"upset":int(z.spread_line>0 and hs>aas)});h[away].append({**ao,"margin":aas-hs,"upset":int(z.spread_line<0 and aas>hs)});h[home].append({f"def_{k}":v for k,v in hd.items()});h[away].append({f"def_{k}":v for k,v in ad.items()});last[home]=z.kickoff.date();last[away]=z.kickoff.date();return True
def main():
    p=argparse.ArgumentParser();p.add_argument("--start",type=int,default=2002);p.add_argument("--output-start",type=int,default=2016);p.add_argument("--end",type=int,default=2026);p.add_argument("--cache",default=str(ROOT/".cache"));p.add_argument("--output",default=str(ROOT/"features_2016_2026.csv"));a=p.parse_args()
    cache=pathlib.Path(a.cache);cache.mkdir(parents=True,exist_ok=True);frames=[]
    for y in range(a.start,a.end+1):
        try:frames.append(get(y,cache))
        except Exception as e:print(f"skipping unavailable {y}: {e}")
    pbp=pd.concat(frames,ignore_index=True);pbp=pbp[pbp.season_type.eq("REG")].copy();pbp["kickoff"]=pd.to_datetime(pbp.start_time,utc=True,errors="coerce");pbp["kickoff"]=pbp["kickoff"].fillna(pd.to_datetime(pbp.game_date,utc=True));pbp=pbp.sort_values(["kickoff","game_id"])
    h,elo,last,rows=defaultdict(list),defaultdict(lambda:1505.0),{},[]
    for gid,g in pbp.groupby("game_id",sort=False):
        g=g.sort_values("play_id");z=g.iloc[0];final=g.iloc[-1];home,away,season,kickoff=z.home_team,z.away_team,int(z.season),z.kickoff
        if not isinstance(home,str) or not isinstance(away,str):continue
        hs,aas=val(final.total_home_score),val(final.total_away_score);ho,ao,hd,ad=stats(g,home),stats(g,away),stats(g,home,False),stats(g,away,False)
        if season>=a.output_start and pd.notna(hs) and pd.notna(aas):
            r=feature_row(gid,kickoff,season,z.week,home,away,h,elo,last,z.spread_line,z.total_line);r.update(home_win=int(hs>aas),home_margin=hs-aas);rows.append(r)
        record_result(g,h,elo,last)
    out=pd.DataFrame(rows).sort_values("kickoff");out.to_csv(a.output,index=False);print(f"wrote {len(out)} point-in-time rows to {a.output}")
if __name__=="__main__":main()
