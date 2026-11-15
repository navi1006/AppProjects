/*
 * Context classifier for to-do items.
 *
 * Reads the free text of a task and infers:
 *   - category  (Work, Health, Finance, ...)
 *   - due date  ("tomorrow", "by Friday", "in 3 days", "Nov 20", "2026-12-01", ...)
 *   - priority  (urgent | high | medium | low) plus a numeric score
 *   - reasons   (human-readable explanation of why)
 *
 * Pure rule-based, no network calls. Works in the browser (window.TodoClassifier)
 * and in Node (module.exports) so it can be unit-tested.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TodoClassifier = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const CATEGORIES = {
    Work: {
      icon: "💼",
      keywords: [
        "meeting", "client", "boss", "manager", "report", "presentation", "deck", "slides",
        "email", "deadline", "project", "sprint", "standup", "review", "pr", "deploy",
        "release", "bug", "invoice client", "proposal", "stakeholder", "office", "colleague",
        "team", "roadmap", "okr", "quarterly", "q1", "q2", "q3", "q4", "spec", "jira",
        "ticket", "demo", "onboarding", "hiring", "interview candidate", "contract", "work",
      ],
    },
    Health: {
      icon: "🩺",
      keywords: [
        "doctor", "dentist", "appointment", "gym", "workout", "go for a run", "running", "yoga", "medicine",
        "medication", "pills", "prescription", "pharmacy", "therapy", "therapist", "checkup",
        "vaccine", "hospital", "clinic", "blood test", "physio", "meditate", "sleep", "diet",
        "vitamins", "health", "exercise",
      ],
    },
    Finance: {
      icon: "💰",
      keywords: [
        "pay", "bill", "bills", "rent", "mortgage", "tax", "taxes", "bank", "invoice",
        "budget", "loan", "credit card", "insurance", "salary", "refund", "transfer",
        "subscription", "invest", "savings", "401k", "expense", "expenses", "reimbursement",
      ],
    },
    Shopping: {
      icon: "🛒",
      keywords: [
        "buy", "order", "groceries", "grocery", "milk", "eggs", "bread", "amazon", "shop",
        "shopping", "pick up", "store", "supermarket", "gift", "return package",
      ],
    },
    Home: {
      icon: "🏠",
      keywords: [
        "clean", "laundry", "dishes", "vacuum", "fix", "repair", "plumber", "electrician",
        "garden", "lawn", "trash", "garbage", "cook", "kitchen", "furniture", "paint",
        "organize", "declutter", "landlord", "house", "apartment", "maintenance",
      ],
    },
    Learning: {
      icon: "📚",
      keywords: [
        "study", "learn", "course", "class", "homework", "assignment", "exam", "test",
        "quiz", "read", "book", "lecture", "tutorial", "practice", "research", "essay",
        "thesis", "certification", "school", "university", "college",
      ],
    },
    Social: {
      icon: "🎉",
      keywords: [
        "call mom", "call dad", "mom", "dad", "friend", "friends", "birthday", "party",
        "dinner with", "lunch with", "wedding", "anniversary", "family", "visit", "text",
        "catch up", "date night", "rsvp",
      ],
    },
    Travel: {
      icon: "✈️",
      keywords: [
        "flight", "hotel", "book trip", "trip", "passport", "visa", "pack", "packing",
        "airport", "itinerary", "vacation", "travel", "train", "check in", "rental car",
      ],
    },
  };

  const DEFAULT_CATEGORY = "General";
  const DEFAULT_ICON = "📝";

  // Words that signal urgency / importance / low priority.
  const URGENT_WORDS = ["urgent", "asap", "immediately", "emergency", "critical", "right now", "!!!", "overdue", "blocker", "blocking"];
  const IMPORTANT_WORDS = ["important", "must", "need to", "have to", "required", "deadline", "due", "boss", "client", "exam", "interview", "final", "renew", "expires", "expiring", "late fee", "penalty"];
  const LOW_WORDS = ["someday", "maybe", "eventually", "when i have time", "if time", "low priority", "nice to have", "whenever", "no rush", "optional", "idea"];

  // Category baseline: some areas carry more inherent consequence.
  const CATEGORY_WEIGHT = {
    Health: 8, Finance: 8, Work: 6, Learning: 4, Travel: 3,
    Home: 0, Social: 0, Shopping: -2, General: 0,
  };

  const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function phraseRegex(phrase) {
    // Word-boundary match that also works for phrases and symbols like "!!!".
    const startsWord = /^\w/.test(phrase);
    const endsWord = /\w$/.test(phrase);
    return new RegExp((startsWord ? "\\b" : "") + escapeRe(phrase) + (endsWord ? "\\b" : ""), "i");
  }

  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  function daysBetween(from, to) {
    return Math.round((startOfDay(to) - startOfDay(from)) / 86400000);
  }

  function toISODate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function parseISODate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  /** Detect a due date in free text. Returns { date: Date, label: string } or null. */
  function extractDueDate(text, now = new Date()) {
    const t = text.toLowerCase();
    const today = startOfDay(now);
    let m;

    if (/\b(today|tonight|this evening|this afternoon|eod|end of day)\b/.test(t)) return { date: today, label: "today" };
    if (/\b(tomorrow|tmrw|tmr)\b/.test(t)) return { date: addDays(today, 1), label: "tomorrow" };
    if (/\bday after tomorrow\b/.test(t)) return { date: addDays(today, 2), label: "day after tomorrow" };

    if ((m = /\bin (\d+|a|one|two|three|four|five|six|seven) (day|days|week|weeks)\b/.exec(t))) {
      const words = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
      const n = words[m[1]] ?? parseInt(m[1], 10);
      const days = m[2].startsWith("week") ? n * 7 : n;
      return { date: addDays(today, days), label: `in ${days} day${days === 1 ? "" : "s"}` };
    }

    // ISO date 2026-12-01
    if ((m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t))) {
      const d = new Date(+m[1], +m[2] - 1, +m[3]);
      if (!isNaN(d)) return { date: d, label: toISODate(d) };
    }

    // "Nov 20", "november 20th", "20 nov"
    const monthRe = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
    if ((m = new RegExp(`\\b(${monthRe})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`).exec(t)) ||
        (m = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthRe})\\b`).exec(t))) {
      const monthToken = isNaN(+m[1]) ? m[1] : m[2];
      const dayToken = isNaN(+m[1]) ? m[2] : m[1];
      const month = MONTHS.indexOf(monthToken.slice(0, 3));
      let d = new Date(today.getFullYear(), month, +dayToken);
      if (d < addDays(today, -60)) d = new Date(today.getFullYear() + 1, month, +dayToken);
      return { date: d, label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) };
    }

    // "11/20" (month/day, US style)
    if ((m = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(t))) {
      let year = m[3] ? +m[3] : today.getFullYear();
      if (year < 100) year += 2000;
      let d = new Date(year, +m[1] - 1, +m[2]);
      if (!m[3] && d < addDays(today, -60)) d = new Date(year + 1, +m[1] - 1, +m[2]);
      if (!isNaN(d)) return { date: d, label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) };
    }

    // "next monday", "by friday", "on wed", "this thursday"
    const dayRe = "(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|rsday|urday)?";
    if ((m = new RegExp(`\\b(next\\s+)?${dayRe}\\b`).exec(t))) {
      const target = WEEKDAYS.findIndex((w) => w.startsWith(m[2]));
      let diff = (target - today.getDay() + 7) % 7;
      if (diff === 0) diff = 7; // "friday" said on a Friday means next one
      if (m[1] && diff < 7) diff += 7;
      return { date: addDays(today, diff), label: (m[1] ? "next " : "") + WEEKDAYS[target] };
    }

    if (/\b(this week|end of (the )?week|eow)\b/.test(t)) {
      const diff = (5 - today.getDay() + 7) % 7; // Friday
      return { date: addDays(today, diff), label: "end of week" };
    }
    if (/\bnext week\b/.test(t)) return { date: addDays(today, 7), label: "next week" };
    if (/\b(this month|end of (the )?month|eom)\b/.test(t)) {
      return { date: new Date(today.getFullYear(), today.getMonth() + 1, 0), label: "end of month" };
    }
    if (/\bnext month\b/.test(t)) return { date: addDays(today, 30), label: "next month" };

    return null;
  }

  /** Score every category; return the best plus matched keywords. */
  function categorize(text) {
    let best = { name: DEFAULT_CATEGORY, score: 0, matches: [] };
    for (const [name, def] of Object.entries(CATEGORIES)) {
      const matches = def.keywords.filter((k) => phraseRegex(k).test(text));
      // Multi-word phrases are more specific, so weigh them higher.
      const score = matches.reduce((s, k) => s + (k.includes(" ") ? 2 : 1), 0);
      if (score > best.score) best = { name, score, matches };
    }
    return best;
  }

  /** Priority scoring from urgency words, deadlines and category. */
  function prioritize(text, category, due, now = new Date()) {
    let score = 30; // neutral baseline
    const reasons = [];
    const lower = text.toLowerCase();

    const urgent = URGENT_WORDS.filter((w) => phraseRegex(w).test(lower));
    if (urgent.length) {
      score += 45;
      reasons.push(`Urgent wording: "${urgent[0]}"`);
    }

    const important = IMPORTANT_WORDS.filter((w) => phraseRegex(w).test(lower));
    if (important.length) {
      score += Math.min(25, important.length * 12);
      reasons.push(`Signals importance: ${important.slice(0, 3).map((w) => `"${w}"`).join(", ")}`);
    }

    const low = LOW_WORDS.filter((w) => phraseRegex(w).test(lower));
    if (low.length) {
      score -= 30;
      reasons.push(`Low-urgency wording: "${low[0]}"`);
    }

    if (/!{1,2}(?!!)/.test(text) && !urgent.includes("!!!")) {
      score += 8;
      reasons.push("Exclamation emphasis");
    }

    if (due) {
      const days = daysBetween(now, due);
      let bump;
      if (days < 0) { bump = 50; reasons.push(`Overdue by ${-days} day${days === -1 ? "" : "s"}`); }
      else if (days === 0) { bump = 40; reasons.push("Due today"); }
      else if (days === 1) { bump = 30; reasons.push("Due tomorrow"); }
      else if (days <= 3) { bump = 20; reasons.push(`Due in ${days} days`); }
      else if (days <= 7) { bump = 10; reasons.push("Due within a week"); }
      else if (days <= 14) { bump = 3; reasons.push("Due within two weeks"); }
      else { bump = -5; reasons.push("Deadline is far off"); }
      score += bump;
    }

    const weight = CATEGORY_WEIGHT[category] ?? 0;
    if (weight) {
      score += weight;
      if (weight > 0) reasons.push(`${category} tasks carry extra weight`);
    }

    score = Math.max(0, Math.min(100, score));
    let level;
    if (score >= 75) level = "urgent";
    else if (score >= 55) level = "high";
    else if (score >= 30) level = "medium";
    else level = "low";

    return { level, score, reasons };
  }

  /**
   * Full analysis of a task.
   * @param {string} text
   * @param {{ now?: Date, dueDate?: string }} opts  dueDate (YYYY-MM-DD) overrides detection
   */
  function analyze(text, opts = {}) {
    const now = opts.now || new Date();
    const cat = categorize(text);
    let due = null;
    let dueLabel = null;
    if (opts.dueDate) {
      due = parseISODate(opts.dueDate);
    } else {
      const found = extractDueDate(text, now);
      if (found) { due = found.date; dueLabel = found.label; }
    }
    const pr = prioritize(text, cat.name, due, now);
    const reasons = [];
    if (cat.matches.length) reasons.push(`Categorized as ${cat.name} (${cat.matches.slice(0, 3).map((k) => `"${k}"`).join(", ")})`);
    return {
      category: cat.name,
      icon: categoryIcon(cat.name),
      dueDate: due ? toISODate(due) : null,
      dueLabel,
      priority: pr.level,
      score: pr.score,
      reasons: reasons.concat(pr.reasons),
    };
  }

  function categoryIcon(name) {
    return CATEGORIES[name]?.icon || DEFAULT_ICON;
  }

  return {
    analyze,
    categorize,
    prioritize,
    extractDueDate,
    categoryIcon,
    daysBetween,
    parseISODate,
    toISODate,
    CATEGORY_NAMES: Object.keys(CATEGORIES).concat(DEFAULT_CATEGORY),
    PRIORITIES: ["urgent", "high", "medium", "low"],
  };
});
