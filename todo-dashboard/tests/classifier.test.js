// Run with: node --test tests/*.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../classifier.js");

// Fixed "now": Sunday, Nov 15 2026, 10:00
const now = new Date(2026, 10, 15, 10, 0, 0);
const a = (text, extra = {}) => C.analyze(text, { now, ...extra });

test("categorizes by context", () => {
  const cases = {
    "Prepare client presentation for the meeting": "Work",
    "fix test failures in CI": "Work",
    "Update resume": "Work",
    "Pay rent": "Finance",
    "Book a dentist appointment": "Health",
    "Get a blood test": "Health",
    "Buy groceries: milk and eggs": "Shopping",
    "Do laundry and clean the kitchen": "Home",
    "Email the landlord about the leak": "Home",
    "Walk the dog": "Home",
    "Return library books": "Errands",
    "Car oil change": "Errands",
    "Study for chemistry exam": "Learning",
    "Mom's birthday party": "Family & Friends",
    "Pick up kids from school": "Family & Friends",
    "Renew passport before the trip": "Travel",
    "Renew car insurance by Friday": "Finance",
    "Think about stuff": "General",
  };
  for (const [text, cat] of Object.entries(cases)) assert.equal(a(text).category, cat, text);
});

test("detects due dates", () => {
  const cases = {
    "Call Bob today": "2026-11-15",
    "Call Bob tomorrow": "2026-11-16",
    "Submit report by Friday": "2026-11-20",
    "Submit report next friday": "2026-11-27",
    "Finish in 3 days": "2026-11-18",
    "Due in 2 weeks": "2026-11-29",
    "Dinner on Dec 3": "2026-12-03",
    "Taxes 2027-04-15": "2027-04-15",
    "Appointment 11/20": "2026-11-20",
    "Pay before end of month": "2026-11-30",
    "Pay rent on the 1st": "2026-12-01",
    "Pay by the 20th": "2026-11-20",
    "Mow lawn next weekend": "2026-11-21",
    "Gym at 6pm": "2026-11-15",
    "Learn guitar": null,
    "Maybe 2 coffees": null,
    "Clean the fridge": null,
  };
  for (const [text, d] of Object.entries(cases)) assert.equal(a(text).dueDate, d, text);
});

test("detects times", () => {
  assert.equal(a("Dentist at 3pm").dueTime, "15:00");
  assert.equal(a("Call at 10:30am").dueTime, "10:30");
  assert.equal(a("Meeting at 3").dueTime, "15:00");
  assert.equal(a("Doctor on Tuesday at 4").dueTime, "16:00");
  assert.equal(a("Order food tonight").dueTime, "19:00");
  assert.equal(a("Lunch at noon").dueTime, "12:00");
  assert.equal(a("Pay rent on the 1st").dueTime, null);
  assert.equal(a("Run 5k").dueTime, null);
});

test("detects repeats and rolls them forward", () => {
  const r = a("Weekly team sync every Monday");
  assert.equal(r.recurrence.freq, "week");
  assert.equal(r.dueDate, "2026-11-16");
  assert.equal(a("Take vitamins daily").recurrence.freq, "day");
  assert.equal(a("Take vitamins daily").dueDate, "2026-11-15");
  assert.equal(a("Pay rent monthly on the 1st").dueDate, "2026-12-01");
  assert.equal(a("Call grandma every other Sunday").recurrence.interval, 2);
  assert.equal(C.nextOccurrence("2026-11-16", { freq: "week", interval: 1 }), "2026-11-23");
  assert.equal(C.nextOccurrence("2026-01-31", { freq: "month", interval: 1 }), "2026-02-28");
  assert.equal(C.nextOccurrence("2026-11-20", { freq: "weekday", interval: 1 }), "2026-11-23");
});

test("sets priority from context", () => {
  const cases = {
    "URGENT: fix login bug blocking release": "urgent",
    "Pay rent today": "urgent",
    "Call the dentist tomorrow": "high",
    "Buy milk": "low",
    "Someday learn to play guitar": "low",
    "Not urgent: tidy desk": "low",
    "This isn't important, sort photos": "low",
    "Organize the garage": "medium",
    "Order pizza tonight": "medium",
    "Renew car insurance by Friday, late fee otherwise": "high",
  };
  for (const [text, p] of Object.entries(cases)) assert.equal(a(text).priority, p, text);
});

test("high-stakes tasks outrank trivial ones", () => {
  assert.ok(a("Pay credit card bill").score > a("Write thank you notes").score);
  assert.ok(a("Renew passport").score > a("Get haircut").score);
});

test("a deadline a few hours away beats one later today", () => {
  assert.ok(a("Submit form at 11am").score > a("Submit form at 9pm").score);
  assert.match(a("Submit form at 9am").reasons.join(" "), /Was due/);
});

test("priority rises as the deadline approaches", () => {
  const far = a("Submit report", { dueDate: "2026-12-20" });
  const near = a("Submit report", { dueDate: "2026-11-16" });
  const overdue = a("Submit report", { dueDate: "2026-11-10" });
  assert.ok(far.score < near.score && near.score < overdue.score);
  assert.ok(overdue.reasons.some((r) => r.startsWith("Overdue")));
});

test("flags quick tasks", () => {
  assert.equal(a("Text Sarah back").quick, true);
  assert.equal(a("Write the quarterly strategy document for the board meeting next month").quick, false);
});

test("learns categories and priorities from corrections", () => {
  const learned = C.emptyLearned();
  assert.equal(a("Sort out Zumba class").category, "Learning");
  C.learn(learned, "Zumba class", { category: "Health" });
  assert.equal(a("Zumba tonight", { learned }).category, "Health");
  assert.match(a("Zumba tonight", { learned }).reasons[0], /filed "zumba"/);

  const before = a("Water the plants").score;
  C.learn(learned, "Water the plants", { priorityDelta: 20 });
  C.learn(learned, "Water the plants", { priorityDelta: 20 });
  assert.ok(a("Water the plants", { learned }).score >= before + 15);
});

test("learning ignores urgency and date words", () => {
  const learned = C.emptyLearned();
  C.learn(learned, "Not urgent: sort old photos tomorrow", { priorityDelta: 30 });
  assert.deepEqual(Object.keys(learned.pri).sort(), ["old", "photos", "sort"]);
  assert.equal(a("URGENT: server down", { learned }).score, a("URGENT: server down").score);
});

test("explains its reasoning", () => {
  const r = a("Important: pay the bill tomorrow").reasons.join(" | ");
  assert.match(r, /Finance/);
  assert.match(r, /Due tomorrow/);
  assert.match(r, /importance/);
  assert.match(r, /Costly to miss/);
});
