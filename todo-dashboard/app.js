(function () {
  "use strict";

  const C = window.TodoClassifier;
  const STORAGE_KEY = "smart-todo.v1";
  const LEARN_KEY = "smart-todo.learned";
  const THEME_KEY = "smart-todo.theme";
  const PRIORITY_LABEL = { urgent: "Urgent", high: "High", medium: "Medium", low: "Low" };
  const REPEATS = {
    day: { freq: "day", interval: 1, label: "Every day" },
    weekday: { freq: "weekday", interval: 1, label: "Every weekday" },
    week: { freq: "week", interval: 1, label: "Every week" },
    week2: { freq: "week", interval: 2, label: "Every 2 weeks" },
    month: { freq: "month", interval: 1, label: "Every month" },
    year: { freq: "year", interval: 1, label: "Every year" },
  };

  const $ = (sel) => document.querySelector(sel);
  const state = {
    tasks: [],
    learned: C.emptyLearned(),
    group: "priority",
    category: "All",
    search: "",
  };

  // ---------- persistence ----------
  function readJSON(key) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (_) { return null; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* storage full or blocked */ }
  }
  function save() { writeJSON(STORAGE_KEY, state.tasks); writeJSON(LEARN_KEY, state.learned); }

  // Bring tasks saved by older versions up to date.
  function migrate(t) {
    const out = { dueTime: null, recur: null, example: false, doneAt: null, ...t };
    if (out.categoryOverride && C.CATEGORY_ALIASES[out.categoryOverride]) out.categoryOverride = C.CATEGORY_ALIASES[out.categoryOverride];
    return out;
  }

  function load() {
    const saved = readJSON(STORAGE_KEY);
    state.tasks = Array.isArray(saved) ? saved.map(migrate) : seed();
    const learned = readJSON(LEARN_KEY);
    if (learned && learned.cat && learned.pri) state.learned = learned;
  }

  function seed() {
    return [
      "URGENT: fix login bug blocking the release",
      "Prepare client presentation for Monday's meeting",
      "Pay rent on the 1st",
      "Call the dentist tomorrow to book a checkup",
      "Pick up kids from school at 3pm",
      "Weekly team sync every Monday at 10am",
      "Study for the final exam in 3 days",
      "Book flight and hotel for the December trip",
      "Buy groceries: milk, eggs, bread",
      "Not urgent: sort old photos",
      "Someday learn to play guitar",
    ].map((text) => ({ ...newTask(text), example: true }));
  }

  function newTask(text) {
    const a = C.analyze(text, { learned: state.learned });
    return {
      id: Math.random().toString(36).slice(2) + Date.now().toString(36),
      text,
      createdAt: new Date().toISOString(),
      done: false,
      doneAt: null,
      // Date, time and repeat are fixed when the task is added, so "tomorrow" stays tomorrow.
      dueDate: a.dueDate,
      dueTime: a.dueTime,
      recur: a.recurrence,
      categoryOverride: null,
      priorityOverride: null,
      example: false,
    };
  }

  // Analysis runs on every render, so auto priority rises as deadlines approach.
  function auto(task) {
    return C.analyze(task.text, { dueDate: task.dueDate, dueTime: task.dueTime, recurrence: task.recur, learned: state.learned });
  }

  function view(task) {
    const a = auto(task);
    const category = task.categoryOverride || a.category;
    const priority = task.priorityOverride || a.priority;
    const reasons = a.reasons.slice();
    if (task.categoryOverride) reasons.unshift(`You set the category to ${category}`);
    if (task.priorityOverride) reasons.unshift(`You set the priority to ${PRIORITY_LABEL[priority]}`);
    return {
      ...task,
      auto: a,
      category,
      icon: C.categoryIcon(category),
      priority,
      score: task.priorityOverride ? C.LEVEL_SCORE[priority] : a.score,
      quick: a.quick,
      reasons,
    };
  }

  // ---------- small DOM helpers ----------
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function dueInfo(t) {
    if (!t.dueDate) return null;
    const date = C.parseISODate(t.dueDate);
    const days = C.daysBetween(new Date(), date);
    const time = t.dueTime ? " " + C.formatTime(t.dueTime) : "";
    let overdue = days < 0;
    if (days === 0 && t.dueTime) {
      const [h, m] = t.dueTime.split(":").map(Number);
      const at = new Date(date); at.setHours(h, m);
      overdue = at < new Date();
    }
    let label;
    if (days < 0) label = `Overdue ${-days}d`;
    else if (days === 0) label = (overdue ? "Was due" : "Today") + time;
    else if (days === 1) label = "Tomorrow" + time;
    else if (days < 7) label = date.toLocaleDateString(undefined, { weekday: "short" }) + time;
    else label = date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + time;
    return { label, overdue, days };
  }

  function dueBadge(t) {
    const info = dueInfo(t);
    if (!info) return null;
    const b = el("span", "badge" + (info.overdue && !t.done ? " overdue" : ""), "📅 " + info.label);
    b.title = t.dueDate + (t.dueTime ? " " + t.dueTime : "");
    return b;
  }

  function priorityBadge(p) { return el("span", `badge p-${p}`, PRIORITY_LABEL[p]); }
  function categoryBadge(cat, icon) { return el("span", "badge", `${icon} ${cat}`); }

  // A select that looks like a badge: one tap to change priority or category.
  function prioritySelect(t) {
    const s = el("select", `badge-select p-${t.priority}`);
    s.setAttribute("aria-label", "Priority");
    for (const p of C.PRIORITIES) s.append(new Option(PRIORITY_LABEL[p] + (t.priorityOverride ? "" : p === t.priority ? " · auto" : ""), p));
    if (t.priorityOverride) s.append(new Option(`↺ Auto (${PRIORITY_LABEL[t.auto.priority]})`, "auto"));
    s.value = t.priority;
    s.addEventListener("change", () => setPriority(t.id, s.value));
    return s;
  }

  function categorySelect(t) {
    const s = el("select", "badge-select");
    s.setAttribute("aria-label", "Category");
    for (const c of C.CATEGORY_NAMES) s.append(new Option(`${C.categoryIcon(c)} ${c}`, c));
    if (t.categoryOverride) s.append(new Option(`↺ Auto (${t.auto.category})`, "auto"));
    s.value = t.category;
    s.addEventListener("change", () => setCategory(t.id, s.value));
    return s;
  }

  // ---------- corrections (and learning from them) ----------
  function setPriority(id, value) {
    const task = find(id);
    if (!task) return;
    const a = auto(task);
    if (value === "auto" || value === a.priority) {
      task.priorityOverride = null;
    } else {
      task.priorityOverride = value;
      C.learn(state.learned, task.text, { priorityDelta: C.LEVEL_SCORE[value] - a.score });
    }
    commit();
  }

  function setCategory(id, value) {
    const task = find(id);
    if (!task) return;
    const a = auto(task);
    if (value === "auto" || value === a.category) {
      task.categoryOverride = null;
    } else {
      task.categoryOverride = value;
      C.learn(state.learned, task.text, { category: value });
    }
    commit();
  }

  // ---------- live preview while typing ----------
  function renderPreview() {
    const text = $("#taskInput").value.trim();
    const box = $("#preview");
    box.replaceChildren();
    if (!text) {
      box.append(el("span", "muted", "Category, priority, date and repeat show here as you type."));
      return;
    }
    const a = C.analyze(text, { learned: state.learned });
    box.append(priorityBadge(a.priority), categoryBadge(a.category, a.icon));
    const d = dueBadge({ dueDate: a.dueDate, dueTime: a.dueTime });
    if (d) box.append(d);
    if (a.recurrence) box.append(el("span", "badge", "🔁 " + a.recurrence.label));
    if (a.quick) box.append(el("span", "badge", "⚡ Quick"));
    if (!a.dueDate) box.append(el("span", "muted", "No date found. Add one like “tomorrow” or “Fri 3pm”."));
    else {
      const why = a.reasons.find((r) => !r.startsWith("Categorized")) || a.reasons[0];
      if (why) box.append(el("span", "muted", why));
    }
  }

  // ---------- main render ----------
  function render() {
    const all = state.tasks.map(view);
    const open = all.filter((t) => !t.done);
    renderStats(open);
    renderFocus(open);
    renderChips(open);
    $("#examplesBanner").hidden = !state.tasks.some((t) => t.example);

    const q = state.search.trim().toLowerCase();
    const matches = (t) => (state.category === "All" || t.category === state.category) && (!q || t.text.toLowerCase().includes(q));
    const visible = open.filter(matches);

    const groups = state.group === "priority"
      ? C.PRIORITIES.map((p) => ({ title: PRIORITY_LABEL[p], items: visible.filter((t) => t.priority === p), priority: p }))
      : C.CATEGORY_NAMES
          .map((c) => ({ title: `${C.categoryIcon(c)} ${c}`, items: visible.filter((t) => t.category === c) }))
          .filter((g) => g.items.length);

    const board = $("#board");
    board.replaceChildren();
    if (!open.length) {
      board.append(el("p", "empty big", state.tasks.length ? "All done. Nice work." : "No tasks yet. Type one above and press Add."));
    } else if (!visible.length) {
      board.append(el("p", "empty big", "No tasks match this filter."));
    } else {
      for (const g of groups) {
        g.items.sort(compareTasks);
        const col = el("section", "column");
        if (g.priority) col.dataset.priority = g.priority;
        const head = el("h2", "column-head");
        head.append(el("span", "title", g.title), el("span", "count", String(g.items.length)));
        col.append(head);
        if (!g.items.length) col.append(el("p", "empty", "Nothing here"));
        for (const t of g.items) col.append(renderCard(t));
        board.append(col);
      }
    }

    const done = all.filter((t) => t.done && matches(t)).sort((a, b) => (b.doneAt || "").localeCompare(a.doneAt || ""));
    $("#doneSection").hidden = !all.some((t) => t.done);
    $("#doneTitle").textContent = `Completed (${all.filter((t) => t.done).length})`;
    $("#doneList").replaceChildren(...done.map(renderCard));
  }

  function compareTasks(a, b) {
    if (b.score !== a.score) return b.score - a.score;
    const ad = (a.dueDate || "9999") + (a.dueTime || "99"), bd = (b.dueDate || "9999") + (b.dueTime || "99");
    if (ad !== bd) return ad.localeCompare(bd);
    return (b.quick ? 1 : 0) - (a.quick ? 1 : 0);
  }

  function renderCard(t) {
    const node = $("#cardTpl").content.firstElementChild.cloneNode(true);
    node.dataset.priority = t.priority;
    if (t.done) node.classList.add("done");
    node.querySelector(".card-text").textContent = t.text;

    const meta = node.querySelector(".card-meta");
    if (t.done) meta.append(priorityBadge(t.priority), categoryBadge(t.category, t.icon));
    else meta.append(prioritySelect(t), categorySelect(t));
    const d = dueBadge(t);
    if (d) meta.append(d);
    if (t.recur) meta.append(el("span", "badge", "🔁 " + t.recur.label));
    if (t.quick && !t.done) meta.append(el("span", "badge", "⚡ Quick"));

    const ul = node.querySelector(".why ul");
    for (const r of t.reasons.length ? t.reasons : ["No strong signals, so it sits in Medium"]) ul.append(el("li", null, r));

    const toggle = node.querySelector(".done-toggle");
    toggle.checked = t.done;
    toggle.setAttribute("aria-label", (t.done ? "Mark not done: " : "Mark done: ") + t.text);
    toggle.addEventListener("change", () => toggleDone(t.id, toggle.checked));

    const snooze = node.querySelector(".snooze");
    if (t.done) snooze.remove();
    else {
      snooze.setAttribute("aria-label", "Snooze to tomorrow: " + t.text);
      snooze.addEventListener("click", () => snoozeTask(t.id));
    }
    const edit = node.querySelector(".edit");
    edit.setAttribute("aria-label", "Edit: " + t.text);
    edit.addEventListener("click", () => openEdit(t.id));
    const del = node.querySelector(".delete");
    del.setAttribute("aria-label", "Delete: " + t.text);
    del.addEventListener("click", () => deleteTask(t.id));
    return node;
  }

  function renderStats(open) {
    const info = open.map(dueInfo);
    const overdue = info.filter((i) => i && i.overdue).length;
    $("#statOpen").textContent = open.length;
    $("#statUrgent").textContent = open.filter((t) => t.priority === "urgent").length;
    $("#statToday").textContent = info.filter((i) => i && i.days === 0 && !i.overdue).length;
    $("#statOverdue").textContent = overdue;
    $("#statOverdueTile").dataset.tone = overdue ? "urgent" : "";
  }

  // The three tasks that matter most right now.
  function renderFocus(open) {
    const top = open.filter((t) => t.priority !== "low").sort(compareTasks).slice(0, 3);
    $("#focus").hidden = !top.length;
    const list = $("#focusList");
    list.replaceChildren();
    for (const t of top) {
      const li = el("li", "focus-item");
      li.dataset.priority = t.priority;
      const box = el("input");
      box.type = "checkbox";
      box.setAttribute("aria-label", "Mark done: " + t.text);
      box.addEventListener("change", () => toggleDone(t.id, true));
      const text = el("span", "focus-text", t.text);
      const info = dueInfo(t);
      li.append(box, text);
      if (info) li.append(el("span", "focus-due" + (info.overdue ? " overdue" : ""), info.label));
      list.append(li);
    }
  }

  function renderChips(open) {
    const box = $("#categoryChips");
    box.replaceChildren();
    const counts = {};
    for (const t of open) counts[t.category] = (counts[t.category] || 0) + 1;
    if (state.category !== "All" && !counts[state.category]) state.category = "All";
    const names = ["All"].concat(C.CATEGORY_NAMES.filter((c) => counts[c]));
    if (names.length <= 2) return; // a filter with one option is noise
    for (const name of names) {
      const chip = el("button", "chip" + (state.category === name ? " active" : ""));
      chip.type = "button";
      chip.setAttribute("aria-pressed", String(state.category === name));
      chip.textContent = name === "All" ? "All" : `${C.categoryIcon(name)} ${name}`;
      chip.append(el("span", "count", String(name === "All" ? open.length : counts[name])));
      chip.addEventListener("click", () => { state.category = name; render(); });
      box.append(chip);
    }
  }

  // ---------- actions with undo ----------
  const find = (id) => state.tasks.find((x) => x.id === id);
  function commit() { save(); render(); }

  let toastTimer = null;
  let undoFn = null;
  function toast(message, undo) {
    $("#toastText").textContent = message;
    $("#toastUndo").hidden = !undo;
    undoFn = undo || null;
    $("#toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $("#toast").hidden = true; undoFn = null; }, 6000);
  }
  function snapshot() { return JSON.stringify(state.tasks); }
  function restore(snap) { state.tasks = JSON.parse(snap); commit(); }

  function toggleDone(id, done) {
    const task = find(id);
    if (!task) return;
    const snap = snapshot();
    if (done && task.recur) {
      // Repeating task: move it to its next date instead of closing it.
      const next = C.nextOccurrence(task.dueDate || C.toISODate(new Date()), task.recur);
      task.dueDate = next;
      commit();
      const label = C.parseISODate(next).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
      toast(`Done. Next one is ${label}.`, () => restore(snap));
      return;
    }
    task.done = done;
    task.doneAt = done ? new Date().toISOString() : null;
    commit();
    if (done) toast(`Completed “${short(task.text)}”`, () => restore(snap));
  }

  function deleteTask(id) {
    const task = find(id);
    if (!task) return;
    const snap = snapshot();
    state.tasks = state.tasks.filter((x) => x.id !== id);
    commit();
    toast(`Deleted “${short(task.text)}”`, () => restore(snap));
  }

  function snoozeTask(id) {
    const task = find(id);
    if (!task) return;
    const snap = snapshot();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const current = C.parseISODate(task.dueDate);
    const base = current && current > today ? current : today;
    base.setDate(base.getDate() + 1);
    task.dueDate = C.toISODate(base);
    commit();
    toast(`Snoozed to ${base.toLocaleDateString(undefined, { weekday: "long" })}`, () => restore(snap));
  }

  const short = (s) => (s.length > 40 ? s.slice(0, 38) + "…" : s);

  // ---------- edit dialog ----------
  let editingId = null;
  function openEdit(id) {
    const t = find(id);
    if (!t) return;
    editingId = id;
    const a = auto(t);
    $("#editText").value = t.text;
    $("#editCategory").options[0].text = `Auto (${a.category})`;
    $("#editPriority").options[0].text = `Auto (${PRIORITY_LABEL[a.priority]})`;
    $("#editCategory").value = t.categoryOverride || "";
    $("#editPriority").value = t.priorityOverride || "";
    $("#editDue").value = t.dueDate || "";
    $("#editTime").value = t.dueTime || "";
    $("#editRepeat").value = repeatKey(t.recur);
    $("#editDialog").showModal();
  }

  function repeatKey(r) {
    if (!r) return "";
    if (r.freq === "week") return r.interval === 2 ? "week2" : "week";
    return REPEATS[r.freq] ? r.freq : "";
  }

  function setupEdit() {
    const catSel = $("#editCategory"), priSel = $("#editPriority");
    catSel.append(new Option("Auto", ""));
    for (const c of C.CATEGORY_NAMES) catSel.append(new Option(`${C.categoryIcon(c)} ${c}`, c));
    priSel.append(new Option("Auto", ""));
    for (const p of C.PRIORITIES) priSel.append(new Option(PRIORITY_LABEL[p], p));

    $("#editDialog").addEventListener("close", () => {
      const id = editingId;
      editingId = null;
      if ($("#editDialog").returnValue !== "save" || !id) return;
      const t = find(id);
      const text = $("#editText").value.trim();
      if (!t || !text) return;
      const snap = snapshot();

      let due = $("#editDue").value || null;
      let time = $("#editTime").value || null;
      let recurKey = $("#editRepeat").value;
      // Text changed but the date fields weren't touched: read them again from the new text.
      if (text !== t.text && due === t.dueDate && time === t.dueTime && recurKey === repeatKey(t.recur)) {
        const a = C.analyze(text, { learned: state.learned });
        due = a.dueDate; time = a.dueTime; recurKey = null; t.recur = a.recurrence;
      }
      if (recurKey !== null) {
        const keep = t.recur && repeatKey(t.recur) === recurKey;
        t.recur = recurKey ? (keep ? t.recur : { ...REPEATS[recurKey] }) : null;
      }
      t.text = text;
      t.dueDate = due;
      t.dueTime = time;
      t.example = false;
      commit();
      if (catSel.value) setCategory(id, catSel.value); else { t.categoryOverride = null; }
      if (priSel.value) setPriority(id, priSel.value); else { t.priorityOverride = null; }
      commit();
      toast("Saved", () => restore(snap));
    });
  }

  // ---------- backup ----------
  function exportBackup() {
    const data = JSON.stringify({ app: "smart-todo", version: 2, exportedAt: new Date().toISOString(), tasks: state.tasks, learned: state.learned }, null, 2);
    const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `smart-todo-backup-${C.toISODate(new Date())}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Backup downloaded");
  }

  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const tasks = Array.isArray(data) ? data : data.tasks;
        if (!Array.isArray(tasks) || tasks.some((t) => typeof t.text !== "string")) throw new Error("bad file");
        const snap = snapshot();
        state.tasks = tasks.map(migrate);
        if (data.learned && data.learned.cat) state.learned = data.learned;
        commit();
        toast(`Restored ${tasks.length} task${tasks.length === 1 ? "" : "s"}`, () => restore(snap));
      } catch (_) {
        toast("That file isn't a Smart To-Do backup. Choose a .json file made with Download backup.");
      }
    };
    reader.readAsText(file);
  }

  // ---------- theme ----------
  function setupTheme() {
    let saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (_) { /* ignore */ }
    if (saved) document.documentElement.dataset.theme = saved;
    $("#themeToggle").addEventListener("click", () => {
      const current = document.documentElement.dataset.theme ||
        (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem(THEME_KEY, next); } catch (_) { /* ignore */ }
    });
  }

  // ---------- wiring ----------
  $("#addForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#taskInput");
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    const task = newTask(text);
    state.tasks.unshift(task);
    input.value = "";
    renderPreview();
    commit();
    const v = view(task);
    toast(`Added to ${PRIORITY_LABEL[v.priority]} · ${v.category}`);
  });
  $("#taskInput").addEventListener("input", renderPreview);
  $("#search").addEventListener("input", (e) => { state.search = e.target.value; render(); });
  document.querySelectorAll(".segmented button").forEach((b) =>
    b.addEventListener("click", () => {
      state.group = b.dataset.group;
      document.querySelectorAll(".segmented button").forEach((x) => {
        x.classList.toggle("active", x === b);
        x.setAttribute("aria-pressed", String(x === b));
      });
      render();
    })
  );
  $("#clearExamples").addEventListener("click", () => {
    const snap = snapshot();
    const n = state.tasks.filter((t) => t.example).length;
    state.tasks = state.tasks.filter((t) => !t.example);
    commit();
    toast(`Cleared ${n} example task${n === 1 ? "" : "s"}`, () => restore(snap));
  });
  $("#clearDone").addEventListener("click", () => {
    const snap = snapshot();
    const n = state.tasks.filter((t) => t.done).length;
    state.tasks = state.tasks.filter((t) => !t.done);
    commit();
    toast(`Cleared ${n} completed task${n === 1 ? "" : "s"}`, () => restore(snap));
  });
  $("#toastUndo").addEventListener("click", () => {
    const fn = undoFn;
    $("#toast").hidden = true;
    undoFn = null;
    if (fn) fn();
  });
  $("#exportBtn").addEventListener("click", exportBackup);
  $("#importFile").addEventListener("change", (e) => {
    if (e.target.files[0]) importBackup(e.target.files[0]);
    e.target.value = "";
  });
  // "/" jumps to search, "n" to the new-task box, like most task apps.
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea, select, dialog") || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "/") { e.preventDefault(); $("#search").focus(); }
    else if (e.key === "n") { e.preventDefault(); $("#taskInput").focus(); }
  });

  load();
  setupTheme();
  setupEdit();
  renderPreview();
  render();
  save();
  // Re-check every minute so "in 2h" and "overdue" stay correct while the app is open.
  // Skip a tick while the person is mid-interaction so menus and open explanations don't snap shut.
  setInterval(() => {
    if (document.activeElement && document.activeElement.matches("select, input:not(#taskInput)")) return;
    if (document.querySelector(".why[open]") || $("#editDialog").open) return;
    render();
  }, 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });
})();
