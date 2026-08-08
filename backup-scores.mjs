// ============================================
// Fetches the current scores bin from JSONBin and writes it to disk, so the
// workflow can commit it into the repo as a backup. JSONBin is the only live
// copy of everyone's scores — this gives you a second copy that doesn't depend
// on that one account/service staying available.
//
// Run by .github/workflows/backup-scores.yml on a schedule. Can also be run
// manually: JSONBIN_API_KEY=... SCORES_BIN_ID=... node scripts/backup-scores.mjs
// ============================================

import { writeFile, mkdir } from "node:fs/promises";

const JSONBIN_API_KEY = process.env.JSONBIN_API_KEY;
const SCORES_BIN_ID = process.env.SCORES_BIN_ID;

const JSONBIN_BASE = "https://api.jsonbin.io/v3/b";
const BACKUP_DIR = "backups";

async function fetchScores() {
  const res = await fetch(`${JSONBIN_BASE}/${SCORES_BIN_ID}/latest`, {
    headers: { "X-Master-Key": JSONBIN_API_KEY },
  });
  if (!res.ok) throw new Error(`JSONBin GET failed: ${res.status}`);
  const body = await res.json();
  return body.record && typeof body.record === "object" ? body.record : {};
}

async function main() {
  if (!JSONBIN_API_KEY || !SCORES_BIN_ID) {
    throw new Error("Missing JSONBIN_API_KEY or SCORES_BIN_ID environment variables.");
  }

  const scores = await fetchScores();
  const dayCount = Object.keys(scores).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).length;

  await mkdir(BACKUP_DIR, { recursive: true });

  // Always overwrite "latest" (easy single place to restore from), and also keep
  // a dated snapshot so you can look back at what things looked like on a given day.
  const isoDate = new Date().toISOString().slice(0, 10);
  const pretty = JSON.stringify(scores, null, 2);

  await writeFile(`${BACKUP_DIR}/scores-latest.json`, pretty);
  await writeFile(`${BACKUP_DIR}/scores-${isoDate}.json`, pretty);

  console.log(`Backed up ${dayCount} day(s) of scores to ${BACKUP_DIR}/scores-latest.json and scores-${isoDate}.json`);
}

main().catch((err) => {
  console.error("Backup failed:", err);
  process.exit(1);
});
