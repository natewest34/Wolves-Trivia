// ============================================
// CONFIG — fill in the JSONBin values below.
// See README.md for step-by-step setup.
// ============================================

const CONFIG = {
  // Starting roster. Anyone can add more from the "+ Add a player" link;
  // new names get saved into the QUESTIONS_BIN... no wait, PLAYERS_BIN below.
  PLAYERS: ["Thomas", "Tanner", "Michaela", "Jake", "Nathan"],
  
  JSONBIN_API_KEY: "$2a$10$C7Lv1mmqf7swft4ckRdsm.sQ.ysUveuAyJBMlKUYWb0yoSUH8u4xG",
  QUESTIONS_BIN_ID: "6a6e6eddf5f4af5e29df5e9f",
  SCORES_BIN_ID: "6a6e6ee6f5f4af5e29df5ec0",
  PLAYERS_BIN_ID: "6a6e6ef0f5f4af5e29df5edf",

  // How many questions per day, split by difficulty.
  DIFFICULTY_MIX: { easy: 7, medium: 3, hard: 0 },
  
  // Category names to never include in a daily set. Matching is case-insensitive
  // and matches on "contains" — so "Entertainment" excludes every Entertainment:
  // subcategory at once (Books, Film, Music, TV, Video Games, etc.), while
  // "Sports" only excludes that one. Spelling needs to reasonably match OpenTDB's
  // own names, listed below for reference (current as of when this was written —
  // OpenTDB's category list has been stable for years, but if an exclusion doesn't
  // seem to be taking effect, double check the exact name against
  // https://opentdb.com/api_category.php).
  //
  // General Knowledge · Entertainment: Books · Entertainment: Film ·
  // Entertainment: Music · Entertainment: Musicals & Theatres ·
  // Entertainment: Television · Entertainment: Video Games ·
  // Entertainment: Board Games · Science & Nature · Science: Computers ·
  // Science: Mathematics · Mythology · Sports · Geography · History ·
  // Politics · Art · Celebrities · Animals · Vehicles ·
  // Entertainment: Comics · Science: Gadgets ·
  // Entertainment: Japanese Anime & Manga · Entertainment: Cartoon & Animations
  //
  // Example: EXCLUDED_CATEGORIES: ["Celebrities", "Science: Mathematics"]
  EXCLUDED_CATEGORIES: ["Entertainment: Video Games", "Entertainment: Comics", "Entertainment: Musicals & Theatres", "Mythology", "Entertainment: Japanese Anime & Manga", "Entertainment: Cartoon & Animations"],
};

// Node (the GitHub Action script) can `import CONFIG from "../config.js"` thanks to this.
// The browser ignores it entirely (no `module` global there).
if (typeof module !== "undefined" && module.exports) {
  module.exports = CONFIG;
}
