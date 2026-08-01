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
  quizAnswers: [],        // {category, difficulty, correct}
};

function todayKey() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function monthKeyOf(dateStr) {
  return dateStr.slice(0, 7); // "YYYY-MM"
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

function renderPlayerGrid() {
  const grid = document.getElementById("player-grid");
  grid.innerHTML = "";
  state.players.forEach((name) => {
    const btn = document.createElement("button");
    btn.className = "player-card";
    btn.innerHTML = `${name}${hasPlayedToday(name) ? '<span class="played-badge">&#10003;</span>' : ""}`;
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

  await ensureTodayQuestions();
  renderLineup();
  showScreen("screen-lineup");
}

// ============================================
// Today's questions (fetch once, cache in JSONBin)
// ============================================

async function ensureTodayQuestions() {
  if (state.questions.length) return;

  const questionsRecord = await jsonbinGetOrEmpty(CONFIG.QUESTIONS_BIN_ID);
  const cached = questionsRecord[state.today];

  if (cached && Array.isArray(cached.questions) && cached.questions.length === 10) {
    state.questions = cached.questions;
    return;
  }

  const questions = await fetchDailyQuestions();
  state.questions = questions;

  questionsRecord[state.today] = { questions, fetchedAt: new Date().toISOString() };
  try {
    await jsonbinPut(CONFIG.QUESTIONS_BIN_ID, questionsRecord);
  } catch (e) {
    console.warn("Couldn't cache today's questions (still playable locally):", e);
  }
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
  renderQuizQuestion();
});

// ============================================
// Quiz screen
// ============================================

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
    btn.addEventListener("click", () => handleAnswer(choice, btn));
    choicesEl.appendChild(btn);
  });
}

function handleAnswer(choice, btnEl) {
  const q = state.questions[state.quizIndex];
  const isCorrect = choice === q.correctAnswer;

  document.querySelectorAll(".choice-btn").forEach((b) => {
    b.disabled = true;
    if (b.textContent === q.correctAnswer) b.classList.add("correct");
    else if (b === btnEl) b.classList.add("wrong");
  });

  state.quizAnswers.push({ category: q.category, difficulty: q.difficulty, correct: isCorrect });

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
  const score = state.quizAnswers.filter((a) => a.correct).length;
  const entry = {
    score,
    total: state.quizAnswers.length,
    answers: state.quizAnswers,
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
  // player -> { totalScore, totalQuestions, games }
  const agg = {};
  Object.entries(state.scoresRecord).forEach(([date, dayScores]) => {
    if (!dateFilterFn(date)) return;
    Object.entries(dayScores).forEach(([player, entry]) => {
      if (!agg[player]) agg[player] = { totalScore: 0, totalQuestions: 0, games: 0 };
      agg[player].totalScore += entry.score;
      agg[player].totalQuestions += entry.total;
      agg[player].games += 1;
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

function renderLeaderboard(tab) {
  const body = document.getElementById("leaderboard-body");

  if (tab === "daily") {
    const today = state.scoresRecord[state.today] || {};
    const rows = Object.entries(today)
      .map(([name, entry]) => ({ name, score: entry.score, total: entry.total }))
      .sort((a, b) => b.score - a.score);
    body.innerHTML = renderTable(rows, [
      { label: "Player", render: (r) => r.name },
      { label: "Score", numeric: true, render: (r) => `${r.score}/${r.total}` },
    ]);
    return;
  }

  if (tab === "alltime" || tab === "monthly") {
    const filter =
      tab === "alltime" ? () => true : (date) => monthKeyOf(date) === monthKeyOf(state.today);
    const agg = aggregate(filter);
    const rows = Object.entries(agg)
      .map(([name, a]) => ({
        name,
        totalScore: a.totalScore,
        totalQuestions: a.totalQuestions,
        games: a.games,
        avg: a.totalQuestions ? Math.round((a.totalScore / a.totalQuestions) * 100) : 0,
      }))
      .sort((a, b) => b.totalScore - a.totalScore);
    body.innerHTML = renderTable(rows, [
      { label: "Player", render: (r) => r.name },
      { label: "Games", render: (r) => r.games },
      { label: "Avg", render: (r) => `${r.avg}%` },
      { label: "Total", numeric: true, render: (r) => r.totalScore },
    ]);
    return;
  }

  if (tab === "categories") {
    // category -> player -> {correct, total}
    const catMap = {};
    Object.values(state.scoresRecord).forEach((dayScores) => {
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
        (r) => `<tr><td>${r.category}</td><td>${r.leader.name}</td><td class="score">${r.leader.correct}/${r.leader.total}</td></tr>`
      )
      .join("");
    body.innerHTML = `<table class="lb-table"><thead><tr><th>Category</th><th>Leader</th><th>Record</th></tr></thead><tbody>${rowsHtml}</tbody></table>`;
  }
}

boot();
