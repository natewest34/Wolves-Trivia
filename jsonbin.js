// ============================================
// Thin wrapper around the JSONBin.io v3 API.
// Each bin holds ONE json document; we read the
// whole thing, edit it, and write the whole thing back.
// ============================================

const JSONBIN_BASE = "https://api.jsonbin.io/v3/b";

async function jsonbinGet(binId) {
  const res = await fetch(`${JSONBIN_BASE}/${binId}/latest`, {
    headers: { "X-Master-Key": CONFIG.JSONBIN_API_KEY },
  });
  if (!res.ok) throw new Error(`JSONBin GET failed: ${res.status}`);
  const body = await res.json();
  return body.record;
}

async function jsonbinPut(binId, data) {
  const res = await fetch(`${JSONBIN_BASE}/${binId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Master-Key": CONFIG.JSONBIN_API_KEY,
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`JSONBin PUT failed: ${res.status}`);
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
