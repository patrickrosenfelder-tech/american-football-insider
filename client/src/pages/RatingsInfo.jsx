const GROUPS = [
  ['QB', 'EPA per dropback 35%, ANY/A 30%, CPOE 20%, rush yards/game 15%', '40+ pass attempts'],
  ['RB / FB', 'Rush yards/game 30%, rush EPA/carry 20%, yards/carry 15%, rec yards/game 20%, TD/game 15%', '15+ carries + targets'],
  ['WR / TE', 'Rec yards/game 35%, yards/target 20%, rec EPA/target 20%, target share 15%, TD/game 10%', 'WR 8+ targets, TE 5+'],
  ['OL', 'Snap share 60%, team sack rate allowed (inverse) 20%, team rush EPA/carry 20%', '60+ offensive snaps'],
  ['DL / EDGE', 'Sacks/game 30%, QB hits/game 25%, TFL/game 25%, tackles/game 10%, forced fumbles 10%', '50+ defensive snaps'],
  ['LB', 'Tackles/game 35%, TFL/game 20%, sacks + QB hits/game 15%, passes defended 15%, INT + FF 15%', '50+ defensive snaps'],
  ['DB', 'Passes defended/game 35%, INT 25%, tackles/game 20%, TFL 10%, forced fumbles 10%', '50+ defensive snaps'],
  ['K', 'FG% 50%, 50+ yard FGs 20%, PAT% 30%', '4+ kicks'],
  ['P', 'Net yards/punt 60%, inside-20 rate 40%', '5+ punts']
];

export default function RatingsInfo() {
  return (
    <section className="prose">
      <div className="page-head"><h1>AFI rating</h1></div>
      <div className="card">
        <p>The <b>AFI rating</b> (0–99) is Football Insider’s own player rating. It is built only from public season stats
          and snap counts (nflverse). It is <b>not</b> an EA Sports Madden rating; we don’t use or copy Madden data.</p>
        <ol>
          <li>Players are grouped by position.</li>
          <li>For each metric, a player gets his percentile rank among qualified players at that position (league-wide, current season).</li>
          <li><b>production</b> = weighted average of those percentiles.</li>
          <li><b>composite</b> = 75% production + 25% snap-share percentile (kickers and punters: production only; OL: 40% production + 60% snap share, because there are no public individual OL stats).</li>
          <li><b>AFI = round(40 + 59 × composite)</b>, so ratings run from 40 to 99.</li>
        </ol>
        <p>Players under the minimum sample get <b>NR</b> (not rated). Ratings refresh with the weekly nflverse data job, so early-season ratings move a lot.</p>
      </div>
      <div className="card table-card">
        <table>
          <thead><tr><th className="left">Group</th><th className="left">Metrics (weight)</th><th className="left">Minimum sample</th></tr></thead>
          <tbody>
            {GROUPS.map(([g, m, q]) => <tr key={g}><td className="left"><b>{g}</b></td><td className="left wrap-cell">{m}</td><td className="left">{q}</td></tr>)}
          </tbody>
        </table>
      </div>
    </section>
  );
}
