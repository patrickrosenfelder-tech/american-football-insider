#!/usr/bin/env python3
"""Build the served v2 artifact by replaying completed PBP through export_features."""
import argparse, csv, json, math, pathlib
from collections import defaultdict
from datetime import datetime, timezone
import pandas as pd
import export_features as features

ROOT=pathlib.Path(__file__).parent; MODEL=json.loads((ROOT/'model_v2.json').read_text()); FIXTURE=ROOT.parent.parent/'test'/'fixtures'/'parity_20.csv'; OUT=ROOT/'predictions_current.json'
GAMES_URL='https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv'
def predict(row):
    def score(kind): return sum(float(row[k])*MODEL['coefficients'][kind][k] for k in MODEL['features'])
    logit,margin=score('win_probability'),score('home_margin');return 1/(1+math.exp(-max(-30,min(30,logit)))),margin
def parity_check():
    with FIXTURE.open() as f: rows=list(csv.DictReader(f))
    assert len(rows)==20
    for row in rows:
        p,m=predict(row);assert abs(p-float(row['expected_v2_probability']))<1e-12;assert abs(m-float(row['expected_v2_margin']))<1e-12
def load_pbp(season,start,cache):
    frames=[]
    for year in range(start,season+1):
        try: frames.append(features.get(year,cache))
        except Exception as error: print(f'skipping unavailable {year}: {error}',flush=True)
    pbp=pd.concat(frames,ignore_index=True);pbp=pbp[pbp.season_type.eq('REG')].copy();pbp['kickoff']=pd.to_datetime(pbp.start_time,utc=True,errors='coerce').fillna(pd.to_datetime(pbp.game_date,utc=True));return pbp.sort_values(['kickoff','game_id'])
def load_schedule(season,cache):
    path=cache/'games.csv'
    if not path.exists():
        import urllib.request;print('downloading nflverse games.csv',flush=True);urllib.request.urlretrieve(GAMES_URL,path)
    games=pd.read_csv(path);games=games[(games.season==season)&(games.game_type=='REG')].copy();games['kickoff']=pd.to_datetime(games['gameday'].astype(str)+' '+games['gametime'].fillna('00:00'),utc=True,errors='coerce');return games.sort_values(['kickoff','game_id'])
# nflverse and ESPN disagree on two abbreviations; the served artifact carries
# both so Node can match ESPN scoreboard games without its own mapping.
ESPN={'LA':'LAR','WAS':'WSH'}
def espn(team): return ESPN.get(team,team)
def public(row):
    p,m=predict(row);c=[{'feature':k,'value':round(float(row[k]),6),'win_probability':round(float(row[k])*MODEL['coefficients']['win_probability'][k],6),'home_margin':round(float(row[k])*MODEL['coefficients']['home_margin'][k],6)} for k in MODEL['features']];c.sort(key=lambda x:abs(x['home_margin']),reverse=True)
    line=lambda x:None if pd.isna(x) else float(x)
    return {'game_id':str(row['game_id']),'kickoff':row['kickoff'],'season':int(row['season']),'week':int(row['week']),'matchup_key':f"{row['away']}:{row['home']}",'home_team':row['home'],'away_team':row['away'],'home_team_espn':espn(row['home']),'away_team_espn':espn(row['away']),'spread_line':line(row['closing_spread']),'total_line':line(row['closing_total']),'features':{k:round(float(row[k]),6) for k in MODEL['features']},'home_win_probability':round(p,8),'home_margin':round(m,6),'top_contributions':c[:3]}
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--season',type=int,default=datetime.now(timezone.utc).year);parser.add_argument('--start',type=int,default=2002);parser.add_argument('--cache',default=str(ROOT/'.cache'));parser.add_argument('--output',default=str(OUT));args=parser.parse_args();parity_check();cache=pathlib.Path(args.cache);cache.mkdir(parents=True,exist_ok=True)
    pbp=load_pbp(args.season,args.start,cache);pbp=pbp[pbp.kickoff<=pd.Timestamp.now(tz='UTC')];h,elo,last=defaultdict(list),defaultdict(lambda:1505.0),{};last_played=None;played_ids=set()
    for _,game in pbp.groupby('game_id',sort=False):
        if features.record_result(game,h,elo,last):last_played=game.iloc[0].kickoff;played_ids.add(str(game.iloc[0].game_id))
    games=load_schedule(args.season,cache);upcoming=games[games.home_score.isna()&~games.game_id.astype(str).isin(played_ids)];rows=[]
    for game in upcoming.itertuples(index=False):
        if pd.isna(game.kickoff) or game.kickoff<=last_played:continue
        rows.append(features.feature_row(game.game_id,game.kickoff,game.season,game.week,game.home_team,game.away_team,h,elo,last,game.spread_line,game.total_line))
    payload={'model_version':MODEL['version'],'generated_at':datetime.now(timezone.utc).isoformat(),'data_through':last_played.isoformat() if last_played is not None else None,'predictions':[public(row) for row in rows]};pathlib.Path(args.output).write_text(json.dumps(payload,indent=2,allow_nan=False)+'\n',encoding='utf-8');print(json.dumps({'artifact':args.output,'parity_rows':20,'predictions':len(rows),'data_through':payload['data_through']}))
if __name__=='__main__':main()
