// ============================================
// Fetches today's 10 trivia questions from OpenTDB and caches them in JSONBin,
// so nobody's browser has to do this live when they tap their name.
//
// Run by .github/workflows/daily-questions.yml on a schedule. Can also be run
// manually: JSONBIN_API_KEY=... QUESTIONS_BIN_ID=... node scripts/fetch-daily-questions.mjs
// ============================================

import CONFIG from "../config.js";

const JSONBIN_API_KEY = process.env.JSONBIN_API_KEY;
const QUESTIONS_BIN_ID = process.env.QUESTIONS_BIN_ID;

// Difficulty mix and category exclusions both live in config.js now, so there's
// one place to edit rather than keeping this file in sync by hand.
const DIFFICULTY_MIX = CONFIG.DIFFICULTY_MIX;
const EXCLUDED_TERMS = (CONFIG.EXCLUDED_CATEGORIES || [])
  .map((c) => c.toLowerCase().trim())
  .filter(Boolean);

function isExcludedCategory(categoryName) {
  const lower = categoryName.toLowerCase();
  return EXCLUDED_TERMS.some((term) => lower.includes(term));
}

// The timezone your players are actually in. This determines what "today" means —
// it must match the local date the client computes in the browser (todayKey() in
// app.js uses the device's local time), or the cached key won't line up with what
// players look up. Adjust if your group isn't in US Central.
const GROUP_TIMEZONE = "America/Chicago";

const JSONBIN_BASE = "https://api.jsonbin.io/v3/b";

function todayKeyInTimezone(timeZone) {
  // en-CA locale formats as YYYY-MM-DD, which matches the client's todayKey() format.
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestSessionToken() {
  const res = await fetch("https://opentdb.com/api_token.php?command=request");
  const data = await res.json();
  return data.token;
}

async function fetchBatch(amount, difficulty, token, attempt = 0) {
  const url = new URL("https://opentdb.com/api.php");
  url.searchParams.set("amount", amount);
  if (difficulty) url.searchParams.set("difficulty", difficulty);
  url.searchParams.set("type", "multiple");
  url.searchParams.set("encode", "url3986");
  if (token) url.searchParams.set("token", token);

  const res = await fetch(url);
  const data = await res.json();

  if (data.response_code === 5 && attempt < 3) {
    // rate limited — back off and retry
    await sleep(5500);
    return fetchBatch(amount, difficulty, token, attempt + 1);
  }
  if (data.response_code === 4 && token) {
    // token exhausted every question for this filter — reset and retry once
    await sleep(5500);
    await fetch(`https://opentdb.com/api_token.php?command=reset&token=${token}`);
    await sleep(5500);
    return fetchBatch(amount, difficulty, token, attempt + 1);
  }
  return data.results || [];
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normalizeQuestion(raw) {
  const question = decodeURIComponent(raw.question);
  const correct = decodeURIComponent(raw.correct_answer);
  const incorrect = raw.incorrect_answers.map(decodeURIComponent);
  const choices = shuffle([correct, ...incorrect]);

  return {
    category: decodeURIComponent(raw.category),
    difficulty: raw.difficulty,
    question,
    choices,
    correctAnswer: correct,
  };
}

async function fetchDailyQuestions() {
  const token = await requestSessionToken();
  const mix = Object.entries(DIFFICULTY_MIX).filter(([, amount]) => amount > 0);
  const targetTotal = Object.values(DIFFICULTY_MIX).reduce((a, b) => a + b, 0);

  let excludedCount = 0;
  const excludedCategoriesSeen = new Set();
  const results = [];

  function addFiltered(rawBatch) {
    for (const raw of rawBatch) {
      const q = normalizeQuestion(raw);
      if (isExcludedCategory(q.category)) {
        excludedCount += 1;
        excludedCategoriesSeen.add(q.category);
      } else {
        results.push(q);
      }
    }
  }

  for (let i = 0; i < mix.length; i++) {
    const [difficulty, amount] = mix[i];
    if (i > 0) await sleep(5500);
    addFiltered(await fetchBatch(amount, difficulty, token));
  }

  // Top up for anything short of 10 — whether from OpenTDB running out for a
  // difficulty, or from questions we just filtered out for being an excluded category.
  // Capped so an overly broad exclusion list can't loop forever burning Action minutes.
  const MAX_TOPUP_ATTEMPTS = 8;
  let attempts = 0;
  while (results.length < targetTotal && attempts < MAX_TOPUP_ATTEMPTS) {
    attempts += 1;
    await sleep(5500);
    const shortfall = targetTotal - results.length;
    const topUp = await fetchBatch(Math.max(shortfall, 5), null, token); // ask for a few extra to absorb likely exclusions
    if (!topUp.length) break;
    addFiltered(topUp);
  }

  if (excludedCount) {
    console.log(
      `Filtered out ${excludedCount} question(s) from excluded categories: ${[...excludedCategoriesSeen].join(", ")}`
    );
  }

  if (results.length < targetTotal) {
    throw new Error(
      `Only got ${results.length}/${targetTotal} questions from OpenTDB after retries and category filtering — leaving today's slot empty rather than publishing a short set. (If EXCLUDED_CATEGORIES in config.js is very broad, this can happen — consider trimming it.)`
    );
  }

  // We may have collected a few more than targetTotal (from the "ask for extra" padding) — trim to exactly 10.
  return shuffle(results).slice(0, targetTotal);
}

async function jsonbinGetOrEmpty() {
  const res = await fetch(`${JSONBIN_BASE}/${QUESTIONS_BIN_ID}/latest`, {
    headers: { "X-Master-Key": JSONBIN_API_KEY },
  });
  if (!res.ok) throw new Error(`JSONBin GET failed: ${res.status}`);
  const body = await res.json();
  return body.record && typeof body.record === "object" ? body.record : {};
}

async function jsonbinPut(data) {
  const res = await fetch(`${JSONBIN_BASE}/${QUESTIONS_BIN_ID}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Master-Key": JSONBIN_API_KEY,
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`JSONBin PUT failed: ${res.status}`);
}

async function main() {
  if (!JSONBIN_API_KEY || !QUESTIONS_BIN_ID) {
    throw new Error("Missing JSONBIN_API_KEY or QUESTIONS_BIN_ID environment variables.");
  }

  const dateKey = todayKeyInTimezone(GROUP_TIMEZONE);
  console.log(`Preparing questions for ${dateKey} (${GROUP_TIMEZONE})...`);
  if (EXCLUDED_TERMS.length) {
    console.log(`Excluding categories matching: ${EXCLUDED_TERMS.join(", ")}`);
  }

  const questionsRecord = await jsonbinGetOrEmpty();
  const existing = questionsRecord[dateKey];
  if (existing && Array.isArray(existing.questions) && existing.questions.length === 10) {
    console.log(`Already have 10 questions cached for ${dateKey}. Nothing to do.`);
    return;
  }

  const questions = await fetchDailyQuestions();
  questionsRecord[dateKey] = { questions, fetchedAt: new Date().toISOString() };
  await jsonbinPut(questionsRecord);

  console.log(`Cached ${questions.length} questions for ${dateKey}.`);
}

main().catch((err) => {
  console.error("Failed to prepare today's questions:", err);
  process.exit(1);
});
