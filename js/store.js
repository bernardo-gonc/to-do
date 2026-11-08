// Data layer for the to-do app. No DOM access, so it can be unit-tested in Node.
// Loaded as a classic script (works from file://) and exposed as window.TodoStore.
(function () {
'use strict';
const STORAGE_KEY = 'todo-app:v1';
const SCHEMA_VERSION = 2;
const INBOX_ID = 'inbox';
const PRIORITIES = ['low', 'medium', 'high'];
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

function todayISO(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeTags(tags) {
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

// A new board starts with these columns; cards in a `done` column count as completed.
function defaultColumns() {
  return [['To do', false], ['Doing', false], ['Done', true]].map(([name, done]) => ({ id: newId(), name, done }));
}

function emptyState() {
  return { version: SCHEMA_VERSION, boards: [{ id: INBOX_ID, name: 'Inbox', columns: defaultColumns() }], tasks: [] };
}

function cleanColumns(cols) {
  if (!Array.isArray(cols)) return null;
  const seen = new Set();
  const out = [];
  for (const c of cols) {
    if (!c || typeof c.name !== 'string' || !c.name.trim()) continue;
    const id = typeof c.id === 'string' && !seen.has(c.id) ? c.id : newId();
    seen.add(id);
    out.push({ id, name: c.name.trim(), done: Boolean(c.done) });
  }
  return out.length ? out : null;
}

// Validates arbitrary parsed JSON and returns a clean (version 2) state, or throws.
// Also upgrades version 1 data (fixed lists + to do/doing/done status) to boards and columns.
function sanitizeState(raw) {
  const isV1 = raw && Array.isArray(raw.lists) && !Array.isArray(raw.boards);
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.tasks) || !(isV1 || Array.isArray(raw.boards))) {
    throw new Error('Invalid data: expected an object with "boards" and "tasks" arrays.');
  }
  const boards = [{ id: INBOX_ID, name: 'Inbox', columns: defaultColumns() }];
  const ids = new Set([INBOX_ID]);
  for (const b of isV1 ? raw.lists : raw.boards) {
    if (!b || typeof b.id !== 'string' || typeof b.name !== 'string') continue;
    const columns = isV1 ? null : cleanColumns(b.columns);
    if (b.id === INBOX_ID) {
      if (columns) boards[0].columns = columns;
      continue;
    }
    if (ids.has(b.id) || !b.name.trim()) continue;
    ids.add(b.id);
    boards.push({ id: b.id, name: b.name.trim(), columns: columns ?? defaultColumns() });
  }
  const byId = new Map(boards.map((b) => [b.id, b]));

  const tasks = [];
  const taskIds = new Set();
  for (const t of raw.tasks) {
    if (!t || typeof t.title !== 'string' || !t.title.trim()) continue;
    const id = typeof t.id === 'string' && !taskIds.has(t.id) ? t.id : newId();
    taskIds.add(id);
    const board = byId.get(isV1 ? t.listId : t.boardId) ?? boards[0];
    let column;
    if (isV1) {
      const status = ['todo', 'doing', 'done'].includes(t.status) ? t.status : (t.done ? 'done' : 'todo');
      column = board.columns[{ todo: 0, doing: 1, done: 2 }[status]];
    } else {
      column = board.columns.find((c) => c.id === t.columnId) ?? board.columns[0];
    }
    const done = column.done ? true : (isV1 ? false : Boolean(t.done));
    tasks.push({
      id,
      title: t.title.trim(),
      notes: typeof t.notes === 'string' ? t.notes : '',
      done,
      priority: PRIORITIES.includes(t.priority) ? t.priority : 'medium',
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(t.dueDate ?? '') ? t.dueDate : null,
      boardId: board.id,
      columnId: column.id,
      tags: normalizeTags(t.tags),
      createdAt: Number.isFinite(t.createdAt) ? t.createdAt : Date.now(),
      completedAt: done ? (Number.isFinite(t.completedAt) ? t.completedAt : Date.now()) : null,
    });
  }
  return { version: SCHEMA_VERSION, boards, tasks };
}

class Store {
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

  get boards() { return this.state.boards; }
  get tasks() { return this.state.tasks; }

  #board(id) {
    const board = this.state.boards.find((b) => b.id === id);
    if (!board) throw new Error('Board not found.');
    return board;
  }

  #column(board, columnId) {
    const column = board.columns.find((c) => c.id === columnId);
    if (!column) throw new Error('Column not found.');
    return column;
  }

  #task(id) {
    const task = this.state.tasks.find((t) => t.id === id);
    if (!task) throw new Error('Task not found.');
    return task;
  }

  // Places a task in a column; the column decides whether the task counts as done.
  #place(task, board, column) {
    task.boardId = board.id;
    task.columnId = column.id;
    if (column.done) {
      task.done = true;
      if (!task.completedAt) task.completedAt = Date.now();
    } else {
      task.done = false;
      task.completedAt = null;
    }
  }

  // ---- Tasks ----
  addTask({ title, notes = '', priority = 'medium', dueDate = null, boardId = INBOX_ID, columnId = null, tags = [] }) {
    const clean = String(title ?? '').trim();
    if (!clean) throw new Error('Title is required.');
    const board = this.state.boards.find((b) => b.id === boardId) ?? this.state.boards[0];
    const column = board.columns.find((c) => c.id === columnId) ?? board.columns[0];
    const task = {
      id: newId(),
      title: clean,
      notes: String(notes),
      done: false,
      priority: PRIORITIES.includes(priority) ? priority : 'medium',
      dueDate: dueDate || null,
      boardId: board.id,
      columnId: column.id,
      tags: normalizeTags(tags),
      createdAt: Date.now(),
      completedAt: null,
    };
    this.#place(task, board, column);
    this.state.tasks.push(task);
    this.#save();
    return task;
  }

  updateTask(id, changes) {
    const task = this.#task(id);
    if ('title' in changes) {
      const title = String(changes.title).trim();
      if (!title) throw new Error('Title is required.');
      task.title = title;
    }
    if ('notes' in changes) task.notes = String(changes.notes);
    if ('priority' in changes && PRIORITIES.includes(changes.priority)) task.priority = changes.priority;
    if ('dueDate' in changes) task.dueDate = changes.dueDate || null;
    if ('tags' in changes) task.tags = normalizeTags(changes.tags);
    if ('boardId' in changes || 'columnId' in changes) {
      const board = this.state.boards.find((b) => b.id === (changes.boardId ?? task.boardId)) ?? this.#board(task.boardId);
      const column = board.columns.find((c) => c.id === changes.columnId)
        ?? board.columns.find((c) => c.id === task.columnId)
        ?? board.columns[0];
      if (column.id !== task.columnId) this.#place(task, board, column);
    }
    this.#save();
    return task;
  }

  // Checkbox: completes the card (moving it to the board's done column, if any) or reopens it.
  toggleTask(id) {
    const task = this.#task(id);
    const board = this.#board(task.boardId);
    if (task.done) {
      const current = board.columns.find((c) => c.id === task.columnId);
      const target = current?.done ? board.columns.find((c) => !c.done) : null;
      if (target) this.#place(task, board, target);
      else { task.done = false; task.completedAt = null; }
    } else {
      const target = board.columns.find((c) => c.done);
      if (target) this.#place(task, board, target);
      else { task.done = true; task.completedAt = Date.now(); }
    }
    this.#save();
    return task;
  }

  // Moves a card to any column (of any board). The card goes just before `beforeId`
  // (a card in that column), or to the end of the column. The order of `tasks` is the manual order.
  moveTask(id, columnId, beforeId = null) {
    const task = this.#task(id);
    const board = this.state.boards.find((b) => b.columns.some((c) => c.id === columnId));
    if (!board) throw new Error('Column not found.');
    this.#place(task, board, this.#column(board, columnId));
    const rest = this.state.tasks.filter((t) => t.id !== id);
    let index = beforeId && beforeId !== id ? rest.findIndex((t) => t.id === beforeId && t.columnId === columnId) : -1;
    if (index < 0) {
      const last = rest.reduce((acc, t, i) => (t.columnId === columnId ? i : acc), -1);
      index = last >= 0 ? last + 1 : rest.length;
    }
    rest.splice(index, 0, task);
    this.state.tasks = rest;
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

  // ---- Boards ----
  addBoard(name) {
    const clean = String(name ?? '').trim();
    if (!clean) throw new Error('Board name is required.');
    if (this.state.boards.some((b) => b.name.toLowerCase() === clean.toLowerCase())) {
      throw new Error('A board with that name already exists.');
    }
    const board = { id: newId(), name: clean, columns: defaultColumns() };
    this.state.boards.push(board);
    this.#save();
    return board;
  }

  renameBoard(id, name) {
    const board = this.#board(id);
    if (id === INBOX_ID) throw new Error('The Inbox cannot be renamed.');
    const clean = String(name ?? '').trim();
    if (!clean) throw new Error('Board name is required.');
    if (this.state.boards.some((b) => b.id !== id && b.name.toLowerCase() === clean.toLowerCase())) {
      throw new Error('A board with that name already exists.');
    }
    board.name = clean;
    this.#save();
    return board;
  }

  // Cards of the deleted board move to the Inbox (keeping their done state).
  deleteBoard(id) {
    if (id === INBOX_ID) throw new Error('The Inbox cannot be deleted.');
    this.#board(id);
    const inbox = this.#board(INBOX_ID);
    this.state.boards = this.state.boards.filter((b) => b.id !== id);
    for (const t of this.state.tasks) {
      if (t.boardId !== id) continue;
      const wasDone = t.done;
      const completedAt = t.completedAt;
      const target = wasDone
        ? (inbox.columns.find((c) => c.done) ?? inbox.columns[0])
        : (inbox.columns.find((c) => !c.done) ?? inbox.columns[0]);
      this.#place(t, inbox, target);
      if (wasDone && !t.done) { t.done = true; t.completedAt = completedAt ?? Date.now(); }
    }
    this.#save();
  }

  // ---- Columns ----
  addColumn(boardId, name) {
    const board = this.#board(boardId);
    const clean = String(name ?? '').trim();
    if (!clean) throw new Error('Column name is required.');
    if (board.columns.some((c) => c.name.toLowerCase() === clean.toLowerCase())) {
      throw new Error('This board already has a column with that name.');
    }
    const column = { id: newId(), name: clean, done: false };
    board.columns.push(column);
    this.#save();
    return column;
  }

  renameColumn(boardId, columnId, name) {
    const board = this.#board(boardId);
    const column = this.#column(board, columnId);
    const clean = String(name ?? '').trim();
    if (!clean) throw new Error('Column name is required.');
    if (board.columns.some((c) => c.id !== columnId && c.name.toLowerCase() === clean.toLowerCase())) {
      throw new Error('This board already has a column with that name.');
    }
    column.name = clean;
    this.#save();
    return column;
  }

  // Marks whether cards in this column count as completed; existing cards follow.
  setColumnDone(boardId, columnId, done) {
    const board = this.#board(boardId);
    const column = this.#column(board, columnId);
    column.done = Boolean(done);
    for (const t of this.state.tasks) {
      if (t.columnId === columnId) this.#place(t, board, column);
    }
    this.#save();
    return column;
  }

  // Cards move to the board's first remaining column.
  deleteColumn(boardId, columnId) {
    const board = this.#board(boardId);
    this.#column(board, columnId);
    if (board.columns.length <= 1) throw new Error('A board needs at least one column.');
    board.columns = board.columns.filter((c) => c.id !== columnId);
    const target = board.columns[0];
    for (const t of this.state.tasks) {
      if (t.columnId === columnId) this.#place(t, board, target);
    }
    this.#save();
  }

  allTags(boardId = null) {
    const counts = new Map();
    for (const t of this.state.tasks) {
      if (boardId && t.boardId !== boardId) continue;
      for (const tag of t.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
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
function isOverdue(task, today = todayISO()) {
  return !task.done && task.dueDate !== null && task.dueDate < today;
}

function queryTasks(tasks, { boardId = null, status = 'all', tag = null, search = '', sort = 'created' } = {}, today = todayISO()) {
  const q = search.trim().toLowerCase();
  const result = tasks.filter((t) => {
    if (boardId && t.boardId !== boardId) return false;
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

  if (sort === 'manual') return result; // keep the stored (manual) order

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

globalThis.TodoStore = { STORAGE_KEY, SCHEMA_VERSION, INBOX_ID, PRIORITIES, todayISO, normalizeTags, sanitizeState, Store, isOverdue, queryTasks };
})();
