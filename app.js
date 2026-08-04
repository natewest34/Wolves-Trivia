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

function todayKey() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function monthKeyOf(dateStr) {
  return dateStr.slice(0, 7); // "YYYY-MM"
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Only ever iterate real "YYYY-MM-DD" entries in the scores record — bins are seeded
// with a placeholder key (e.g. "_init") to satisfy JSONBin's "can't be empty" check,
// and that placeholder must never be treated as a day of scores.
function dateEntries(scoresRecord) {
  return Object.entries(scoresRecord).filter(([key]) => DATE_KEY_RE.test(key));
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

// Returns the winning player's name for a given day's score object.
// requireFullRoster=true (used for "today", still in progress) means nobody gets
// crowned until every current player has submitted — that's the deliberate suspense
// on the Today tab. For any day already in the past, that requirement doesn't apply:
// the winner is just whoever did best among whoever actually played that day. Since
// this recalculates fresh every time the leaderboard renders, a day that finishes
// partially-played (or wraps to the next day before everyone's played) automatically
// gets its winner counted the next time anyone looks — no separate "finalize" step needed.
function dayWinner(dayScores, requireFullRoster) {
  const participants = Object.keys(dayScores);
  if (!participants.length) return null;
  if (requireFullRoster && !state.players.every((p) => dayScores[p])) return null;

  const sorted = Object.entries(dayScores).sort((a, b) => {
    if (b[1].score !== a[1].score) return b[1].score - a[1].score;
    const aTime = a[1].timeSeconds ?? Infinity;
    const bTime = b[1].timeSeconds ?? Infinity;
    return aTime - bTime;
  });
  return sorted[0][0];
}

function getTodayWinner() {
  return dayWinner(state.scoresRecord[state.today] || {}, true);
}

// player -> number of days won, within the given date filter
function countWins(dateFilterFn) {
  const wins = {};
  dateEntries(state.scoresRecord).forEach(([date, dayScores]) => {
    if (!dateFilterFn(date)) return;
    const isToday = date === state.today;
    const winner = dayWinner(dayScores, isToday); // full roster required only for the live day
    if (winner) wins[winner] = (wins[winner] || 0) + 1;
  });
  return wins;
}

function renderPlayerGrid() {
  const grid = document.getElementById("player-grid");
  grid.innerHTML = "";
  const winner = getTodayWinner();
  state.players.forEach((name) => {
    const btn = document.createElement("button");
    btn.className = "player-card";
    const badge = hasPlayedToday(name) ? '<span class="played-badge">&#10003;</span>' : "";
    const trophy = name === winner ? '<span class="trophy" title="Today\'s winner">🏆</span>' : "";
    btn.innerHTML = `${name}${trophy}${badge}`;
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

async function selectPlayer(name) {
  state.currentPlayer = name;

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

  if (!state.scoresRecord[state.today]) state.scoresRecord[state.today] = {};
  state.scoresRecord[state.today][state.currentPlayer] = entry;

  try {
    await jsonbinPut(CONFIG.SCORES_BIN_ID, state.scoresRecord);
  } catch (e) {
    console.error(e);
    showToast("Score saved locally, but couldn't sync — check your JSONBin setup.");
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

document.getElementById("back-to-players-btn").addEventListener("click", () => {
  renderPlayerGrid();
  showScreen("screen-players");
});

function aggregate(dateFilterFn) {
  // player -> { totalScore, totalQuestions, games, totalTime, timedGames }
  const agg = {};
  dateEntries(state.scoresRecord).forEach(([date, dayScores]) => {
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
    body.innerHTML = `<p class="empty-state">No scores yet — check back after today's board fills up.</p>`;
    return;
  }

  const winnerName = getTodayWinner();

  const rowsHtml = rows
    .map(({ name, entry }, i) => {
      const isMe = name === state.currentPlayer;
      const isWinner = name === winnerName;
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
          <td><span class="lb-caret" data-caret="${i}">&#9656;</span>${name}${isWinner ? '<span class="trophy" title="Today\'s winner">🏆</span>' : ""}</td>
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
    <table class="lb-table">
      <thead><tr><th></th><th>Player</th><th>Score</th><th>Time</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;

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

  if (state.scoresRecord[state.today]) {
    delete state.scoresRecord[state.today][name];
  }

  try {
    await jsonbinPut(CONFIG.SCORES_BIN_ID, state.scoresRecord);
    showToast(`${name}'s attempt was reset.`);
  } catch (e) {
    console.error(e);
    showToast("Reset locally, but couldn't sync — check your JSONBin setup.");
  }

  renderDailyLeaderboard(document.getElementById("leaderboard-body"));
  if (state.currentPlayer) renderPlayerGrid();
}

function renderTrophyLeaderboard(body) {
  // ---- All-time leader ----
  const allAgg = aggregate(() => true);
  const allWins = countWins(() => true);
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
        const agg = aggregate(filter);
        const wins = countWins(filter);
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

  if (tab === "alltime" || tab === "monthly") {
    const filter =
      tab === "alltime" ? () => true : (date) => monthKeyOf(date) === monthKeyOf(state.today);
    const agg = aggregate(filter);
    const wins = countWins(filter);

    const rows = Object.entries(agg)
      .map(([name, a]) => ({
        name,
        games: a.games,
        avgScore: a.games ? a.totalScore / a.games : 0,
        avgTotal: a.games ? a.totalQuestions / a.games : 0,
        avgTime: a.timedGames ? Math.round(a.totalTime / a.timedGames) : null,
        wins: wins[name] || 0,
      }))
      .sort((a, b) => b.avgScore - a.avgScore || b.wins - a.wins);

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
