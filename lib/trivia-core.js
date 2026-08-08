// ============================================
// Pure trivia-scoring logic — no DOM, no fetch, no globals read implicitly.
// Every function takes exactly what it needs as arguments, which is what makes
// this testable with plain node:test (see test/trivia-core.test.mjs) and safe to
// reuse from both the browser (app.js) and Node (scripts/fetch-daily-questions.mjs).
//
// Loaded in the browser as a plain <script> (defines these as globals, same
// pattern as config.js) and in Node via module.exports at the bottom.
// ============================================

function dateKeyOf(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function monthKeyOf(dateStr) {
  return dateStr.slice(0, 7); // "YYYY-MM"
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Only ever iterate real "YYYY-MM-DD" entries in a scores record — bins are seeded
// with a placeholder key (e.g. "_init") to satisfy JSONBin's "can't be empty" check,
// and that placeholder must never be treated as a day of scores.
function dateEntries(scoresRecord) {
  return Object.entries(scoresRecord).filter(([key]) => DATE_KEY_RE.test(key));
}

function playedOn(scoresRecord, dateKey, name) {
  const day = scoresRecord[dateKey];
  return !!(day && day[name]);
}

// Current consecutive-day streak for a player, ending "todayKey" if they've already
// played today, or ending yesterday (not yet broken) if they haven't played yet today.
function currentStreak(scoresRecord, todayKey, name) {
  let cursor = new Date(`${todayKey}T00:00:00`);
  if (!playedOn(scoresRecord, todayKey, name)) {
    cursor.setDate(cursor.getDate() - 1);
  }
  let streak = 0;
  while (playedOn(scoresRecord, dateKeyOf(cursor), name)) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// Longest streak this player has ever had, including past (already-ended) runs.
function longestStreakEver(scoresRecord, name) {
  const playedDates = dateEntries(scoresRecord)
    .filter(([, day]) => day[name])
    .map(([date]) => date)
    .sort();
  if (!playedDates.length) return 0;

  let longest = 1;
  let run = 1;
  for (let i = 1; i < playedDates.length; i++) {
    const prev = new Date(`${playedDates[i - 1]}T00:00:00`);
    const cur = new Date(`${playedDates[i]}T00:00:00`);
    const diffDays = Math.round((cur - prev) / 86400000);
    run = diffDays === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  return longest;
}

// Returns the winning player's name for a given day's score object.
// requireFullRoster=true means nobody gets crowned until every current player has
// submitted (the deliberate suspense for "today", while it's still in progress).
// For any day already in the past, pass false — the winner is just whoever did
// best among whoever actually played that day.
function dayWinner(dayScores, players, requireFullRoster) {
  const participants = Object.keys(dayScores);
  if (!participants.length) return null;
  if (requireFullRoster && !players.every((p) => dayScores[p])) return null;

  const sorted = Object.entries(dayScores).sort((a, b) => {
    if (b[1].score !== a[1].score) return b[1].score - a[1].score;
    const aTime = a[1].timeSeconds ?? Infinity;
    const bTime = b[1].timeSeconds ?? Infinity;
    return aTime - bTime;
  });
  return sorted[0][0];
}

// player -> { totalScore, totalQuestions, games, totalTime, timedGames }, for whichever
// dates dateFilterFn(date) returns true for.
function aggregate(scoresRecord, dateFilterFn) {
  const agg = {};
  dateEntries(scoresRecord).forEach(([date, dayScores]) => {
    if (!dateFilterFn(date)) return;
    Object.entries(dayScores).forEach(([player, entry]) => {
      if (!agg[player]) {
        agg[player] = { totalScore: 0, totalQuestions: 0, games: 0, totalTime: 0, timedGames: 0 };
      }
      agg[player].totalScore += entry.score;
      agg[player].totalQuestions += entry.total;
      agg[player].games += 1;
      if (typeof entry.timeSeconds === "number") {
        agg[player].totalTime += entry.timeSeconds;
        agg[player].timedGames += 1;
      }
    });
  });
  return agg;
}

// player -> number of days won, within the given date filter. "today" (todayKey)
// requires full-roster participation to count; every other date doesn't.
function countWins(scoresRecord, players, todayKey, dateFilterFn) {
  const wins = {};
  dateEntries(scoresRecord).forEach(([date, dayScores]) => {
    if (!dateFilterFn(date)) return;
    const isToday = date === todayKey;
    const winner = dayWinner(dayScores, players, isToday);
    if (winner) wins[winner] = (wins[winner] || 0) + 1;
  });
  return wins;
}

// Case-insensitive, "contains"-based category exclusion matching — so "Entertainment"
// excludes every "Entertainment: ..." subcategory at once, while "Sports" only
// excludes that one. excludedTerms should already be lowercased/trimmed.
function isExcludedCategory(categoryName, excludedTerms) {
  const lower = categoryName.toLowerCase();
  return excludedTerms.some((term) => lower.includes(term));
}

const TriviaCore = {
  dateKeyOf,
  monthKeyOf,
  dateEntries,
  playedOn,
  currentStreak,
  longestStreakEver,
  dayWinner,
  aggregate,
  countWins,
  isExcludedCategory,
};

// Browser: attach everything as plain globals (same pattern config.js uses), so
// app.js can keep calling these functions by name with no import syntax needed.
if (typeof window !== "undefined") {
  Object.assign(window, TriviaCore);
}

// Node: normal CommonJS export, used by scripts/fetch-daily-questions.mjs and the
// test suite.
if (typeof module !== "undefined" && module.exports) {
  module.exports = TriviaCore;
}
