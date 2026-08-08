// ============================================
// Thin wrapper around the JSONBin.io v3 API.
// Each bin holds ONE json document; we read the
// whole thing, edit it, and write the whole thing back.
// ============================================

const JSONBIN_BASE = "https://api.jsonbin.io/v3/b";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retries transient failures (network drop, 5xx, 429 rate limit) with backoff.
// Does NOT retry genuine client errors (bad API key, missing bin, etc.) — those
// won't fix themselves on a retry, so failing fast there is more honest than
// making someone wait through pointless retries.
async function fetchWithRetry(url, options, { retries = 2, baseDelayMs = 600 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res;
    try {
      res = await fetch(url, options);
    } catch (networkErr) {
      // fetch() itself throwing means a genuine network failure — always worth retrying.
      lastErr = networkErr;
      if (attempt < retries) {
        await sleep(baseDelayMs * 2 ** attempt);
        continue;
      }
      throw networkErr;
    }

    if (res.ok) return res;

    if ((res.status >= 500 || res.status === 429) && attempt < retries) {
      await sleep(baseDelayMs * 2 ** attempt);
      continue;
    }

    // Non-retryable HTTP error (4xx other than 429, or genuinely out of retries) —
    // thrown outside any catch here, so it can't accidentally re-enter the retry path.
    throw new Error(`JSONBin request failed: ${res.status}`);
  }
  throw lastErr;
}

async function jsonbinGet(binId) {
  const res = await fetchWithRetry(`${JSONBIN_BASE}/${binId}/latest`, {
    headers: { "X-Master-Key": CONFIG.JSONBIN_API_KEY },
  });
  const body = await res.json();
  return body.record;
}

async function jsonbinPut(binId, data) {
  const res = await fetchWithRetry(`${JSONBIN_BASE}/${binId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Master-Key": CONFIG.JSONBIN_API_KEY,
    },
    body: JSON.stringify(data),
  });
  return res.json();
}

// Safe read: returns {} if the bin is empty/new.
async function jsonbinGetOrEmpty(binId) {
  try {
    const record = await jsonbinGet(binId);
    return record && typeof record === "object" ? record : {};
  } catch (e) {
    console.warn("jsonbinGetOrEmpty fallback:", e);
    return {};
  }
}
