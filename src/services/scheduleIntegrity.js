// ESPN's byeWeek field may disagree with its full regular-season schedule.
// Infer only when the complete 17-game, 18-week schedule is available.
const deriveByeWeek = (schedule) => {
  const seasonType = Number(schedule.season?.type);
  const regular = (schedule.events || []).filter((e) => Number(e.season?.type ?? seasonType) === 2);
  const weeks = new Set(regular.map((e) => Number(e.week?.number)).filter((w) => w >= 1 && w <= 18));
  if (regular.length === 17 && weeks.size === 17) return Array.from({ length: 18 }, (_, i) => i + 1).find((w) => !weeks.has(w));
  // A partial/postseason schedule cannot establish a bye. Do not present a
  // provider value as verified when a full schedule has not been retrieved.
  return null;
};
module.exports = { deriveByeWeek };
