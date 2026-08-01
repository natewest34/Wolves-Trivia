// ============================================
// CONFIG — fill in the JSONBin values below.
// See README.md for step-by-step setup.
// ============================================

const CONFIG = {
  // Starting roster. Anyone can add more from the "+ Add a player" link;
  // new names get saved into the QUESTIONS_BIN... no wait, PLAYERS_BIN below.
  PLAYERS: ["Thomas", "Tanner", "Michaela", "Jake", "Nathan"],

  // ---- JSONBin ----
  // 1. Create a free account at https://jsonbin.io
  // 2. Grab your X-Master-Key from the API Keys tab
  // 3. Create THREE bins (content of each can just be `{}` to start):
  //    - one for daily question sets
  //    - one for scores
  //    - one for the player roster
  //    Paste each bin's ID below.
  JSONBIN_API_KEY: "PASTE_YOUR_X_MASTER_KEY_HERE",
  QUESTIONS_BIN_ID: "PASTE_QUESTIONS_BIN_ID_HERE",
  SCORES_BIN_ID: "PASTE_SCORES_BIN_ID_HERE",
  PLAYERS_BIN_ID: "PASTE_PLAYERS_BIN_ID_HERE",

  // How many questions per day, split by difficulty.
  DIFFICULTY_MIX: { easy: 3, medium: 4, hard: 3 },
};
