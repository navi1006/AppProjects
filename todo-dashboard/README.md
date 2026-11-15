# Smart To-Do Dashboard

A to-do dashboard that reads what you type and works out the **category**, **due date** and **priority** for you.

Open `index.html` in a browser. There's no build step and nothing to install. Tasks are saved in your browser's localStorage.

## Install on iPhone

The dashboard is an installable web app (PWA). Once it's hosted at an `https://` address:

1. Open that address in **Safari** on the iPhone.
2. Tap the **Share** button, then **Add to Home Screen**, then **Add**.
3. Open it from the new **To-Do** icon. It runs full-screen and works offline.

Hosting options (any static host works; there's no server code):

- **GitHub Pages:** repo Settings → Pages → Pages only serves from the repo root or `/docs`, so move these files to one of those first, then pick the branch and folder under Settings → Pages.
- **Netlify Drop:** drag the `todo-dashboard` folder onto https://app.netlify.com/drop to get a free `https://` address in a few seconds.

Tasks are stored on the phone itself. The Home Screen app keeps its own copy, separate from Safari.

## How it works

`classifier.js` is a rule-based engine that runs entirely on the device. Nothing is sent anywhere.

**What it reads from the text**

| Signal | Examples |
| --- | --- |
| Category | "client", "rent", "dentist", "groceries", "landlord", "kids", "library", "flight" → Work, Finance, Health, Shopping, Home, Family & Friends, Errands, Travel, Learning or General. Specific words count more than generic ones ("landlord" beats "email"). |
| Due date | "today", "tomorrow", "by Friday", "next Monday", "this weekend", "on the 1st", "in 3 days", "Dec 3", "11/20", "2026-12-01", "end of month" |
| Time | "at 3pm", "10:30am", "meeting at 3", "noon", "tonight", "EOD". A time with no day means today. |
| Repeat | "every Monday", "every other Sunday", "daily", "weekdays", "weekly", "monthly", "yearly" |
| Quick task | Short tasks starting with "call", "text", "email", "pay", "order"… get a ⚡ Quick tag |

**How priority is scored** (start at 30, then add or subtract)

| Clue | Points |
| --- | --- |
| Urgent words ("urgent", "ASAP", "blocking", "!!!") | +45 |
| Overdue, or due within 3 hours | +50 |
| Due today / tomorrow / in 2–3 days / this week | +40 / +28 / +18 / +10 |
| Important words ("must", "deadline", "late fee", "don't forget") | +10 each, up to +20 |
| Costly to miss (rent, bills, taxes, passport, prescription, kids pickup…) | +12 |
| Health, Finance, Work category | +5 / +5 / +4 |
| Low-stakes ("pizza", "haircut", "tidy") | −15 |
| "Not urgent", "isn't important" | −25 |
| "Someday", "maybe", "no rush" | −30 |
| Repeating routines | date points × 0.6 |

75+ is **Urgent**, 55+ **High**, 30+ **Medium**, below 30 **Low**. Every card's "Why this priority?" lists the reasons.

**It learns from you.** When you change a task's category or priority, the app remembers the words in that task (ignoring words like "urgent" or "tomorrow" that already carry meaning). Future tasks with those words lean the same way, and the card says so.

## Using it

- **Add** a task in plain words; the preview shows what was detected before you press Add.
- **Do next** at the top shows the three tasks that matter most right now.
- **Change priority or category** by tapping its tag on the card. Choose "↺ Auto" to hand it back.
- **💤 Snooze** pushes a task to tomorrow. **✎ Edit** changes text, date, time and repeat.
- **Completing** a repeating task moves it to its next date. Completed tasks collect in a section at the bottom.
- **Undo** appears after every complete, delete, snooze, clear and restore.
- **Download backup / Restore backup** at the bottom saves your tasks to a file, since they otherwise live only in this browser.
- Keyboard: `n` new task, `/` search.

## Tests

```
node --test tests/*.test.js
```
