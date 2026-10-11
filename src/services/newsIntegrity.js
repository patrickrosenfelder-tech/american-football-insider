const TEAM_NAMES = ['Cardinals', 'Falcons', 'Ravens', 'Bills', 'Panthers', 'Bears', 'Bengals', 'Browns', 'Cowboys', 'Broncos', 'Lions', 'Packers', 'Texans', 'Colts', 'Jaguars', 'Chiefs', 'Raiders', 'Chargers', 'Rams', 'Dolphins', 'Vikings', 'Patriots', 'Saints', 'Giants', 'Jets', 'Eagles', 'Steelers', '49ers', 'Seahawks', 'Buccaneers', 'Titans', 'Commanders'];
const teamsIn = (text) => TEAM_NAMES.filter((name) => new RegExp(`\\b${name}\\b`, 'i').test(text || ''));
const unsupportedTeams = (text, sources) => teamsIn(text).some((name) => !teamsIn(sources).includes(name));

// Validate against source text, not LLM-supplied tags. Also repair old stored
// titles at read time, so deploying the guard fixes previously generated errors.
const safeStory = (story) => {
  if (story.kind !== 'headline') return story;
  const sourceText = (story.sources || []).map((s) => `${s.title || ''} ${s.snippet || ''}`).join(' ');
  const title = story.ai_title && !unsupportedTeams(story.ai_title, sourceText) ? story.ai_title : story.title;
  const summary = story.summary && !unsupportedTeams(story.summary, sourceText) ? story.summary : null;
  return { ...story, ai_title: title === story.ai_title ? title : null, summary, ai: summary ? story.ai : null };
};

// Keep NFL draft/transition coverage, but omit clearly college-only headlines
// unless the text also establishes an NFL connection.
const isNflStory = (text) => !/\b(?:college|NCAA|NCAAF|CFB|Hokies|Cougars|Wildcats|Georgia Tech|Virginia Tech|Penn State|Arch Manning|Nico Iamaleava|Cal(?:ifornia)? (?:gets|defeats|wins)|Tennessee escapes Arkansas)\b/i.test(text)
  || /\bNFL\b|\bdraft\b/i.test(text) || teamsIn(text).length > 0;

module.exports = { safeStory, unsupportedTeams, isNflStory };
