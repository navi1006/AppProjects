# Smart To-Do Dashboard

A to-do dashboard that reads what you type and works out the **category**, **due date** and **priority** for you.

Open `index.html` in a browser. There's no build step and nothing to install. Tasks are saved in your browser's localStorage.

## How it works

`classifier.js` is a rule-based engine that runs entirely in the browser:

| Signal | Examples | Effect |
| --- | --- | --- |
| Category keywords | "client", "rent", "dentist", "groceries", "exam", "flight" | Picks Work, Finance, Health, Shopping, Learning, Travel, Home, Social or General |
| Due dates | "today", "tomorrow", "by Friday", "next monday", "in 3 days", "Dec 3", "11/20", "2026-12-01", "end of month" | Sets a due date; the closer it is, the higher the priority |
| Urgency words | "urgent", "ASAP", "blocking", "!!!" | Big priority boost |
| Importance words | "must", "deadline", "boss", "late fee", "expires" | Moderate boost |
| Low-urgency words | "someday", "maybe", "no rush", "nice to have" | Lowers priority |
| Category weight | Health and Finance > Work > Shopping | Small adjustment |

These add up to a 0–100 score, which maps to **Urgent** (75+), **High** (55+), **Medium** (30+) or **Low**. Each card has a "Why this priority?" section listing the reasons.

Auto priority is recalculated on every render, so a task due Friday moves up as Friday gets closer and goes to Urgent once it's overdue. You can override the category, priority or due date with the ✎ button; set either one back to *Auto* to hand control back to the classifier.

## Features

- Live preview of the detected category and priority as you type
- Summary tiles: open, urgent, due today or overdue, % completed
- Board grouped by priority or by category, with category filter chips and search
- Light and dark themes; works on phones

## Tests

```
node --test tests/*.test.js
```
