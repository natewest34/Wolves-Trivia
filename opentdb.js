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

async function fetchBatch(amount, difficulty, token) {
  const url = new URL("https://opentdb.com/api.php");
  url.searchParams.set("amount", amount);
  url.searchParams.set("difficulty", difficulty);
  url.searchParams.set("type", "multiple");
  url.searchParams.set("encode", "url3986");
  if (token) url.searchParams.set("token", token);

  const res = await fetch(url);
  const data = await res.json();

  // response_code 4 = token exhausted all questions for this filter; reset and retry once.
  if (data.response_code === 4 && token) {
    await fetch(`https://opentdb.com/api_token.php?command=reset&token=${token}`);
    const retry = await fetch(url);
    return (await retry.json()).results || [];
  }
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
async function fetchDailyQuestions() {
  const token = await getSessionToken();
  const mix = CONFIG.DIFFICULTY_MIX;

  const batches = await Promise.all(
    Object.entries(mix).map(([difficulty, amount]) =>
      amount > 0 ? fetchBatch(amount, difficulty, token) : Promise.resolve([])
    )
  );

  const all = batches.flat().map(normalizeQuestion);
  return shuffle(all);
}
