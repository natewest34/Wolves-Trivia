// ============================================
// App state & screen flow
// ============================================

const state = {
  today: null,          // "YYYY-MM-DD"
  players: [],
  currentPlayer: null,
  questions: [],         // today's 10 questions
  scoresRecord: {},      // full scores bin (all dates)
  quizIndex: 0,
  quizAnswers: [],        // {category, difficulty, correct, question, chosenAnswer, correctAnswer}
  quizStartTime: null,
  questionTimerInterval: null,
  questionSecondsLeft: 20,
};

// dateKeyOf, monthKeyOf, dateEntries, playedOn, currentStreak, longestStreakEver,
// dayWinner, aggregate, and countWins now live in lib/trivia-core.js (loaded before
// this file, see index.html) — they're plain globals there, same as they were here,
// just shared with the Node test suite and the GitHub Action script too.

function todayKey() {
  return dateKeyOf(new Date());
}

function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 2500);
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

// Input-modality tracking for focus rings: some browsers (Firefox in particular)
// treat a mouse click on a <button> as deserving a visible focus ring, since keyboard
// Enter/Space also technically "clicks" it and the browser can't fully tell the two
// apart. Rather than rely on each browser's :focus-visible guess, track real input
// directly — outline shows only when the last interaction was actually a keyboard Tab.
document.addEventListener("mousedown", () => document.body.classList.add("using-mouse"));
document.addEventListener("keydown", (e) => {
  if (e.key === "Tab") document.body.classList.remove("using-mouse");
});

// ============================================
// Boot
// ============================================

async function boot() {
  state.today = todayKey();
  document.getElementById("today-date").textContent = new Date().toLocaleDateString(
    undefined,
    { weekday: "short", month: "short", day: "numeric" }
  );

  const [playersRecord, scoresRecord] = await Promise.all([
    jsonbinGetOrEmpty(CONFIG.PLAYERS_BIN_ID),
    jsonbinGetOrEmpty(CONFIG.SCORES_BIN_ID),
  ]);

  const savedPlayers = Array.isArray(playersRecord.players) ? playersRecord.players : [];
  state.players = Array.from(new Set([...CONFIG.PLAYERS, ...savedPlayers]));
  state.scoresRecord = scoresRecord;

  renderPlayerGrid();
  showScreen("screen-players");
}

// ============================================
// Player select screen
// ============================================

function hasPlayedToday(name) {
  return !!(state.scoresRecord[state.today] && state.scoresRecord[state.today][name]);
}

// dayWinner and countWins now live in lib/trivia-core.js as globals. getTodayWinner
// stays here as a small app-specific convenience wrapper.
function getTodayWinner() {
  return dayWinner(state.scoresRecord[state.today] || {}, state.players, true);
}

function renderPlayerGrid() {
  const grid = document.getElementById("player-grid");
  grid.innerHTML = "";
  const winner = getTodayWinner();
  state.players.forEach((name) => {
    const btn = document.createElement("button");
    btn.className = "player-card";
    const played = hasPlayedToday(name);
    const isWinner = name === winner;
    const streak = currentStreak(state.scoresRecord, state.today, name);

    const badge = played ? '<span class="played-badge" aria-hidden="true">&#10003;</span>' : "";
    const trophy = isWinner ? '<span class="trophy" aria-hidden="true">🏆</span>' : "";
    const streakBadge =
      streak >= 2 ? `<br><span class="streak-badge" aria-hidden="true">🔥${streak}</span>` : "";
    btn.innerHTML = `${name}${trophy}${badge}${streakBadge}`;

    const labelParts = [name];
    if (isWinner) labelParts.push("today's winner");
    if (played) labelParts.push("already played today");
    if (streak >= 2) labelParts.push(`${streak}-day streak`);
    btn.setAttribute("aria-label", labelParts.join(", "));

    btn.addEventListener("click", () => selectPlayer(name));
    grid.appendChild(btn);
  });
}

document.getElementById("add-player-btn").addEventListener("click", async () => {
  const name = prompt("Add a player (first name is fine):");
  if (!name) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  if (state.players.some((p) => p.toLowerCase() === trimmed.toLowerCase())) {
    showToast(`${trimmed} is already in the group.`);
    return;
  }
  state.players.push(trimmed);
  renderPlayerGrid();
  try {
    await jsonbinPut(CONFIG.PLAYERS_BIN_ID, { players: state.players });
    showToast(`${trimmed} added.`);
  } catch (e) {
    console.error(e);
    showToast("Couldn't save the new player — check your JSONBin setup.");
  }
});

async function refreshScoresRecord() {
  try {
    state.scoresRecord = await jsonbinGetOrEmpty(CONFIG.SCORES_BIN_ID);
  } catch (e) {
    console.warn("Couldn't refresh scores from JSONBin — showing last-known data.", e);
  }
}

async function selectPlayer(name) {
  state.currentPlayer = name;
  await refreshScoresRecord(); // don't decide played/not-played or render a leaderboard off a stale in-memory snapshot

  if (hasPlayedToday(name)) {
    renderLeaderboard("daily");
    document.getElementById("leaderboard-player-label").textContent = `Nice run, ${name}. Here's today's board.`;
    showScreen("screen-leaderboard");
    return;
  }

  showScreen("screen-loading");
  const ready = await ensureTodayQuestions();
  if (!ready) {
    showScreen("screen-not-ready");
    return;
  }
  renderLineup();
  showScreen("screen-lineup");
}

document.getElementById("retry-questions-btn").addEventListener("click", () => selectPlayer(state.currentPlayer));
document.getElementById("not-ready-back-btn").addEventListener("click", () => {
  renderPlayerGrid();
  showScreen("screen-players");
});

// ============================================
// Today's questions — read-only from the client's perspective.
// A GitHub Action (see .github/workflows/daily-questions.yml) fetches and caches
// each day's 10 questions on a schedule. If they're not there yet (Action hasn't
// run, or failed), play is blocked rather than trying to fetch live in the browser.
// ============================================

async function ensureTodayQuestions() {
  if (state.questions.length) return true;

  let questionsRecord;
  try {
    questionsRecord = await jsonbinGetOrEmpty(CONFIG.QUESTIONS_BIN_ID);
  } catch (e) {
    console.error("Couldn't reach JSONBin to check today's questions:", e);
    return false;
  }

  const cached = questionsRecord[state.today];
  if (cached && Array.isArray(cached.questions) && cached.questions.length === 10) {
    state.questions = cached.questions;
    return true;
  }
  return false; // GitHub Action hasn't published today's set yet (or it failed) — block play
}

// ============================================
// Lineup screen
// ============================================

function renderLineup() {
  document.getElementById("lineup-player-label").textContent = `${state.currentPlayer}, here's what's coming up:`;
  const ticker = document.getElementById("lineup-ticker");
  ticker.innerHTML = "";
  state.questions.forEach((q, i) => {
    const chip = document.createElement("span");
    chip.className = "lineup-chip";
    chip.innerHTML = `<span class="num">${i + 1}</span>${q.category}`;
    ticker.appendChild(chip);
  });
}

document.getElementById("start-quiz-btn").addEventListener("click", () => {
  state.quizIndex = 0;
  state.quizAnswers = [];
  showScreen("screen-quiz");
  startOverallTimer();
  renderQuizQuestion();
});

// ============================================
// Quiz screen
// ============================================

const QUESTION_SECONDS = 20;

// Overall run timer — deliberately NOT shown anywhere in the UI. It only exists
// to record how long a player took, for tiebreaking on the daily leaderboard.
function startOverallTimer() {
  state.quizStartTime = Date.now();
}

function stopOverallTimer() {
  return Math.round((Date.now() - state.quizStartTime) / 1000);
}

// Per-question countdown — this IS shown, and auto-submits a "no answer" once it hits 0
// so people can't stall on a question to go look the answer up.
function startQuestionTimer() {
  clearQuestionTimer();
  state.questionSecondsLeft = QUESTION_SECONDS;
  updateQuestionTimerDisplay();
  state.questionTimerInterval = setInterval(() => {
    state.questionSecondsLeft -= 1;
    updateQuestionTimerDisplay();
    if (state.questionSecondsLeft <= 0) {
      clearQuestionTimer();
      resolveQuestion(null, null); // time's up, no answer selected
    }
  }, 1000);
}

function clearQuestionTimer() {
  clearInterval(state.questionTimerInterval);
}

function updateQuestionTimerDisplay() {
  const el = document.getElementById("quiz-timer");
  el.textContent = String(Math.max(state.questionSecondsLeft, 0));
  el.classList.toggle("warning", state.questionSecondsLeft <= 3);
}

function renderQuizQuestion() {
  const q = state.questions[state.quizIndex];
  document.getElementById("quiz-progress").textContent = `${state.quizIndex + 1} / ${state.questions.length}`;
  document.getElementById("quiz-category").textContent = `${q.category} · ${q.difficulty}`;
  document.getElementById("quiz-question").textContent = q.question;

  const choicesEl = document.getElementById("quiz-choices");
  choicesEl.innerHTML = "";
  q.choices.forEach((choice) => {
    const btn = document.createElement("button");
    btn.className = "choice-btn";
    btn.textContent = choice;
    btn.addEventListener("click", () => resolveQuestion(choice, btn));
    choicesEl.appendChild(btn);
  });

  startQuestionTimer();
}

// choice is null when the 10-second timer expired with nothing selected.
function resolveQuestion(choice, btnEl) {
  clearQuestionTimer();
  const q = state.questions[state.quizIndex];
  const isCorrect = choice !== null && choice === q.correctAnswer;

  document.querySelectorAll(".choice-btn").forEach((b) => {
    b.disabled = true;
    if (b.textContent === q.correctAnswer) b.classList.add("correct");
    else if (btnEl && b === btnEl) b.classList.add("wrong");
  });
  if (btnEl) btnEl.blur(); // some browsers keep a focus ring lit after a mouse click; drop it explicitly

  state.quizAnswers.push({
    category: q.category,
    difficulty: q.difficulty,
    correct: isCorrect,
    question: q.question,
    chosenAnswer: choice === null ? "(no answer — time ran out)" : choice,
    correctAnswer: q.correctAnswer,
  });

  setTimeout(() => {
    state.quizIndex += 1;
    if (state.quizIndex < state.questions.length) {
      renderQuizQuestion();
    } else {
      finishQuiz();
    }
  }, 1100);
}

// Applies a change to the scores bin safely: fetches a FRESH copy right before
// writing (not whatever was in memory from page load, which could be hours stale),
// applies the mutation to that fresh copy, writes it back, and updates local state
// to match. This is what prevents one person's write from silently erasing someone
// else's more recent score — see the "scores disappearing" bug this replaced.
async function mutateScores(mutatorFn) {
  const fresh = await jsonbinGetOrEmpty(CONFIG.SCORES_BIN_ID);
  mutatorFn(fresh);
  await jsonbinPut(CONFIG.SCORES_BIN_ID, fresh);
  state.scoresRecord = fresh;
}

async function finishQuiz() {
  const timeSeconds = stopOverallTimer();
  const score = state.quizAnswers.filter((a) => a.correct).length;
  const entry = {
    score,
    total: state.quizAnswers.length,
    answers: state.quizAnswers,
    timeSeconds,
    submittedAt: new Date().toISOString(),
  };

  try {
    await mutateScores((fresh) => {
      if (!fresh[state.today]) fresh[state.today] = {};
      fresh[state.today][state.currentPlayer] = entry;
    });
  } catch (e) {
    console.error(e);
    showToast("Couldn't sync your score — check your connection and try again.");
    // Fall back to updating local state so this session's UI still works,
    // but this player's score won't be visible to others until a retry succeeds.
    if (!state.scoresRecord[state.today]) state.scoresRecord[state.today] = {};
    state.scoresRecord[state.today][state.currentPlayer] = entry;
  }

  document.getElementById("leaderboard-player-label").textContent =
    `${state.currentPlayer} scored ${score}/${entry.total} today.`;
  renderLeaderboard("daily");
  showScreen("screen-leaderboard");
}

// ============================================
// Leaderboard screen
// ============================================

document.getElementById("leaderboard-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (!btn) return;
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  renderLeaderboard(btn.dataset.tab);
});

document.getElementById("back-to-players-btn").addEventListener("click", async () => {
  await refreshScoresRecord();
  renderPlayerGrid();
  showScreen("screen-players");
});

// aggregate() now lives in lib/trivia-core.js as a global.

function renderTable(rows, columns) {
  if (!rows.length) {
    return `<p class="empty-state">No scores yet — check back after today's board fills up.</p>`;
  }
  const head = columns.map((c) => `<th>${c.label}</th>`).join("");
  const body = rows
    .map((row, i) => {
      const isMe = row.name === state.currentPlayer;
      const cells = columns
        .map((c) => `<td class="${c.numeric ? "score" : ""}">${c.render(row)}</td>`)
        .join("");
      return `<tr class="${isMe ? "me" : ""}"><td class="lb-rank">${i + 1}</td>${cells}</tr>`;
    })
    .join("");
  return `<table class="lb-table"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function formatTime(seconds) {
  if (seconds == null) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

// Wires up a "Refresh" button rendered inside the Today tab — re-fetches scores
// from JSONBin and re-renders, for when someone wants to see if anyone new has
// played without waiting on the periodic re-fetches that happen at other nav points.
function wireRefreshButton(body) {
  const btn = body.querySelector("#refresh-today-btn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Refreshing…";
    await refreshScoresRecord();
    renderDailyLeaderboard(document.getElementById("leaderboard-body"));
  });
}

function renderDailyLeaderboard(body) {
  const today = state.scoresRecord[state.today] || {};
  const rows = Object.entries(today)
    .map(([name, entry]) => ({ name, entry }))
    // score desc, then time asc (faster wins ties) as the tiebreaker
    .sort((a, b) => {
      if (b.entry.score !== a.entry.score) return b.entry.score - a.entry.score;
      const aTime = a.entry.timeSeconds ?? Infinity;
      const bTime = b.entry.timeSeconds ?? Infinity;
      return aTime - bTime;
    });

  if (!rows.length) {
    body.innerHTML = `
      <button id="refresh-today-btn" class="link-btn">&#8635; Refresh</button>
      <p class="empty-state">No scores yet — check back after today's board fills up.</p>`;
    wireRefreshButton(body);
    return;
  }

  const winnerName = getTodayWinner();

  const rowsHtml = rows
    .map(({ name, entry }, i) => {
      const isMe = name === state.currentPlayer;
      const isWinner = name === winnerName;
      const isPerfect = entry.score === entry.total;
      const detailRows = (entry.answers || [])
        .map((a) => {
          if (!a.question) {
            // Entry saved before per-question detail was tracked — nothing to show.
            return `
            <div class="answer-detail-row">
              <span class="mark ${a.correct ? "correct" : "wrong"}">${a.correct ? "✓" : "✗"}</span>
              <span class="qtext">${a.category || "Question"} <span class="given">(played before answer detail was saved)</span></span>
            </div>`;
          }
          return `
          <div class="answer-detail-row">
            <span class="mark ${a.correct ? "correct" : "wrong"}">${a.correct ? "✓" : "✗"}</span>
            <span class="qtext">${a.question}
              ${a.correct ? "" : `<span class="given">Answered: ${a.chosenAnswer} · Correct: ${a.correctAnswer}</span>`}
            </span>
          </div>`;
        })
        .join("");

      return `
        <tr class="lb-row-clickable ${isMe ? "me" : ""}" data-row="${i}">
          <td class="lb-rank">${i + 1}</td>
          <td><span class="lb-caret" data-caret="${i}" aria-hidden="true">&#9656;</span>${name}${isWinner ? '<span class="trophy" aria-hidden="true" title="Today\'s winner">🏆</span>' : ""}${isPerfect ? '<span class="perfect-badge" aria-hidden="true" title="Perfect score!">💯</span>' : ""}</td>
          <td class="score">${entry.score}/${entry.total}</td>
          <td class="score">${formatTime(entry.timeSeconds)}</td>
        </tr>
        <tr class="detail-row hidden" data-detail="${i}">
          <td colspan="4">
            <div class="answer-detail">
              ${detailRows}
              <button class="reset-attempt-btn" data-reset="${name}">&#8634; Reset ${name}'s attempt for today</button>
            </div>
          </td>
        </tr>`;
    })
    .join("");

  body.innerHTML = `
    <button id="refresh-today-btn" class="link-btn">&#8635; Refresh</button>
    <table class="lb-table">
      <thead><tr><th></th><th>Player</th><th>Score</th><th>Time</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;

  wireRefreshButton(body);

  body.querySelectorAll("[data-row]").forEach((tr) => {
    tr.addEventListener("click", () => {
      const i = tr.dataset.row;
      const detail = body.querySelector(`[data-detail="${i}"]`);
      const caret = body.querySelector(`[data-caret="${i}"]`);
      detail.classList.toggle("hidden");
      caret.classList.toggle("open");
    });
  });

  body.querySelectorAll("[data-reset]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation(); // don't let this bubble up and re-toggle the row
      resetTodayAttempt(btn.dataset.reset);
    });
  });
}

// Clears a player's score for today so they can retake it — for when something
// went wrong (bad connection, misclick on the wrong name, etc).
async function resetTodayAttempt(name) {
  const confirmed = confirm(
    `Reset ${name}'s attempt for today? They'll be able to play again, and this can't be undone.`
  );
  if (!confirmed) return;

  try {
    await mutateScores((fresh) => {
      if (fresh[state.today]) delete fresh[state.today][name];
    });
    showToast(`${name}'s attempt was reset.`);
  } catch (e) {
    console.error(e);
    showToast("Couldn't reach JSONBin to reset — try again.");
    return; // don't touch local state if we're not sure the server-side reset actually happened
  }

  renderDailyLeaderboard(document.getElementById("leaderboard-body"));
  if (state.currentPlayer) renderPlayerGrid();
}

function renderTrophyLeaderboard(body) {
  // ---- All-time leader ----
  const allAgg = aggregate(state.scoresRecord, () => true);
  const allWins = countWins(state.scoresRecord, state.players, state.today, () => true);
  const champRows = Object.entries(allAgg)
    .map(([name, a]) => ({
      name,
      games: a.games,
      avgScore: a.games ? a.totalScore / a.games : 0,
      wins: allWins[name] || 0,
    }))
    .sort((a, b) => b.wins - a.wins || b.avgScore - a.avgScore);

  let champHtml = `<p class="empty-state">No games played yet.</p>`;
  if (champRows.length) {
    const c = champRows[0];
    const label = c.wins > 0 ? "Reigning Champion" : "Current Leader";
    champHtml = `
      <div class="trophy-champion">
        <div class="name">🏆 ${c.name}</div>
        <div class="meta">${label} · ${c.wins} daily win${c.wins === 1 ? "" : "s"} · ${c.avgScore.toFixed(1)} avg score · ${c.games} games played</div>
      </div>`;
  }

  // ---- Season (monthly) winners, most recent first ----
  const months = Array.from(new Set(dateEntries(state.scoresRecord).map(([date]) => monthKeyOf(date))))
    .sort()
    .reverse();

  let seasonsHtml = `<p class="empty-state">Season winners will show up once a month's worth of games are in.</p>`;
  if (months.length) {
    const rowsHtml = months
      .map((month) => {
        const filter = (date) => monthKeyOf(date) === month;
        const agg = aggregate(state.scoresRecord, filter);
        const wins = countWins(state.scoresRecord, state.players, state.today, filter);
        const rows = Object.entries(agg)
          .map(([name, a]) => ({
            name,
            avgScore: a.games ? a.totalScore / a.games : 0,
            wins: wins[name] || 0,
          }))
          .sort((a, b) => b.avgScore - a.avgScore || b.wins - a.wins);
        if (!rows.length) return "";

        const winner = rows[0];
        const label = new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, {
          month: "long",
          year: "numeric",
        });
        const isCurrent = month === monthKeyOf(state.today);
        return `<tr><td>${label}${isCurrent ? ' <span class="est-badge">in progress</span>' : ""}</td><td>${winner.name}</td><td class="score">${winner.avgScore.toFixed(1)} avg</td></tr>`;
      })
      .filter(Boolean)
      .join("");
    seasonsHtml = `<table class="lb-table"><thead><tr><th>Season</th><th>Winner</th><th>Avg Score</th></tr></thead><tbody>${rowsHtml}</tbody></table>`;
  }

  body.innerHTML = `
    <div class="trophy-block">
      <h3>All-Time</h3>
      ${champHtml}
    </div>
    <div class="trophy-block">
      <h3>Season Winners</h3>
      ${seasonsHtml}
    </div>`;
}

// Pulls together everything worth knowing about one player's history.
function personalStats(name) {
  const played = dateEntries(state.scoresRecord).filter(([, day]) => day[name]);

  let totalScore = 0;
  let totalQuestions = 0;
  let perfectDays = 0;
  let bestTime = null;
  const categoryTally = {}; // category -> {correct, total}

  played.forEach(([, day]) => {
    const entry = day[name];
    totalScore += entry.score;
    totalQuestions += entry.total;
    if (entry.score === entry.total) perfectDays += 1;
    if (typeof entry.timeSeconds === "number" && (bestTime === null || entry.timeSeconds < bestTime)) {
      bestTime = entry.timeSeconds;
    }
    (entry.answers || []).forEach((a) => {
      if (!categoryTally[a.category]) categoryTally[a.category] = { correct: 0, total: 0 };
      categoryTally[a.category].total += 1;
      if (a.correct) categoryTally[a.category].correct += 1;
    });
  });

  let best = null;
  let worst = null;
  Object.entries(categoryTally).forEach(([category, s]) => {
    if (s.total < 2) return; // need a couple data points before calling it a best/worst
    const acc = s.correct / s.total;
    if (!best || acc > best.acc) best = { category, acc };
    if (!worst || acc < worst.acc) worst = { category, acc };
  });

  const allTimeWins = countWins(state.scoresRecord, state.players, state.today, () => true)[name] || 0;

  return {
    games: played.length,
    avgScore: played.length ? totalScore / played.length : 0,
    avgTotal: played.length ? totalQuestions / played.length : 0,
    perfectDays,
    bestTime,
    currentStreak: currentStreak(state.scoresRecord, state.today, name),
    longestStreak: longestStreakEver(state.scoresRecord, name),
    wins: allTimeWins,
    best,
    worst,
  };
}

function renderMyStats(body) {
  const name = state.currentPlayer;
  if (!name) {
    body.innerHTML = `<p class="empty-state">Pick your name first to see your stats.</p>`;
    return;
  }

  const s = personalStats(name);

  if (!s.games) {
    body.innerHTML = `<p class="empty-state">Play a round to start building your stats, ${name}.</p>`;
    return;
  }

  const statCard = (label, value) => `
    <div class="stat-card">
      <div class="stat-value">${value}</div>
      <div class="stat-label">${label}</div>
    </div>`;

  const statsGrid = `
    <div class="stats-grid">
      ${statCard("Games Played", s.games)}
      ${statCard("Avg Score", `${s.avgScore.toFixed(1)}/${s.avgTotal.toFixed(0)}`)}
      ${statCard("Current Streak", `🔥 ${s.currentStreak}`)}
      ${statCard("Longest Streak", `🔥 ${s.longestStreak}`)}
      ${statCard("Perfect Days", `💯 ${s.perfectDays}`)}
      ${statCard("Daily Wins", `🏆 ${s.wins}`)}
      ${statCard("Best Time", formatTime(s.bestTime))}
    </div>`;

  const categoryHtml = `
    <div class="trophy-block">
      <h3>Best &amp; Worst Categories</h3>
      ${
        s.best
          ? `<p class="mystat-line">Strongest: <strong>${s.best.category}</strong> (${Math.round(s.best.acc * 100)}%)</p>`
          : ""
      }
      ${
        s.worst && s.worst.category !== s.best?.category
          ? `<p class="mystat-line">Room to grow: <strong>${s.worst.category}</strong> (${Math.round(s.worst.acc * 100)}%)</p>`
          : ""
      }
      ${!s.best ? `<p class="empty-state">Play a few more rounds to see your category breakdown.</p>` : ""}
    </div>`;

  body.innerHTML = `
    <div class="trophy-block">
      <h3>${name}'s Stats</h3>
      ${statsGrid}
    </div>
    ${categoryHtml}`;
}

function renderLeaderboard(tab) {
  const body = document.getElementById("leaderboard-body");

  if (tab === "daily") {
    renderDailyLeaderboard(body);
    return;
  }

  if (tab === "trophy") {
    renderTrophyLeaderboard(body);
    return;
  }

  if (tab === "mystats") {
    renderMyStats(body);
    return;
  }

  if (tab === "alltime" || tab === "monthly") {
    const filter =
      tab === "alltime" ? () => true : (date) => monthKeyOf(date) === monthKeyOf(state.today);
    const agg = aggregate(state.scoresRecord, filter);
    const wins = countWins(state.scoresRecord, state.players, state.today, filter);

    const rows = Object.entries(agg)
      .map(([name, a]) => ({
        name,
        games: a.games,
        avgScore: a.games ? a.totalScore / a.games : 0,
        avgTotal: a.games ? a.totalQuestions / a.games : 0,
        avgTime: a.timedGames ? Math.round(a.totalTime / a.timedGames) : null,
        wins: wins[name] || 0,
      }))
      .sort((a, b) => b.wins - a.wins || b.avgScore - a.avgScore);

    const seasonHeading =
      tab === "monthly"
        ? `<p class="season-label">Season: ${new Date(state.today + "T00:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" })}</p>`
        : "";

    body.innerHTML =
      seasonHeading +
      renderTable(rows, [
        { label: "Player", render: (r) => r.name },
        { label: "Games", render: (r) => r.games },
        { label: "Avg Score", numeric: true, render: (r) => `${r.avgScore.toFixed(1)}/${r.avgTotal.toFixed(0)}` },
        { label: "Avg Time", render: (r) => formatTime(r.avgTime) },
        { label: "Daily Wins", numeric: true, render: (r) => `${r.wins} 🏆` },
      ]);
    return;
  }

  if (tab === "categories") {
    // category -> player -> {correct, total}
    const catMap = {};
    dateEntries(state.scoresRecord).forEach(([, dayScores]) => {
      Object.entries(dayScores).forEach(([player, entry]) => {
        (entry.answers || []).forEach((a) => {
          if (!catMap[a.category]) catMap[a.category] = {};
          if (!catMap[a.category][player]) catMap[a.category][player] = { correct: 0, total: 0 };
          catMap[a.category][player].total += 1;
          if (a.correct) catMap[a.category][player].correct += 1;
        });
      });
    });

    const rows = Object.entries(catMap)
      .map(([category, players]) => {
        let leader = null;
        Object.entries(players).forEach(([name, s]) => {
          if (s.total < 2) return; // need a couple data points to call it
          const acc = s.correct / s.total;
          if (!leader || acc > leader.acc) leader = { name, acc, correct: s.correct, total: s.total };
        });
        return { category, leader };
      })
      .filter((r) => r.leader)
      .sort((a, b) => a.category.localeCompare(b.category));

    if (!rows.length) {
      body.innerHTML = `<p class="empty-state">Category leaders show up once a few days of scores are in.</p>`;
      return;
    }

    const rowsHtml = rows
      .map(
        (r) => `<tr><td>${r.category}</td><td>${r.leader.name}</td><td class="score">${Math.round(r.leader.acc * 100)}%</td></tr>`
      )
      .join("");
    body.innerHTML = `<table class="lb-table"><thead><tr><th>Category</th><th>Leader</th><th>Record</th></tr></thead><tbody>${rowsHtml}</tbody></table>`;
  }
}

boot();
