/*
 * Context classifier for to-do items.
 *
 * Reads the free text of a task and infers:
 *   - category   (Work, Health, Finance, ...)
 *   - due date   ("tomorrow", "by Friday", "on the 1st", "this weekend", "Nov 20", ...)
 *   - due time   ("at 3pm", "10am", "noon", "tonight")
 *   - repeat     ("every Monday", "daily", "monthly", ...)
 *   - priority   (urgent | high | medium | low) plus a 0-100 score
 *   - quick      (looks like a 2-minute task: "call", "text", "pay", ...)
 *   - reasons    (plain-language explanation of each decision)
 *
 * It also learns from the user's corrections: pass `learned` (built with
 * `learn()`) and words the user has re-categorised or re-prioritised before
 * pull future tasks the same way.
 *
 * Pure rule-based and offline. Works in the browser (window.TodoClassifier)
 * and in Node (module.exports) for tests.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TodoClassifier = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // strong keywords score 2 (3 for multi-word phrases), weak ones score 1.
  const CATEGORIES = {
    Work: {
      icon: "💼",
      strong: [
        "meeting", "client", "clients", "boss", "manager", "report", "presentation", "deck", "slides",
        "deadline", "project", "sprint", "standup", "stand-up", "deploy", "release", "bug", "proposal",
        "stakeholder", "office", "colleague", "coworker", "roadmap", "okr", "okrs", "quarterly", "spec",
        "jira", "ticket", "demo", "onboarding", "hiring", "contract", "expense report", "resume", "cv",
        "job", "jobs", "interview", "linkedin", "cover letter", "code", "ci", "pull request", "pr",
        "feature", "test failures", "team sync", "1:1", "one on one", "work", "performance review",
        "invoice to client", "send invoice", "conference", "webinar",
      ],
      weak: ["email", "emails", "review", "team", "sync", "send", "submit", "draft", "tests"],
    },
    Health: {
      icon: "🩺",
      strong: [
        "doctor", "dentist", "gym", "workout", "go for a run", "running", "5k", "10k", "yoga", "medicine",
        "medication", "meds", "pills", "prescription", "pharmacy", "therapy", "therapist", "checkup",
        "check-up", "vaccine", "flu shot", "hospital", "clinic", "blood test", "physio", "meditate",
        "vitamins", "health", "exercise", "dermatologist", "eye exam", "optometrist", "gp", "surgery",
      ],
      weak: ["appointment", "appt", "run", "sleep", "diet", "walk"],
    },
    Finance: {
      icon: "💰",
      strong: [
        "bill", "bills", "rent", "mortgage", "tax", "taxes", "bank", "invoice", "budget", "loan",
        "credit card", "insurance", "car insurance", "home insurance", "health insurance", "salary", "refund", "transfer", "subscription", "invest", "savings",
        "401k", "expenses", "reimbursement", "paycheck", "direct debit", "utilities",
      ],
      weak: ["pay", "expense", "cancel"],
    },
    Shopping: {
      icon: "🛒",
      strong: [
        "groceries", "grocery", "milk", "eggs", "bread", "amazon", "shopping", "supermarket", "gift",
        "toilet paper", "return package", "shop for",
      ],
      weak: ["buy", "order", "shop", "store", "pizza"],
    },
    Home: {
      icon: "🏠",
      strong: [
        "clean", "laundry", "dishes", "vacuum", "repair", "plumber", "electrician", "garden", "lawn",
        "mow", "trash", "garbage", "recycling", "kitchen", "furniture", "paint", "declutter", "landlord",
        "leak", "sink", "toilet", "house", "apartment", "maintenance", "plants", "dog", "cat", "vet",
        "pet", "litter", "tidy", "bathroom", "boiler", "heating",
      ],
      weak: ["fix", "cook", "organize", "water", "feed", "walk the dog"],
    },
    Errands: {
      icon: "🚗",
      strong: [
        "car", "oil change", "car service", "tires", "tyres", "mot", "dmv", "driver's license",
        "drivers license", "registration", "post office", "library", "dry cleaning", "haircut",
        "barber", "salon", "drop off", "parcel", "car wash", "pick up prescription",
      ],
      weak: ["pick up", "return", "renew", "license", "mail", "package"],
    },
    "Family & Friends": {
      icon: "👪",
      strong: [
        "mom", "mum", "dad", "parents", "kids", "kid", "son", "daughter", "school", "babysitter",
        "friend", "friends", "birthday", "party", "wedding", "anniversary", "family", "grandma",
        "grandpa", "thank you notes", "catch up", "date night", "rsvp", "bachelor", "bachelorette",
        "baby shower", "pick up kids", "nephew", "niece", "sister", "brother", "wife", "husband",
        "partner",
      ],
      weak: ["visit", "text", "call", "dinner with", "lunch with"],
    },
    Learning: {
      icon: "📚",
      strong: [
        "study", "learn", "course", "class", "homework", "assignment", "exam", "quiz", "lecture",
        "tutorial", "practice", "research", "essay", "thesis", "certification", "university", "college",
        "read",
      ],
      weak: ["book", "test", "lesson"],
    },
    Travel: {
      icon: "✈️",
      strong: [
        "flight", "hotel", "trip", "passport", "visa", "packing", "airport", "itinerary", "vacation",
        "holiday", "travel", "rental car", "airbnb", "boarding pass", "check in for",
      ],
      weak: ["pack", "train"],
    },
  };

  const DEFAULT_CATEGORY = "General";
  const DEFAULT_ICON = "📝";
  // Old category names kept working after renames.
  const CATEGORY_ALIASES = { Social: "Family & Friends" };

  const URGENT_WORDS = ["urgent", "asap", "immediately", "emergency", "critical", "right now", "right away", "!!!", "overdue", "blocker", "blocking", "broken"];
  const IMPORTANT_WORDS = ["late fee", "penalty", "important", "must", "need to", "have to", "required", "deadline", "due", "final", "don't forget", "dont forget", "remember to", "priority"];
  const LOW_WORDS = ["someday", "maybe", "eventually", "when i have time", "if time", "low priority", "nice to have", "whenever", "no rush", "optional", "idea", "no deadline", "at some point", "one day"];
  // "not urgent", "isn't important", "no need to hurry", ...
  const NEGATED_URGENCY = /\b(?:not|no|isn'?t|is not|non|never)\s+(?:very\s+|that\s+|too\s+|super\s+|really\s+|a\s+)?(?:urgent|important|critical|asap|priority|pressing|a big deal|in a hurry|hurry)\b/i;

  // Things that cost money, health, legal standing or someone else if missed.
  const HIGH_STAKES = [
    "rent", "mortgage", "bill", "bills", "tax", "taxes", "fine", "penalty", "late fee", "insurance",
    "license", "passport", "visa", "renew", "renewal", "expires", "expiring", "interview", "exam",
    "prescription", "medication", "meds", "court", "legal", "pick up kids", "school pickup", "flight",
    "leak", "credit card", "loan", "payroll", "contract", "vaccine", "surgery", "client",
  ];
  const LOW_STAKES = ["pizza", "snack", "snacks", "haircut", "tidy", "netflix", "movie", "browse", "game", "games", "playlist", "podcast"];

  const CATEGORY_WEIGHT = {
    Health: 5, Finance: 5, Work: 4, Learning: 3, Travel: 2, "Family & Friends": 2,
    Errands: 0, Home: 0, Shopping: -3, General: 0,
  };

  // Verbs that usually mean a task takes a couple of minutes.
  const QUICK_VERBS = /^(?:\W*)(?:call|text|email|e-mail|reply|respond|message|ping|pay|send|order|schedule|cancel|rsvp|confirm|renew online|sign up|register|remind|ask|tell|forward|share|check)\b/i;

  const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const MONTH_RE = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
  const DAY_RE = "(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|rsday|urday)?";
  const STOPWORDS = new Set("the a an and or to for of on in at by with from my our your his her their this that it is be do get go up out about into some all any next last".split(" "));

  // ---------- small helpers ----------
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const reCache = new Map();
  function phraseRegex(phrase) {
    if (reCache.has(phrase)) return reCache.get(phrase);
    const re = new RegExp((/^\w/.test(phrase) ? "\\b" : "") + escapeRe(phrase) + (/\w$/.test(phrase) ? "\\b" : ""), "i");
    reCache.set(phrase, re);
    return re;
  }
  const has = (text, phrase) => phraseRegex(phrase).test(text);

  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function daysBetween(from, to) { return Math.round((startOfDay(to) - startOfDay(from)) / 86400000); }
  function toISODate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function parseISODate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  function weekdayIndex(token) { return WEEKDAYS.findIndex((w) => w.startsWith(token)); }
  function nextWeekday(today, target, includeToday) {
    let diff = (target - today.getDay() + 7) % 7;
    if (diff === 0 && !includeToday) diff = 7;
    return addDays(today, diff);
  }
  // Words that already drive priority or dates on their own; learning them would double-count.
  let signalWords = null;
  function isSignalWord(w) {
    if (!signalWords) {
      signalWords = new Set();
      for (const list of [URGENT_WORDS, IMPORTANT_WORDS, LOW_WORDS, HIGH_STAKES, LOW_STAKES]) {
        for (const phrase of list) for (const part of phrase.toLowerCase().split(/[^a-z']+/)) if (part.length > 2) signalWords.add(part);
      }
      "not isn't never today tonight tomorrow morning evening afternoon week weekend month year daily weekly monthly yearly every each other noon midnight soon later am pm"
        .split(" ").forEach((w) => signalWords.add(w));
      WEEKDAYS.forEach((d) => { signalWords.add(d); signalWords.add(d + "s"); });
    }
    return signalWords.has(w) || new RegExp(`^(${MONTH_RE})$`).test(w);
  }
  function tokens(text) {
    return [...new Set((text.toLowerCase().match(/[a-z][a-z']{2,}/g) || []).filter((w) => !STOPWORDS.has(w) && !isSignalWord(w)))];
  }

  // ---------- time of day ----------
  /** Returns "HH:MM" or null. */
  function extractTime(text) {
    const t = text.toLowerCase();
    let m;
    if ((m = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/.exec(t))) {
      let h = +m[1] % 12;
      if (m[3].startsWith("p")) h += 12;
      if (h > 23 || +(m[2] || 0) > 59) return null;
      return `${String(h).padStart(2, "0")}:${m[2] || "00"}`;
    }
    if ((m = /\b(\d{1,2}):(\d{2})\b/.exec(t)) && +m[1] < 24 && +m[2] < 60) {
      let h = +m[1];
      if (h >= 1 && h <= 7) h += 12; // "meet at 3:30" almost always means afternoon
      return `${String(h).padStart(2, "0")}:${m[2]}`;
    }
    if ((m = /\b(?:at|by|before|around)\s+(\d{1,2})\b(?!\s*(?:st|nd|rd|th|\/|%|days?|weeks?|people|items|k\b))/.exec(t)) && +m[1] >= 1 && +m[1] <= 12) {
      let h = +m[1];
      if (h <= 7) h += 12;
      if (h === 12) h = 12;
      return `${String(h).padStart(2, "0")}:00`;
    }
    if (/\bnoon\b|\bmidday\b/.test(t)) return "12:00";
    if (/\bmidnight\b/.test(t)) return "23:59";
    if (/\b(eod|end of (the )?day|close of business|cob)\b/.test(t)) return "17:00";
    if (/\btonight\b|\bthis evening\b/.test(t)) return "19:00";
    if (/\bthis morning\b/.test(t)) return "09:00";
    if (/\bthis afternoon\b|\bafter lunch\b/.test(t)) return "14:00";
    if (/\bafter work\b/.test(t)) return "18:00";
    return null;
  }

  // ---------- repeats ----------
  /** Returns { freq: "day"|"weekday"|"week"|"month"|"year", interval, weekday? , label } or null. */
  function extractRecurrence(text) {
    const t = text.toLowerCase();
    let m;
    if (/\b(every\s?day|daily|each day|every morning|every night|every evening)\b/.test(t)) return { freq: "day", interval: 1, label: "Every day" };
    if (/\b(every weekday|weekdays|each weekday)\b/.test(t)) return { freq: "weekday", interval: 1, label: "Every weekday" };
    if ((m = new RegExp(`\\b(every|each)\\s+(other\\s+)?${DAY_RE}\\b`).exec(t)) || (m = new RegExp(`\\b(on)\\s+()${DAY_RE}s\\b`).exec(t))) {
      const wd = weekdayIndex(m[3]);
      const interval = m[2] ? 2 : 1;
      const name = WEEKDAYS[wd][0].toUpperCase() + WEEKDAYS[wd].slice(1);
      return { freq: "week", interval, weekday: wd, label: interval === 2 ? `Every other ${name}` : `Every ${name}` };
    }
    if ((m = /\bevery\s+(\d+|two|three|four|other)\s+(day|week|month)s?\b/.exec(t))) {
      const n = { two: 2, three: 3, four: 4, other: 2 }[m[1]] || +m[1];
      return { freq: m[2], interval: n, label: `Every ${n} ${m[2]}s` };
    }
    if (/\b(weekly|every week|each week|once a week)\b/.test(t)) return { freq: "week", interval: 1, label: "Every week" };
    if (/\b(biweekly|fortnightly|every fortnight)\b/.test(t)) return { freq: "week", interval: 2, label: "Every 2 weeks" };
    if (/\b(monthly|every month|each month|once a month)\b/.test(t)) return { freq: "month", interval: 1, label: "Every month" };
    if (/\b(yearly|annually|every year|each year|once a year)\b/.test(t)) return { freq: "year", interval: 1, label: "Every year" };
    return null;
  }

  /** Next due date after `fromISO` for a repeat rule. */
  function nextOccurrence(fromISO, rule) {
    const d = parseISODate(fromISO) || startOfDay(new Date());
    const n = rule.interval || 1;
    switch (rule.freq) {
      case "day": return toISODate(addDays(d, n));
      case "weekday": {
        let x = addDays(d, 1);
        while (x.getDay() === 0 || x.getDay() === 6) x = addDays(x, 1);
        return toISODate(x);
      }
      case "week": return toISODate(addDays(d, 7 * n));
      case "month": {
        const x = new Date(d.getFullYear(), d.getMonth() + n, 1);
        const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
        x.setDate(Math.min(d.getDate(), last));
        return toISODate(x);
      }
      case "year": return toISODate(new Date(d.getFullYear() + n, d.getMonth(), d.getDate()));
      default: return toISODate(addDays(d, 1));
    }
  }

  // ---------- due date ----------
  /** Detect a due date in free text. Returns { date: Date, label: string } or null. */
  function extractDueDate(text, now = new Date(), recurrence = undefined) {
    const t = text.toLowerCase();
    const today = startOfDay(now);
    const rec = recurrence === undefined ? extractRecurrence(text) : recurrence;
    let m;

    if (/\bday after tomorrow\b/.test(t)) return { date: addDays(today, 2), label: "day after tomorrow" };
    if (/\b(today|tonight|this evening|this afternoon|this morning|eod|end of (the )?day|cob)\b/.test(t)) return { date: today, label: "today" };
    if (/\b(tomorrow|tmrw|tmr|tomorow)\b/.test(t)) return { date: addDays(today, 1), label: "tomorrow" };

    if ((m = /\bin (\d+|a|an|one|two|three|four|five|six|seven|a couple of) (day|days|week|weeks|month|months)\b/.exec(t))) {
      const words = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, "a couple of": 2 };
      const n = words[m[1]] ?? parseInt(m[1], 10);
      const days = m[2].startsWith("week") ? n * 7 : m[2].startsWith("month") ? n * 30 : n;
      return { date: addDays(today, days), label: `in ${days} day${days === 1 ? "" : "s"}` };
    }

    if ((m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t))) {
      const d = new Date(+m[1], +m[2] - 1, +m[3]);
      if (!isNaN(d)) return { date: d, label: toISODate(d) };
    }

    if ((m = new RegExp(`\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`).exec(t)) ||
        (m = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RE})\\b`).exec(t))) {
      const monthToken = isNaN(+m[1]) ? m[1] : m[2];
      const dayToken = isNaN(+m[1]) ? m[2] : m[1];
      const month = MONTHS.indexOf(monthToken.slice(0, 3));
      let d = new Date(today.getFullYear(), month, +dayToken);
      if (d < addDays(today, -60)) d = new Date(today.getFullYear() + 1, month, +dayToken);
      return { date: d, label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) };
    }

    if ((m = /(?:^|[^\d:])(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(t))) {
      let year = m[3] ? +m[3] : today.getFullYear();
      if (year < 100) year += 2000;
      let d = new Date(year, +m[1] - 1, +m[2]);
      if (!m[3] && d < addDays(today, -60)) d = new Date(year + 1, +m[1] - 1, +m[2]);
      if (!isNaN(d) && +m[1] <= 12 && +m[2] <= 31) return { date: d, label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) };
    }

    // "on the 1st", "by the 15th", "before the 3rd" -> next time that day of the month comes round
    if ((m = /\b(?:on|by|before|due|until|the)\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\b(?!\s+(?:grade|floor|time|place|birthday|anniversary))/.exec(t)) && +m[1] >= 1 && +m[1] <= 31) {
      let d = new Date(today.getFullYear(), today.getMonth(), +m[1]);
      if (d < today) d = new Date(today.getFullYear(), today.getMonth() + 1, +m[1]);
      return { date: d, label: `the ${m[1]}${m[0].match(/st|nd|rd|th/)[0]}` };
    }

    if ((m = /\b(next\s+)?weekend\b/.exec(t))) {
      const day = today.getDay();
      let d = day === 6 || day === 0 ? today : nextWeekday(today, 6, true);
      if (m[1]) d = addDays(d.getDay() === 0 ? addDays(d, -1) : d, 7);
      return { date: d, label: m[1] ? "next weekend" : "this weekend" };
    }

    // Weekday names. For repeats ("every monday") the first one can be today.
    if ((m = new RegExp(`\\b(next\\s+|this\\s+)?${DAY_RE}s?\\b`).exec(t))) {
      const target = weekdayIndex(m[2]);
      let d = nextWeekday(today, target, !!rec);
      if (m[1] && m[1].startsWith("next") && daysBetween(today, d) < 7) d = addDays(d, 7);
      return { date: d, label: (m[1] && m[1].startsWith("next") ? "next " : "") + WEEKDAYS[target] };
    }

    if (/\b(this week|end of (the )?week|eow|by friday)\b/.test(t)) {
      return { date: nextWeekday(today, 5, true), label: "end of week" };
    }
    if (/\bnext week\b/.test(t)) return { date: addDays(today, 7), label: "next week" };
    if (/\b(this month|end of (the )?month|eom)\b/.test(t)) return { date: new Date(today.getFullYear(), today.getMonth() + 1, 0), label: "end of month" };
    if (/\bnext month\b/.test(t)) return { date: addDays(today, 30), label: "next month" };
    if (/\b(soon|shortly)\b/.test(t)) return { date: addDays(today, 3), label: "soon" };

    // A repeating task with no date starts today.
    if (rec) return { date: today, label: "today" };
    return null;
  }

  // ---------- learning from corrections ----------
  /** Empty learning state. Keep it in storage and pass it back to analyze(). */
  function emptyLearned() { return { cat: {}, pri: {} }; }

  /**
   * Record a user correction.
   * @param learned  state from emptyLearned() (mutated and returned)
   * @param text     the task text
   * @param change   { category?: string, priorityDelta?: number }
   */
  function learn(learned, text, change) {
    const l = learned || emptyLearned();
    for (const w of tokens(text)) {
      if (change.category) {
        l.cat[w] = l.cat[w] || {};
        l.cat[w][change.category] = (l.cat[w][change.category] || 0) + 1;
      }
      if (typeof change.priorityDelta === "number") {
        const p = (l.pri[w] = l.pri[w] || { sum: 0, n: 0 });
        p.sum += change.priorityDelta;
        p.n += 1;
      }
    }
    return l;
  }

  // ---------- category ----------
  function categorize(text, learned) {
    const scores = {};
    const matches = {};
    for (const [name, def] of Object.entries(CATEGORIES)) {
      const strong = def.strong.filter((k) => has(text, k));
      const weak = def.weak.filter((k) => has(text, k));
      scores[name] = strong.reduce((s, k) => s + (k.includes(" ") ? 3 : 2), 0) + weak.length;
      matches[name] = strong.concat(weak);
    }
    let learnedHit = null;
    if (learned && learned.cat) {
      for (const w of tokens(text)) {
        const counts = learned.cat[w];
        if (!counts) continue;
        for (const [cat, n] of Object.entries(counts)) {
          const name = CATEGORY_ALIASES[cat] || cat;
          scores[name] = (scores[name] || 0) + Math.min(6, 3 * n);
          if (!learnedHit || n > learnedHit.n) learnedHit = { word: w, cat: name, n };
        }
      }
    }
    let best = { name: DEFAULT_CATEGORY, score: 0, matches: [] };
    for (const [name, score] of Object.entries(scores)) {
      if (score > best.score) best = { name, score, matches: matches[name] || [] };
    }
    best.learned = learnedHit && learnedHit.cat === best.name ? learnedHit : null;
    return best;
  }

  // ---------- priority ----------
  function prioritize(text, category, due, now = new Date(), extra = {}) {
    let score = 30;
    const reasons = [];
    const lower = text.toLowerCase();
    const negated = NEGATED_URGENCY.test(lower);
    // Remove the negated phrase so "not urgent" doesn't also count as "urgent".
    const scan = negated ? lower.replace(new RegExp(NEGATED_URGENCY.source, "gi"), " ") : lower;

    if (negated) { score -= 25; reasons.push("You said it isn't urgent"); }

    const urgent = URGENT_WORDS.filter((w) => has(scan, w));
    if (urgent.length) { score += 45; reasons.push(`Urgent wording: "${urgent[0]}"`); }

    const important = IMPORTANT_WORDS.filter((w) => has(scan, w));
    if (important.length) {
      score += Math.min(20, important.length * 10);
      reasons.push(`Signals importance: ${important.slice(0, 3).map((w) => `"${w}"`).join(", ")}`);
    }

    const low = LOW_WORDS.filter((w) => has(scan, w));
    if (low.length) { score -= 30; reasons.push(`Low-urgency wording: "${low[0]}"`); }

    const stakes = HIGH_STAKES.filter((w) => has(scan, w));
    if (stakes.length) { score += 12; reasons.push(`Costly to miss (${stakes.slice(0, 2).map((w) => `"${w}"`).join(", ")})`); }
    else if (LOW_STAKES.some((w) => has(scan, w))) { score -= 15; reasons.push("Low stakes if it slips"); }

    if (/!{1,2}(?!!)/.test(text) && !urgent.includes("!!!")) { score += 8; reasons.push("Exclamation emphasis"); }

    if (due) {
      const days = daysBetween(now, due);
      let minutesLeft = null;
      if (extra.dueTime && days === 0) {
        const [h, mi] = extra.dueTime.split(":").map(Number);
        const at = new Date(due); at.setHours(h, mi, 0, 0);
        minutesLeft = Math.round((at - now) / 60000);
      }
      let bump;
      if (days < 0) { bump = 50; reasons.push(`Overdue by ${-days} day${days === -1 ? "" : "s"}`); }
      else if (minutesLeft !== null && minutesLeft < 0) { bump = 50; reasons.push(`Was due at ${formatTime(extra.dueTime)}`); }
      else if (minutesLeft !== null && minutesLeft <= 180) { bump = 50; reasons.push(`Due in ${minutesLeft < 60 ? minutesLeft + " min" : Math.round(minutesLeft / 60) + "h"}`); }
      else if (days === 0) { bump = 40; reasons.push("Due today"); }
      else if (days === 1) { bump = 28; reasons.push("Due tomorrow"); }
      else if (days <= 3) { bump = 18; reasons.push(`Due in ${days} days`); }
      else if (days <= 7) { bump = 10; reasons.push("Due within a week"); }
      else if (days <= 14) { bump = 3; reasons.push("Due within two weeks"); }
      else { bump = -5; reasons.push("Deadline is far off"); }
      // Routine repeats matter less than one-off deadlines.
      if (extra.recurrence && bump > 0) bump = Math.round(bump * 0.6);
      score += bump;
    }
    if (extra.recurrence) reasons.push(`Repeats: ${extra.recurrence.label.toLowerCase()}`);

    const weight = CATEGORY_WEIGHT[category] ?? 0;
    if (weight) {
      score += weight;
      if (weight > 0) reasons.push(`${category} tasks carry extra weight`);
    }

    if (extra.learned && extra.learned.pri) {
      const deltas = tokens(text).map((w) => extra.learned.pri[w]).filter(Boolean).map((p) => p.sum / p.n);
      if (deltas.length) {
        const avg = Math.max(-25, Math.min(25, Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length)));
        if (Math.abs(avg) >= 5) {
          score += avg;
          reasons.push(`Adjusted ${avg > 0 ? "up" : "down"} from your past edits`);
        }
      }
    }

    score = Math.max(0, Math.min(100, score));
    return { level: levelFor(score), score, reasons };
  }

  function levelFor(score) {
    if (score >= 75) return "urgent";
    if (score >= 55) return "high";
    if (score >= 30) return "medium";
    return "low";
  }

  /** Typical score for a level, used to measure how far a manual override moved a task. */
  const LEVEL_SCORE = { urgent: 85, high: 64, medium: 42, low: 15 };

  function formatTime(hhmm) {
    if (!hhmm) return "";
    const [h, m] = hhmm.split(":").map(Number);
    const d = new Date(2000, 0, 1, h, m);
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: m ? "2-digit" : undefined });
  }

  /**
   * Full analysis of a task.
   * @param {string} text
   * @param {object} opts
   *   now        Date to treat as "now" (tests)
   *   dueDate    "YYYY-MM-DD" stored date; overrides detection ("" or null = none)
   *   dueTime    "HH:MM" stored time; overrides detection
   *   recurrence stored repeat rule (or null); overrides detection
   *   learned    state built by learn()
   */
  function analyze(text, opts = {}) {
    const now = opts.now || new Date();
    const cat = categorize(text, opts.learned);
    const recurrence = "recurrence" in opts ? opts.recurrence : extractRecurrence(text);
    let due = null, dueLabel = null;
    if ("dueDate" in opts) {
      due = parseISODate(opts.dueDate);
    } else {
      const found = extractDueDate(text, now, recurrence);
      if (found) { due = found.date; dueLabel = found.label; }
    }
    const dueTime = "dueTime" in opts ? opts.dueTime || null : extractTime(text);
    // A time with no day ("gym at 6pm") means today.
    if (!due && dueTime && !("dueDate" in opts)) { due = startOfDay(now); dueLabel = "today"; }
    const pr = prioritize(text, cat.name, due, now, { dueTime, recurrence, learned: opts.learned });
    const quick = QUICK_VERBS.test(text) && text.trim().split(/\s+/).length <= 7 && !/\b(and|then|plus)\b/i.test(text);

    const reasons = [];
    if (cat.learned) reasons.push(`Categorized as ${cat.name} because you filed "${cat.learned.word}" there before`);
    else if (cat.matches.length) reasons.push(`Categorized as ${cat.name} (${cat.matches.slice(0, 3).map((k) => `"${k}"`).join(", ")})`);
    if (quick) reasons.push("Looks quick, about 2 minutes");
    return {
      category: cat.name,
      icon: categoryIcon(cat.name),
      dueDate: due ? toISODate(due) : null,
      dueLabel,
      dueTime,
      recurrence,
      quick,
      priority: pr.level,
      score: pr.score,
      reasons: reasons.concat(pr.reasons),
    };
  }

  function categoryIcon(name) {
    return CATEGORIES[CATEGORY_ALIASES[name] || name]?.icon || DEFAULT_ICON;
  }

  return {
    analyze,
    categorize,
    prioritize,
    extractDueDate,
    extractTime,
    extractRecurrence,
    nextOccurrence,
    learn,
    emptyLearned,
    levelFor,
    LEVEL_SCORE,
    formatTime,
    categoryIcon,
    daysBetween,
    parseISODate,
    toISODate,
    CATEGORY_ALIASES,
    CATEGORY_NAMES: Object.keys(CATEGORIES).concat(DEFAULT_CATEGORY),
    PRIORITIES: ["urgent", "high", "medium", "low"],
  };
});
