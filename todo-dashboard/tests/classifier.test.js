// Run with: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../classifier.js");

// Fixed "now": Sunday, Nov 15 2026
const now = new Date(2026, 10, 15, 10, 0, 0);
const a = (text) => C.analyze(text, { now });

test("categorizes by context", () => {
  assert.equal(a("Prepare client presentation for the meeting").category, "Work");
  assert.equal(a("Pay rent").category, "Finance");
  assert.equal(a("Book a dentist appointment").category, "Health");
  assert.equal(a("Buy groceries: milk and eggs").category, "Shopping");
  assert.equal(a("Do laundry and clean the kitchen").category, "Home");
  assert.equal(a("Study for chemistry exam").category, "Learning");
  assert.equal(a("Mom's birthday party").category, "Social");
  assert.equal(a("Renew passport before the trip").category, "Travel");
  assert.equal(a("Get a blood test").category, "Health");
  assert.equal(a("Think about stuff").category, "General");
});

test("detects due dates", () => {
  assert.equal(a("Call Bob today").dueDate, "2026-11-15");
  assert.equal(a("Call Bob tomorrow").dueDate, "2026-11-16");
  assert.equal(a("Submit report by Friday").dueDate, "2026-11-20");
  assert.equal(a("Submit report next friday").dueDate, "2026-11-27");
  assert.equal(a("Finish in 3 days").dueDate, "2026-11-18");
  assert.equal(a("Due in 2 weeks").dueDate, "2026-11-29");
  assert.equal(a("Dinner on Dec 3").dueDate, "2026-12-03");
  assert.equal(a("Taxes 2027-04-15").dueDate, "2027-04-15");
  assert.equal(a("Appointment 11/20").dueDate, "2026-11-20");
  assert.equal(a("Pay before end of month").dueDate, "2026-11-30");
  assert.equal(a("Learn guitar").dueDate, null);
  // Words that merely contain day/month names must not be read as dates
  assert.equal(a("Maybe 2 coffees").dueDate, null);
  assert.equal(a("Clean the fridge").dueDate, null);
  assert.equal(a("Monthly review").dueDate, null);
});

test("sets priority from context", () => {
  assert.equal(a("URGENT: fix login bug blocking release").priority, "urgent");
  assert.equal(a("Pay rent today").priority, "urgent");
  assert.equal(a("Call the dentist tomorrow").priority, "high");
  assert.equal(a("Buy milk").priority, "low");
  assert.equal(a("Someday learn to play guitar").priority, "low");
  assert.equal(a("Organize the garage").priority, "medium");
});

test("priority rises as the deadline approaches", () => {
  const far = C.analyze("Submit report", { now, dueDate: "2026-12-20" });
  const near = C.analyze("Submit report", { now, dueDate: "2026-11-16" });
  const overdue = C.analyze("Submit report", { now, dueDate: "2026-11-10" });
  assert.ok(far.score < near.score && near.score < overdue.score);
  assert.ok(overdue.reasons.some((r) => r.startsWith("Overdue")));
});

test("explains its reasoning", () => {
  const r = a("Important: pay the bill tomorrow").reasons.join(" | ");
  assert.match(r, /Finance/);
  assert.match(r, /Due tomorrow/);
  assert.match(r, /importance/);
});
