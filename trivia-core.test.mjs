import { test, describe } from "node:test";
import assert from "node:assert/strict";
import TriviaCore from "../lib/trivia-core.js";

const {
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
} = TriviaCore;

describe("dateKeyOf / monthKeyOf", () => {
  test("formats as YYYY-MM-DD", () => {
    assert.equal(dateKeyOf(new Date(2026, 7, 8)), "2026-08-08"); // month is 0-indexed
  });

  test("pads single-digit month/day", () => {
    assert.equal(dateKeyOf(new Date(2026, 0, 5)), "2026-01-05");
  });

  test("monthKeyOf slices to YYYY-MM", () => {
    assert.equal(monthKeyOf("2026-08-08"), "2026-08");
  });
});

describe("dateEntries", () => {
  test("filters out non-date keys like the JSONBin seed placeholder", () => {
    const record = { _init: "seed placeholder", "2026-08-01": { Nate: { score: 8 } } };
    const entries = dateEntries(record);
    assert.equal(entries.length, 1);
    assert.equal(entries[0][0], "2026-08-01");
  });

  test("returns empty array for an empty record", () => {
    assert.deepEqual(dateEntries({}), []);
  });
});

describe("playedOn", () => {
  const record = { "2026-08-01": { Nate: { score: 8 } } };
  test("true when the player has an entry that day", () => {
    assert.equal(playedOn(record, "2026-08-01", "Nate"), true);
  });
  test("false when they don't", () => {
    assert.equal(playedOn(record, "2026-08-01", "Thomas"), false);
    assert.equal(playedOn(record, "2026-08-02", "Nate"), false);
  });
});

describe("currentStreak", () => {
  test("counts consecutive days ending today, when today is played", () => {
    const record = {};
    ["2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08"].forEach((d) => {
      record[d] = { Nate: { score: 8, total: 10 } };
    });
    assert.equal(currentStreak(record, "2026-08-08", "Nate"), 4);
  });

  test("counts through yesterday when today hasn't been played yet (not broken)", () => {
    const record = {};
    ["2026-08-06", "2026-08-07"].forEach((d) => {
      record[d] = { Nate: { score: 8, total: 10 } };
    });
    assert.equal(currentStreak(record, "2026-08-08", "Nate"), 2);
  });

  test("resets to the run after a gap, not the whole history", () => {
    const record = {};
    ["2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02", "2026-08-04"].forEach((d) => {
      record[d] = { Nate: { score: 8, total: 10 } };
    });
    // Aug 3 was skipped, so the streak ending Aug 4 is just 1 day, even though
    // there's a longer run earlier in the history.
    assert.equal(currentStreak(record, "2026-08-04", "Nate"), 1);
  });

  test("crosses a month boundary correctly", () => {
    const record = {};
    ["2026-07-30", "2026-07-31", "2026-08-01"].forEach((d) => {
      record[d] = { Nate: { score: 8, total: 10 } };
    });
    assert.equal(currentStreak(record, "2026-08-01", "Nate"), 3);
  });

  test("is 0 for a player with no history", () => {
    assert.equal(currentStreak({}, "2026-08-08", "Nate"), 0);
  });
});

describe("longestStreakEver", () => {
  test("finds the longest run even if it's not the most recent one", () => {
    const record = {};
    // A 4-day run (Jul 30 - Aug 2), then a gap, then a 1-day appearance.
    ["2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02", "2026-08-04"].forEach((d) => {
      record[d] = { Nate: { score: 8, total: 10 } };
    });
    assert.equal(longestStreakEver(record, "Nate"), 4);
  });

  test("is 0 for a player with no history", () => {
    assert.equal(longestStreakEver({}, "Nate"), 0);
  });
});

describe("dayWinner", () => {
  const players = ["Nate", "Thomas", "Michaela"];

  test("picks the highest score", () => {
    const day = {
      Nate: { score: 8, total: 10, timeSeconds: 90 },
      Thomas: { score: 9, total: 10, timeSeconds: 120 },
      Michaela: { score: 7, total: 10, timeSeconds: 60 },
    };
    assert.equal(dayWinner(day, players, true), "Thomas");
  });

  test("breaks a score tie on faster time", () => {
    const day = {
      Nate: { score: 9, total: 10, timeSeconds: 90 },
      Thomas: { score: 9, total: 10, timeSeconds: 60 },
    };
    assert.equal(dayWinner(day, ["Nate", "Thomas"], false), "Thomas");
  });

  test("requireFullRoster=true withholds a winner until everyone's played", () => {
    const day = { Nate: { score: 9, total: 10, timeSeconds: 90 } }; // Thomas & Michaela haven't played
    assert.equal(dayWinner(day, players, true), null);
  });

  test("requireFullRoster=false picks a winner from whoever played, partial roster is fine", () => {
    const day = { Nate: { score: 9, total: 10, timeSeconds: 90 } };
    assert.equal(dayWinner(day, players, false), "Nate");
  });

  test("returns null for an empty day regardless of requireFullRoster", () => {
    assert.equal(dayWinner({}, players, true), null);
    assert.equal(dayWinner({}, players, false), null);
  });
});

describe("countWins", () => {
  const players = ["Nate", "Thomas"];

  test("today requires full roster; past days don't", () => {
    const record = {
      // Past day: only Nate played, but it still counts since it's not "today".
      "2026-08-07": { Nate: { score: 9, total: 10, timeSeconds: 90 } },
      // Today: only Nate has played so far — shouldn't count yet.
      "2026-08-08": { Nate: { score: 10, total: 10, timeSeconds: 80 } },
    };
    const wins = countWins(record, players, "2026-08-08", () => true);
    assert.deepEqual(wins, { Nate: 1 }); // only the past day counted
  });

  test("counts multiple past days per player correctly", () => {
    const record = {
      "2026-08-05": { Nate: { score: 9, total: 10 }, Thomas: { score: 7, total: 10 } },
      "2026-08-06": { Nate: { score: 6, total: 10 }, Thomas: { score: 9, total: 10 } },
      "2026-08-07": { Nate: { score: 8, total: 10 }, Thomas: { score: 8, total: 10, timeSeconds: 50 } },
    };
    const recordWithTimes = {
      ...record,
      "2026-08-07": {
        Nate: { score: 8, total: 10, timeSeconds: 100 },
        Thomas: { score: 8, total: 10, timeSeconds: 50 },
      },
    };
    const wins = countWins(recordWithTimes, players, "2026-08-08", () => true);
    assert.deepEqual(wins, { Nate: 1, Thomas: 2 }); // Thomas wins the Aug 6 outright and the Aug 7 tiebreak
  });

  test("respects the date filter (e.g. scoping to one month)", () => {
    const record = {
      "2026-07-31": { Nate: { score: 9, total: 10 } },
      "2026-08-01": { Nate: { score: 9, total: 10 } },
    };
    const wins = countWins(record, players, "2026-08-08", (date) => monthKeyOf(date) === "2026-08");
    assert.deepEqual(wins, { Nate: 1 }); // July day excluded by the filter
  });
});

describe("aggregate", () => {
  test("sums score/questions/time across matching dates", () => {
    const record = {
      "2026-08-01": { Nate: { score: 8, total: 10, timeSeconds: 90 } },
      "2026-08-02": { Nate: { score: 6, total: 10, timeSeconds: 110 } },
    };
    const agg = aggregate(record, () => true);
    assert.deepEqual(agg.Nate, { totalScore: 14, totalQuestions: 20, games: 2, totalTime: 200, timedGames: 2 });
  });

  test("tolerates entries without a recorded time (older data)", () => {
    const record = {
      "2026-08-01": { Nate: { score: 8, total: 10 } }, // no timeSeconds field
    };
    const agg = aggregate(record, () => true);
    assert.equal(agg.Nate.timedGames, 0);
    assert.equal(agg.Nate.totalTime, 0);
  });
});

describe("isExcludedCategory", () => {
  test("exact match", () => {
    assert.equal(isExcludedCategory("Sports", ["sports"]), true);
  });

  test("is case-insensitive", () => {
    assert.equal(isExcludedCategory("SPORTS", ["sports"]), true);
  });

  test("substring match excludes a whole subcategory family", () => {
    assert.equal(isExcludedCategory("Entertainment: Video Games", ["entertainment"]), true);
    assert.equal(isExcludedCategory("Entertainment: Film", ["entertainment"]), true);
  });

  test("doesn't over-match unrelated categories", () => {
    assert.equal(isExcludedCategory("Science: Mathematics", ["sports"]), false);
    assert.equal(isExcludedCategory("General Knowledge", ["entertainment", "sports"]), false);
  });
});
