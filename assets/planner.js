// Day Planner: everything lives in this browser's localStorage, keyed by date.
// Shape: { days: { "YYYY-MM-DD": { draft: "", tasks: [{ id, title, time, done }] } }, dayCount: 7 }
(function () {
  "use strict";

  const STORAGE_KEY = "day-planner:v1";
  const DEFAULT_DAY_COUNT = 7;

  // A saved day in any other shape (hand-edited, or from an older page) is read
  // as far as it goes rather than breaking the whole page.
  function cleanDay(day) {
    const tasks = day && Array.isArray(day.tasks) ? day.tasks : [];
    return {
      draft: day && typeof day.draft === "string" ? day.draft : "",
      tasks: tasks.filter((task) => task && typeof task === "object").map((task) => ({
        id: typeof task.id === "string" && task.id ? task.id : newId(),
        title: typeof task.title === "string" ? task.title : "",
        time: typeof task.time === "string" ? task.time : "",
        done: Boolean(task.done),
      })),
    };
  }

  function load() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      const days = {};
      if (parsed.days && typeof parsed.days === "object") {
        for (const [key, day] of Object.entries(parsed.days)) {
          if (/^\d{4}-\d{2}-\d{2}$/.test(key)) days[key] = cleanDay(day);
        }
      }
      return {
        days,
        dayCount: Number.isInteger(parsed.dayCount) && parsed.dayCount > 0 ? parsed.dayCount : DEFAULT_DAY_COUNT,
      };
    } catch (_error) {
      return { days: {}, dayCount: DEFAULT_DAY_COUNT };
    }
  }

  let state = load();

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function dateKey(date) {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  }

  function todayKey() {
    return dateKey(new Date());
  }

  function addDays(date, count) {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    next.setDate(next.getDate() + count);
    return next;
  }

  function parseKey(key) {
    const [year, month, day] = key.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  // Past days disappear: anything dated before today is dropped from storage.
  function dropPastDays() {
    const today = todayKey();
    let changed = false;
    for (const key of Object.keys(state.days)) {
      if (key < today) {
        delete state.days[key];
        changed = true;
      }
    }
    if (changed) save();
  }

  function dayData(key) {
    if (!state.days[key]) state.days[key] = { draft: "", tasks: [] };
    return state.days[key];
  }

  function hasContent(day) {
    return Boolean(day && (day.draft.trim() || day.tasks.length));
  }

  // Forget days the user never touched, so storage only holds real entries.
  function pruneEmpty(key) {
    if (state.days[key] && !hasContent(state.days[key])) delete state.days[key];
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function visibleDayKeys() {
    const start = new Date();
    const keys = [];
    for (let i = 0; i < state.dayCount; i++) keys.push(dateKey(addDays(start, i)));
    // Days further out that already have something written stay visible too.
    for (const key of Object.keys(state.days)) {
      if (!keys.includes(key) && key > keys[keys.length - 1] && hasContent(state.days[key])) keys.push(key);
    }
    return keys.sort();
  }

  function relativeLabel(key) {
    const today = new Date();
    if (key === dateKey(today)) return "Today";
    if (key === dateKey(addDays(today, 1))) return "Tomorrow";
    return "";
  }

  function headingText(key) {
    const date = parseKey(key);
    const options = { weekday: "long", month: "long", day: "numeric" };
    if (date.getFullYear() !== new Date().getFullYear()) options.year = "numeric";
    return date.toLocaleDateString(undefined, options);
  }

  function autoGrow(textarea) {
    textarea.style.height = "auto";
    textarea.style.height = textarea.scrollHeight + 2 + "px";
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs || {})) {
      if (name === "text") node.textContent = value;
      else node.setAttribute(name, value);
    }
    for (const child of children || []) node.appendChild(child);
    return node;
  }

  function renderTask(key, task, list) {
    const checkbox = el("input", { type: "checkbox", "aria-label": "Done" });
    checkbox.checked = Boolean(task.done);
    const title = el("input", {
      type: "text", class: "title", placeholder: "Task", "aria-label": "Task", value: task.title || "",
    });
    const time = el("input", {
      type: "text", class: "time", placeholder: "time", "aria-label": "Time", value: task.time || "",
    });
    const remove = el("button", { type: "button", class: "remove", title: "Remove task", "aria-label": "Remove task", text: "×" });
    const row = el("li", { class: "task" + (task.done ? " done" : ""), "data-task-id": task.id }, [checkbox, title, time, remove]);

    checkbox.addEventListener("change", () => {
      task.done = checkbox.checked;
      row.classList.toggle("done", task.done);
      save();
    });
    title.addEventListener("input", () => { task.title = title.value; save(); });
    time.addEventListener("input", () => { task.time = time.value; save(); });

    title.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addTask(key, list, task.id);
      } else if (event.key === "Backspace" && title.value === "" && time.value === "") {
        event.preventDefault();
        removeTask(key, list, task.id, true);
      }
    });
    time.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addTask(key, list, task.id);
      }
    });
    remove.addEventListener("click", () => removeTask(key, list, task.id, false));
    return row;
  }

  function renderTasks(key, list) {
    list.replaceChildren(...dayData(key).tasks.map((task) => renderTask(key, task, list)));
    pruneEmpty(key);
  }

  function focusTask(list, id) {
    const row = list.querySelector(`[data-task-id="${id}"] .title`);
    if (row) row.focus();
  }

  function addTask(key, list, afterId) {
    const day = dayData(key);
    const task = { id: newId(), title: "", time: "", done: false };
    const index = afterId ? day.tasks.findIndex((t) => t.id === afterId) : -1;
    if (index >= 0) day.tasks.splice(index + 1, 0, task);
    else day.tasks.push(task);
    save();
    renderTasks(key, list);
    focusTask(list, task.id);
  }

  function removeTask(key, list, id, focusPrevious) {
    const day = dayData(key);
    const index = day.tasks.findIndex((t) => t.id === id);
    if (index < 0) return;
    day.tasks.splice(index, 1);
    const previous = day.tasks[index - 1];
    pruneEmpty(key);
    save();
    renderTasks(key, list);
    if (focusPrevious && previous) {
      const input = list.querySelector(`[data-task-id="${previous.id}"] .title`);
      if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    }
  }

  function renderDay(key) {
    const label = relativeLabel(key);
    const heading = el("h2", { class: "day-heading" }, label ? [el("span", { class: "relative", text: label })] : []);
    heading.appendChild(document.createTextNode(headingText(key)));

    const day = state.days[key] || { draft: "", tasks: [] };
    const draft = el("textarea", {
      class: "draft",
      rows: "2",
      "aria-label": "Draft for " + headingText(key),
      placeholder: label === "Today" ? "Everything on your mind for today..." : "Anything you want to get to this day...",
    });
    draft.value = day.draft;
    draft.addEventListener("input", () => {
      dayData(key).draft = draft.value;
      pruneEmpty(key);
      save();
      autoGrow(draft);
    });

    const list = el("ul", { class: "tasks" });
    const add = el("button", { type: "button", class: "add-task", text: "+ Add a task" });
    add.addEventListener("click", () => addTask(key, list, null));

    const section = el("section", { class: "day", id: "day-" + key, "data-date": key }, [heading, draft, list, add]);
    renderTasks(key, list);
    return { section, draft };
  }

  let renderedFor = null;

  function render() {
    dropPastDays();
    renderedFor = todayKey();
    const main = document.getElementById("days");
    const rendered = visibleDayKeys().map(renderDay);
    const more = el("button", { type: "button", class: "more-days", text: "Show another week" });
    more.addEventListener("click", () => {
      state.dayCount += 7;
      save();
      render();
    });
    main.replaceChildren(...rendered.map((r) => r.section), more);
    rendered.forEach((r) => autoGrow(r.draft));
  }

  // Roll over at midnight (and when the page comes back after being hidden).
  function checkForNewDay() {
    if (todayKey() !== renderedFor) render();
  }

  // Keep other open copies of the page in step.
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) {
      state = load();
      render();
    }
  });
  setInterval(checkForNewDay, 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkForNewDay(); });
  window.addEventListener("resize", () => document.querySelectorAll("textarea.draft").forEach(autoGrow));

  render();
})();
