# This batch of additions — setup & what changed

This covers everything from the "performance/quality/reliability" round: nightly
backups, retry logic, a test suite + CI, an accessibility pass, and Add to Home
Screen support. Most of it needs zero setup — two things do need your action,
both marked clearly below.

---

## ⚠️ Needs your action: nightly backup

The backup workflow needs a **new repo secret** and a **permissions setting** —
without both, it'll fail silently on schedule until you notice.

### 1. Add a `SCORES_BIN_ID` secret

You likely already have `JSONBIN_API_KEY` and `QUESTIONS_BIN_ID` set up from
before. Add one more:

Repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**
- `SCORES_BIN_ID` — your scores bin's ID (same one in `config.js`)

### 2. Allow Actions to write back to the repo

By default, GitHub Actions often only has **read** access to your repo, which
would make every backup run fail at the "commit" step.

Repo → **Settings** → **Actions** → **General** → scroll to **Workflow permissions**
→ select **"Read and write permissions"** → **Save**

### What it does once set up

Every night, `.github/workflows/backup-scores.yml` pulls your scores bin and
commits it into the repo under `backups/`:
- `backups/scores-latest.json` — always the most recent snapshot, easiest to restore from
- `backups/scores-YYYY-MM-DD.json` — a dated copy for each day, so you can look back

**To restore from a backup** (if JSONBin ever loses your data): open the relevant
file in `backups/`, copy its contents, and paste them into your scores bin via
JSONBin's dashboard (or a PUT request) to overwrite the live bin.

**To test it without waiting for the schedule:** Actions tab → "Backup Scores" →
**Run workflow**.

---

## No setup needed — just deploy

### Add to Home Screen (PWA)

`manifest.json`, `sw.js`, and `icons/` are new. Once deployed, anyone in your
group can open the site on their phone and use their browser's "Add to Home
Screen" option — it'll show up with a real icon and open full-screen, without
the browser's address bar.

One deliberate choice worth knowing: the service worker is **network-first, not
cache-first**. It only ever serves a cached file if the network request actually
fails (no signal). This was intentional — a cache-first worker risks someone
getting stuck on an old, already-fixed version of the site, which would've been
a bad tradeoff given how many live bug fixes this app has already been through.
If you ever want to force a hard refresh of the offline fallback cache, bump the
`CACHE_NAME` version string at the top of `sw.js`.

### Retry logic

`jsonbin.js` now retries transient failures (a dropped connection, a JSONBin 5xx,
rate limiting) a couple of times with backoff before giving up. It does **not**
retry real errors like a wrong API key — those fail immediately rather than
wasting time on a retry that can't succeed.

### Accessibility pass

Small, targeted changes: toast messages and new quiz questions now announce to
screen readers, the fast-ticking countdown number is marked decorative (so it's
not read aloud every second, which is worse than not reading it at all), and
player cards have real descriptive labels instead of relying on emoji alone.

---

## New: test suite + CI

The pure scoring/streak/tiebreak logic used to live only inline in `app.js`.
It's now in `lib/trivia-core.js` — the same functions, loaded the same way in
the browser, but now also directly testable and shared with the GitHub Action
script (no more risk of the two drifting out of sync).

**Run the tests locally** (optional — not required for the site to work):
```
node --test
```
(Note: `node --test test/` with the folder spelled out doesn't reliably work on
every Node version — just run `node --test` with no path and it auto-discovers
the test file.)

**Runs automatically in CI**: `.github/workflows/test.yml` runs the full suite
on every push. If a future change accidentally breaks the streak math or the
tiebreak logic, you'll see a red ❌ on the commit in GitHub before it's a live
bug — this is exactly the kind of thing that's caught a subtle mistake before
during this project (see: the sort-order slip from a few rounds back).

No setup needed — it just runs.

---

## Quick reference: what needs secrets now

| Secret | Used by |
|---|---|
| `JSONBIN_API_KEY` | daily-questions, backup-scores |
| `QUESTIONS_BIN_ID` | daily-questions |
| `SCORES_BIN_ID` | **new** — backup-scores |
