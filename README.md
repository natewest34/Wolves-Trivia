# Daily Trivia

A daily 10-question trivia game for your group, powered by [Open Trivia DB](https://opentdb.com)
(free, no key) and [JSONBin.io](https://jsonbin.io) for shared scores.

Everyone gets the same 10 questions each day. A scheduled **GitHub Action** fetches and
caches that day's questions in JSONBin overnight — the site itself never fetches from
OpenTDB directly, it just reads whatever's been cached. If the Action hasn't run yet (or
fails), players see a "hang tight" screen instead of a broken quiz.

## 1. Create your JSONBin account & bins

1. Sign up free at https://jsonbin.io
2. Go to **API Keys** and copy your **X-Master-Key**
3. Create three bins (Dashboard → Create Bin). Content of each can just be `{}` to start:
   - **Questions bin** — today's (and past days') question sets, filled in by the GitHub Action
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

1. Create a new GitHub repo (must be **public** for free GitHub Pages)
2. Push all these files to it, including the `.github/workflows/` and `scripts/` folders
3. In the repo: **Settings → Pages → Source**, pick your main branch and `/` (root)
4. Your site will be live at `https://<your-username>.github.io/<repo-name>/`

## 4. Set up the daily question fetch (GitHub Action)

The Action needs its own copy of your JSONBin credentials, stored as **repo secrets**
(not committed to the code, unlike `config.js`):

1. In the repo: **Settings → Secrets and variables → Actions → New repository secret**
2. Add two secrets:
   - `JSONBIN_API_KEY` — same X-Master-Key as in `config.js`
   - `QUESTIONS_BIN_ID` — same questions bin ID as in `config.js`
3. That's it — `.github/workflows/daily-questions.yml` runs automatically at 06:00 UTC
   each day (≈midnight Central), and caches 10 fresh questions if today's slot is empty

**To test it without waiting for the schedule:** go to the repo's **Actions** tab →
"Fetch Daily Trivia Questions" → **Run workflow**. Check the run's logs to confirm it
worked, and check your questions bin in JSONBin's dashboard for today's entry.

**If a scheduled run fails** (OpenTDB hiccup, etc.), players will just see the "hang
tight" screen until it's fixed — re-run the workflow manually from the Actions tab the
same way.

## Notes / known limitations (v1)

- **Your JSONBin `X-Master-Key` is visible in the page source.** Fine for a small trusted
  friend group, but it does mean anyone with the link *could* poke at your bins directly if
  they wanted to. Not worth over-engineering for now — flag it if that ever feels risky.
- **Question source**: Open Trivia DB, used under Creative Commons Attribution-ShareAlike —
  there's a lightweight understanding here that OpenTDB is credited (feel free to add a
  small footer credit line if you want to be extra safe on attribution).
- **Difficulty mix**: 3 easy / 4 medium / 3 hard by default. This is set in *two* places
  that need to stay in sync — `config.js` (`DIFFICULTY_MIX`, for reference) and
  `scripts/fetch-daily-questions.mjs` (`DIFFICULTY_MIX`, what actually runs). Change both
  if you adjust it.
- **Timezone**: the Action computes "today" using `GROUP_TIMEZONE` in
  `scripts/fetch-daily-questions.mjs` (currently `America/Chicago`). This must match the
  timezone your players are actually in — the client always uses each player's local
  device time, so if the Action computes a different calendar date than a player's phone
  does, that player's "today" won't find a cached question set. Change `GROUP_TIMEZONE`
  if your group isn't in US Central.
- **Repeat avoidance**: relies on OpenTDB's session token system, requested fresh each run
  by the Action — good enough for now, not a strict guarantee across days. Revisit if
  repeats start showing up often.
- **Next step, in ~a month**: swap `scripts/fetch-daily-questions.mjs`'s OpenTDB call for a
  Claude-generated question set instead — nothing else in the app needs to change, since
  `app.js` just expects an array of `{ category, difficulty, question, choices, correctAnswer }`
  objects in the questions bin, however they got there.

