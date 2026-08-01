# Daily Trivia

A daily 10-question trivia game for your group, powered by [Open Trivia DB](https://opentdb.com)
(free, no key) and [JSONBin.io](https://jsonbin.io) for shared scores.

Everyone gets the same 10 questions each day (the first person to load the site that day
triggers the fetch; JSONBin caches it so everyone else gets the identical set). Pick your
name, play, and the board unlocks once you've submitted.

## 1. Create your JSONBin account & bins

1. Sign up free at https://jsonbin.io
2. Go to **API Keys** and copy your **X-Master-Key**
3. Create three bins (Dashboard → Create Bin). Content of each can just be `{}` to start:
   - **Questions bin** — caches each day's 10 questions
   - **Scores bin** — everyone's daily results
   - **Players bin** — the roster (starts from `config.js`, grows if people add themselves)
4. Copy each bin's ID (shown in the bin URL / dashboard)

## 2. Fill in `config.js`

Open `config.js` and paste in:

```js
JSONBIN_API_KEY: "your-x-master-key",
QUESTIONS_BIN_ID: "your-questions-bin-id",
SCORES_BIN_ID: "your-scores-bin-id",
PLAYERS_BIN_ID: "your-players-bin-id",
```

The starting player list is already set to Thomas, Tanner, Michaela, Jake, and Nathan —
edit the `PLAYERS` array if that needs to change.

## 3. Deploy to GitHub Pages

1. Create a new GitHub repo (public or private, either works with Pages)
2. Push these files to it (`index.html`, `style.css`, `app.js`, `config.js`,
   `jsonbin.js`, `opentdb.js`)
3. In the repo: **Settings → Pages → Source**, pick your main branch and `/` (root)
4. Your site will be live at `https://<your-username>.github.io/<repo-name>/`

That's it — no build step, no server. Share the link with the group.

## Notes / known limitations (v1)

- **Your JSONBin `X-Master-Key` is visible in the page source.** Fine for a small trusted
  friend group, but it does mean anyone with the link *could* poke at your bins directly if
  they wanted to. Not worth over-engineering for now — flag it if that ever feels risky.
- **Question source**: Open Trivia DB, used under Creative Commons Attribution-ShareAlike —
  there's a lightweight understanding here that OpenTDB is credited (feel free to add a
  small footer credit line if you want to be extra safe on attribution).
- **Difficulty mix**: 3 easy / 4 medium / 3 hard by default (`config.js` → `DIFFICULTY_MIX`),
  each pulled from a random spread of categories.
- **Repeat avoidance**: relies on OpenTDB's session token system (stored in the browser that
  happens to trigger each day's fetch). Good enough for now — once you're ready to swap in
  Claude-generated questions, that's where a proper history log would replace this.
- **Next step, in ~a month**: swap `opentdb.js`'s `fetchDailyQuestions()` for a call to a
  Claude-generated question set (via a small GitHub Action + the Claude API) without needing
  to touch anything else in the app — `app.js` just expects an array of
  `{ category, difficulty, question, choices, correctAnswer }` objects, however they're sourced.
