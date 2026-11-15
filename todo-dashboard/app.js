(function () {
  "use strict";

  const C = window.TodoClassifier;
  const STORAGE_KEY = "smart-todo.v1";
  const THEME_KEY = "smart-todo.theme";
  const PRIORITY_LABEL = { urgent: "Urgent", high: "High", medium: "Medium", low: "Low" };

  const $ = (sel) => document.querySelector(sel);
  const state = {
    tasks: load(),
    group: "priority",
    category: "All",
    search: "",
    showDone: false,
  };

  // ---------- persistence ----------
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) { /* storage unavailable */ }
    return seed();
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks)); } catch (_) { /* ignore */ }
  }

  function seed() {
    const examples = [
      "Prepare client presentation for Monday meeting",
      "Pay rent by Friday",
      "URGENT: fix login bug blocking release",
      "Call the dentist tomorrow to book a checkup",
      "Buy groceries: milk, eggs, bread",
      "Someday learn to play guitar",
      "Study for the final exam in 3 days",
      "Book flight and hotel for the December trip",
      "Mom's birthday dinner next week",
      "Clean the kitchen and do laundry",
    ];
    return examples.map((text) => newTask(text));
  }

  function newTask(text) {
    const detected = C.extractDueDate(text);
    return {
      id: Math.random().toString(36).slice(2) + Date.now().toString(36),
      text,
      createdAt: new Date().toISOString(),
      done: false,
      // Detected due date is frozen at creation so "tomorrow" stays tomorrow.
      dueDate: detected ? C.toISODate(detected.date) : null,
      categoryOverride: null,
      priorityOverride: null,
    };
  }

  // Analysis is recomputed on every render so auto-priority rises as deadlines approach.
  function analyzed(task) {
    const a = C.analyze(task.text, { dueDate: task.dueDate || undefined });
    const category = task.categoryOverride || a.category;
    const priority = task.priorityOverride || a.priority;
    const reasons = a.reasons.slice();
    if (task.categoryOverride) reasons.unshift(`Category set manually to ${category}`);
    if (task.priorityOverride) reasons.unshift(`Priority set manually to ${PRIORITY_LABEL[priority]}`);
    return {
      ...task,
      category,
      icon: C.categoryIcon(category),
      priority,
      score: task.priorityOverride ? { urgent: 90, high: 65, medium: 45, low: 15 }[priority] : a.score,
      reasons,
    };
  }

  // ---------- rendering helpers ----------
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function dueBadge(iso, done) {
    if (!iso) return null;
    const days = C.daysBetween(new Date(), C.parseISODate(iso));
    let label;
    if (days < 0) label = `Overdue ${-days}d`;
    else if (days === 0) label = "Due today";
    else if (days === 1) label = "Due tomorrow";
    else if (days < 7) label = `Due ${C.parseISODate(iso).toLocaleDateString(undefined, { weekday: "short" })}`;
    else label = `Due ${C.parseISODate(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
    const b = el("span", "badge" + (days < 0 && !done ? " overdue" : ""), "📅 " + label);
    b.title = iso;
    return b;
  }

  function priorityBadge(p, manual) {
    const b = el("span", `badge p-${p}` + (manual ? " manual" : ""), PRIORITY_LABEL[p]);
    if (manual) b.title = "Set manually";
    return b;
  }

  function categoryBadge(cat, icon, manual) {
    const b = el("span", "badge" + (manual ? " manual" : ""), `${icon} ${cat}`);
    if (manual) b.title = "Set manually";
    return b;
  }

  // ---------- live preview ----------
  function renderPreview() {
    const text = $("#taskInput").value.trim();
    const box = $("#preview");
    box.replaceChildren();
    if (!text) {
      box.append(el("span", null, "Detected category and priority will show here as you type."));
      return;
    }
    const a = C.analyze(text);
    box.append(el("span", null, "Detected:"), categoryBadge(a.category, a.icon), priorityBadge(a.priority));
    const d = dueBadge(a.dueDate);
    if (d) box.append(d);
    if (a.reasons.length) box.append(el("span", null, "· " + a.reasons[a.reasons.length > 1 ? 1 : 0]));
  }

  // ---------- main render ----------
  function render() {
    const all = state.tasks.map(analyzed);
    renderStats(all);
    renderChips(all);

    const q = state.search.toLowerCase();
    const visible = all.filter((t) =>
      (state.showDone || !t.done) &&
      (state.category === "All" || t.category === state.category) &&
      (!q || t.text.toLowerCase().includes(q))
    );

    const groups = state.group === "priority"
      ? C.PRIORITIES.map((p) => ({ key: p, title: PRIORITY_LABEL[p], items: visible.filter((t) => t.priority === p), priority: p }))
      : C.CATEGORY_NAMES
          .map((c) => ({ key: c, title: `${C.categoryIcon(c)} ${c}`, items: visible.filter((t) => t.category === c) }))
          .filter((g) => g.items.length);

    const board = $("#board");
    board.replaceChildren();
    if (!groups.length) {
      board.append(el("p", "empty", "Nothing here. Add a task above or change the filters."));
      return;
    }
    for (const g of groups) {
      g.items.sort(compareTasks);
      const col = el("div", "column");
      if (g.priority) col.dataset.priority = g.priority;
      const head = el("div", "column-head");
      head.append(el("span", "title", g.title), el("span", "count", String(g.items.length)));
      col.append(head);
      if (!g.items.length) col.append(el("p", "empty", "No tasks"));
      for (const t of g.items) col.append(renderCard(t));
      board.append(col);
    }
  }

  function compareTasks(a, b) {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (b.score !== a.score) return b.score - a.score;
    const ad = a.dueDate || "9999", bd = b.dueDate || "9999";
    return ad.localeCompare(bd);
  }

  function renderCard(t) {
    const node = $("#cardTpl").content.firstElementChild.cloneNode(true);
    node.dataset.priority = t.priority;
    node.dataset.id = t.id;
    if (t.done) node.classList.add("done");
    node.querySelector(".card-text").textContent = t.text;
    const meta = node.querySelector(".card-meta");
    meta.append(priorityBadge(t.priority, !!t.priorityOverride), categoryBadge(t.category, t.icon, !!t.categoryOverride));
    const d = dueBadge(t.dueDate, t.done);
    if (d) meta.append(d);
    const ul = node.querySelector(".why ul");
    for (const r of t.reasons.length ? t.reasons : ["No strong signals found, defaulting to Medium"]) ul.append(el("li", null, r));
    const toggle = node.querySelector(".done-toggle");
    toggle.checked = t.done;
    toggle.addEventListener("change", () => update(t.id, { done: toggle.checked }));
    node.querySelector(".delete").addEventListener("click", () => {
      state.tasks = state.tasks.filter((x) => x.id !== t.id);
      save(); render();
    });
    node.querySelector(".edit").addEventListener("click", () => openEdit(t.id));
    return node;
  }

  function renderStats(all) {
    const open = all.filter((t) => !t.done);
    $("#statOpen").textContent = open.length;
    $("#statUrgent").textContent = open.filter((t) => t.priority === "urgent").length;
    $("#statToday").textContent = open.filter((t) => t.dueDate && C.daysBetween(new Date(), C.parseISODate(t.dueDate)) <= 0).length;
    $("#statDone").textContent = all.length ? Math.round(((all.length - open.length) / all.length) * 100) + "%" : "0%";
  }

  function renderChips(all) {
    const box = $("#categoryChips");
    box.replaceChildren();
    const pool = all.filter((t) => state.showDone || !t.done);
    const counts = {};
    for (const t of pool) counts[t.category] = (counts[t.category] || 0) + 1;
    const names = ["All"].concat(C.CATEGORY_NAMES.filter((c) => counts[c]));
    if (state.category !== "All" && !counts[state.category]) state.category = "All";
    for (const name of names) {
      const chip = el("button", "chip" + (state.category === name ? " active" : ""));
      chip.type = "button";
      chip.textContent = name === "All" ? "All" : `${C.categoryIcon(name)} ${name}`;
      chip.append(el("span", "count", String(name === "All" ? pool.length : counts[name])));
      chip.addEventListener("click", () => { state.category = name; render(); });
      box.append(chip);
    }
  }

  function update(id, patch) {
    const t = state.tasks.find((x) => x.id === id);
    if (!t) return;
    Object.assign(t, patch);
    save(); render();
  }

  // ---------- edit dialog ----------
  let editingId = null;
  function openEdit(id) {
    const t = state.tasks.find((x) => x.id === id);
    if (!t) return;
    editingId = id;
    $("#editText").value = t.text;
    $("#editCategory").value = t.categoryOverride || "";
    $("#editPriority").value = t.priorityOverride || "";
    $("#editDue").value = t.dueDate || "";
    $("#editDialog").showModal();
  }

  function setupEdit() {
    const catSel = $("#editCategory"), priSel = $("#editPriority");
    catSel.append(new Option("Auto (from context)", ""));
    for (const c of C.CATEGORY_NAMES) catSel.append(new Option(`${C.categoryIcon(c)} ${c}`, c));
    priSel.append(new Option("Auto (from context)", ""));
    for (const p of C.PRIORITIES) priSel.append(new Option(PRIORITY_LABEL[p], p));

    $("#editDialog").addEventListener("close", () => {
      if ($("#editDialog").returnValue !== "save" || !editingId) return;
      const t = state.tasks.find((x) => x.id === editingId);
      const text = $("#editText").value.trim();
      if (!t || !text) return;
      const textChanged = text !== t.text;
      let due = $("#editDue").value || null;
      // If the text changed and the date wasn't touched, re-detect from the new text.
      if (textChanged && due === t.dueDate) {
        const found = C.extractDueDate(text);
        due = found ? C.toISODate(found.date) : null;
      }
      update(editingId, {
        text,
        dueDate: due,
        categoryOverride: catSel.value || null,
        priorityOverride: priSel.value || null,
      });
      editingId = null;
    });
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
    if (!text) return;
    state.tasks.unshift(newTask(text));
    input.value = "";
    save(); renderPreview(); render();
  });
  $("#taskInput").addEventListener("input", renderPreview);
  $("#search").addEventListener("input", (e) => { state.search = e.target.value; render(); });
  $("#showDone").addEventListener("change", (e) => { state.showDone = e.target.checked; render(); });
  document.querySelectorAll(".segmented button").forEach((b) =>
    b.addEventListener("click", () => {
      state.group = b.dataset.group;
      document.querySelectorAll(".segmented button").forEach((x) => x.classList.toggle("active", x === b));
      render();
    })
  );

  setupTheme();
  setupEdit();
  renderPreview();
  render();
  save();
  // Refresh once an hour so "due tomorrow" turns into "due today" without reloading.
  setInterval(render, 60 * 60 * 1000);
})();
