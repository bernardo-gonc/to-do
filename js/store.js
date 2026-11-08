// Data layer for the to-do app. No DOM access, so it can be unit-tested in Node.
export const STORAGE_KEY = 'todo-app:v1';
export const SCHEMA_VERSION = 1;
export const INBOX_ID = 'inbox';
export const PRIORITIES = ['low', 'medium', 'high'];

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

export function todayISO(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeTags(tags) {
  const list = Array.isArray(tags) ? tags : String(tags ?? '').split(',');
  const seen = new Set();
  const out = [];
  for (const t of list) {
    const tag = String(t).trim().replace(/^#/, '').toLowerCase();
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}

function emptyState() {
  return { version: SCHEMA_VERSION, lists: [{ id: INBOX_ID, name: 'Inbox' }], tasks: [] };
}

// Validates arbitrary parsed JSON and returns a clean state, or throws.
export function sanitizeState(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.tasks) || !Array.isArray(raw.lists)) {
    throw new Error('Invalid data: expected an object with "lists" and "tasks" arrays.');
  }
  const lists = [{ id: INBOX_ID, name: 'Inbox' }];
  const listIds = new Set([INBOX_ID]);
  for (const l of raw.lists) {
    if (!l || typeof l.id !== 'string' || typeof l.name !== 'string') continue;
    if (listIds.has(l.id) || !l.name.trim()) continue;
    listIds.add(l.id);
    lists.push({ id: l.id, name: l.name.trim() });
  }
  const tasks = [];
  const taskIds = new Set();
  for (const t of raw.tasks) {
    if (!t || typeof t.title !== 'string' || !t.title.trim()) continue;
    const id = typeof t.id === 'string' && !taskIds.has(t.id) ? t.id : newId();
    taskIds.add(id);
    tasks.push({
      id,
      title: t.title.trim(),
      notes: typeof t.notes === 'string' ? t.notes : '',
      done: Boolean(t.done),
      priority: PRIORITIES.includes(t.priority) ? t.priority : 'medium',
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(t.dueDate ?? '') ? t.dueDate : null,
      listId: listIds.has(t.listId) ? t.listId : INBOX_ID,
      tags: normalizeTags(t.tags),
      createdAt: Number.isFinite(t.createdAt) ? t.createdAt : Date.now(),
      completedAt: t.done && Number.isFinite(t.completedAt) ? t.completedAt : null,
    });
  }
  return { version: SCHEMA_VERSION, lists, tasks };
}

export class Store {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.state = this.#load();
  }

  #load() {
    try {
      const text = this.storage?.getItem(STORAGE_KEY);
      if (text) return sanitizeState(JSON.parse(text));
    } catch {
      // Storage unavailable or corrupt: fall through to an empty state.
    }
    return emptyState();
  }

  #save() {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.state));
      return true;
    } catch {
      return false; // Quota exceeded or storage blocked; data stays in memory.
    }
  }

  get lists() { return this.state.lists; }
  get tasks() { return this.state.tasks; }

  // ---- Tasks ----
  addTask({ title, notes = '', priority = 'medium', dueDate = null, listId = INBOX_ID, tags = [] }) {
    const clean = String(title ?? '').trim();
    if (!clean) throw new Error('Title is required.');
    const task = {
      id: newId(),
      title: clean,
      notes: String(notes),
      done: false,
      priority: PRIORITIES.includes(priority) ? priority : 'medium',
      dueDate: dueDate || null,
      listId: this.state.lists.some((l) => l.id === listId) ? listId : INBOX_ID,
      tags: normalizeTags(tags),
      createdAt: Date.now(),
      completedAt: null,
    };
    this.state.tasks.push(task);
    this.#save();
    return task;
  }

  updateTask(id, changes) {
    const task = this.state.tasks.find((t) => t.id === id);
    if (!task) throw new Error('Task not found.');
    if ('title' in changes) {
      const title = String(changes.title).trim();
      if (!title) throw new Error('Title is required.');
      task.title = title;
    }
    if ('notes' in changes) task.notes = String(changes.notes);
    if ('priority' in changes && PRIORITIES.includes(changes.priority)) task.priority = changes.priority;
    if ('dueDate' in changes) task.dueDate = changes.dueDate || null;
    if ('listId' in changes && this.state.lists.some((l) => l.id === changes.listId)) task.listId = changes.listId;
    if ('tags' in changes) task.tags = normalizeTags(changes.tags);
    this.#save();
    return task;
  }

  toggleTask(id) {
    const task = this.state.tasks.find((t) => t.id === id);
    if (!task) throw new Error('Task not found.');
    task.done = !task.done;
    task.completedAt = task.done ? Date.now() : null;
    this.#save();
    return task;
  }

  deleteTask(id) {
    this.state.tasks = this.state.tasks.filter((t) => t.id !== id);
    this.#save();
  }

  clearCompleted() {
    const before = this.state.tasks.length;
    this.state.tasks = this.state.tasks.filter((t) => !t.done);
    this.#save();
    return before - this.state.tasks.length;
  }

  // ---- Lists ----
  addList(name) {
    const clean = String(name ?? '').trim();
    if (!clean) throw new Error('List name is required.');
    if (this.state.lists.some((l) => l.name.toLowerCase() === clean.toLowerCase())) {
      throw new Error('A list with that name already exists.');
    }
    const list = { id: newId(), name: clean };
    this.state.lists.push(list);
    this.#save();
    return list;
  }

  renameList(id, name) {
    const list = this.state.lists.find((l) => l.id === id);
    if (!list) throw new Error('List not found.');
    if (id === INBOX_ID) throw new Error('The Inbox cannot be renamed.');
    const clean = String(name ?? '').trim();
    if (!clean) throw new Error('List name is required.');
    if (this.state.lists.some((l) => l.id !== id && l.name.toLowerCase() === clean.toLowerCase())) {
      throw new Error('A list with that name already exists.');
    }
    list.name = clean;
    this.#save();
    return list;
  }

  // Tasks in the deleted list move to the Inbox.
  deleteList(id) {
    if (id === INBOX_ID) throw new Error('The Inbox cannot be deleted.');
    this.state.lists = this.state.lists.filter((l) => l.id !== id);
    for (const t of this.state.tasks) if (t.listId === id) t.listId = INBOX_ID;
    this.#save();
  }

  allTags() {
    const counts = new Map();
    for (const t of this.state.tasks) for (const tag of t.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts].sort((a, b) => a[0].localeCompare(b[0])).map(([tag, count]) => ({ tag, count }));
  }

  // ---- Backup ----
  exportJSON() {
    return JSON.stringify(this.state, null, 2);
  }

  importJSON(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('File is not valid JSON.');
    }
    this.state = sanitizeState(parsed); // throws before touching current data
    this.#save();
  }
}

// ---- Pure query helpers ----
export function isOverdue(task, today = todayISO()) {
  return !task.done && task.dueDate !== null && task.dueDate < today;
}

export function queryTasks(tasks, { listId = null, status = 'all', tag = null, search = '', sort = 'created' } = {}, today = todayISO()) {
  const q = search.trim().toLowerCase();
  const result = tasks.filter((t) => {
    if (listId && t.listId !== listId) return false;
    if (tag && !t.tags.includes(tag)) return false;
    if (status === 'active' && t.done) return false;
    if (status === 'completed' && !t.done) return false;
    if (status === 'today' && (t.done || t.dueDate !== today)) return false;
    if (status === 'overdue' && !isOverdue(t, today)) return false;
    if (q) {
      const hay = `${t.title}\n${t.notes}\n${t.tags.join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const byCreated = (a, b) => b.createdAt - a.createdAt;
  const cmp = {
    created: byCreated,
    due: (a, b) => {
      if (a.dueDate === b.dueDate) return byCreated(a, b);
      if (a.dueDate === null) return 1;
      if (b.dueDate === null) return -1;
      return a.dueDate < b.dueDate ? -1 : 1;
    },
    priority: (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byCreated(a, b),
  }[sort] ?? byCreated;

  // Completed tasks always sink below active ones.
  return result.sort((a, b) => Number(a.done) - Number(b.done) || cmp(a, b));
}
