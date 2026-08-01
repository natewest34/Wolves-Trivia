// ============================================
// Open Trivia DB integration.
// Free, no key required: https://opentdb.com
// ============================================

const OPENTDB_TOKEN_KEY = "trivia_opentdb_token";

async function getSessionToken() {
  let token = localStorage.getItem(OPENTDB_TOKEN_KEY);
  if (token) return token;

  const res = await fetch("https://opentdb.com/api_token.php?command=request");
  const data = await res.json();
  token = data.token;
  localStorage.setItem(OPENTDB_TOKEN_KEY, token);
  return token;
}

function decodeHtml(str) {
  const el = document.createElement("textarea");
  el.innerHTML = str;
  return el.value;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// OpenTDB allows only 1 request per 5 seconds per IP (response_code 5 if you go over),
// so this must never be called concurrently with itself — always await one call before
// starting the next (see fetchDailyQuestions, which serializes calls with a gap).
async function fetchBatch(amount, difficulty, token, attempt = 0) {
  const url = new URL("https://opentdb.com/api.php");
  url.searchParams.set("amount", amount);
  if (difficulty) url.searchParams.set("difficulty", difficulty);
  url.searchParams.set("type", "multiple");
  url.searchParams.set("encode", "url3986");
  if (token) url.searchParams.set("token", token);

  const res = await fetch(url);
  const data = await res.json();

  // response_code 5 = rate limited; back off and retry.
  if (data.response_code === 5 && attempt < 3) {
    await sleep(5500);
    return fetchBatch(amount, difficulty, token, attempt + 1);
  }

  // response_code 4 = token has already served every question matching this filter; reset and retry once.
  if (data.response_code === 4 && token) {
    await sleep(5500);
    await fetch(`https://opentdb.com/api_token.php?command=reset&token=${token}`);
    await sleep(5500);
    return fetchBatch(amount, difficulty, token, attempt + 1);
  }

  // response_code 1 = not enough questions exist for this filter combo — just return what we got (may be empty);
  // fetchDailyQuestions tops up any shortfall afterward.
  return data.results || [];
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

// Pulls today's 10 questions: 3 easy / 4 medium / 3 hard (see CONFIG.DIFFICULTY_MIX),
// each difficulty batch pulled from a random mix of categories.
// IMPORTANT: these calls are made one at a time with a delay between them — OpenTDB
// rate-limits to 1 request/5s per IP, and firing them concurrently silently drops results.
async function fetchDailyQuestions() {
  const token = await getSessionToken();
  const mix = Object.entries(CONFIG.DIFFICULTY_MIX).filter(([, amount]) => amount > 0);

  const results = [];
  for (let i = 0; i < mix.length; i++) {
    const [difficulty, amount] = mix[i];
    if (i > 0) await sleep(5500);
    const batch = await fetchBatch(amount, difficulty, token);
    results.push(...batch);
  }

  const targetTotal = Object.values(CONFIG.DIFFICULTY_MIX).reduce((a, b) => a + b, 0);
  let shortfall = targetTotal - results.length;

  // Top up with an unfiltered pull if any difficulty came up short (small pool / rate-limit edge cases).
  while (shortfall > 0) {
    await sleep(5500);
    const topUp = await fetchBatch(shortfall, null, token);
    if (!topUp.length) break; // avoid an infinite loop if OpenTDB truly has nothing left
    results.push(...topUp);
    shortfall = targetTotal - results.length;
  }

  const all = results.map(normalizeQuestion);
  return shuffle(all);
}
