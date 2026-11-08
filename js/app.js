(function () {
'use strict';
const { Store, INBOX_ID, STATUSES, queryTasks, isOverdue, todayISO } = globalThis.TodoStore;

const store = new Store();
const $ = (id) => document.getElementById(id);

const UI_KEY = 'todo-app:ui';
const view = { filter: 'all', listId: null, tag: null, search: '', sort: 'created', mode: 'list' };
const collapsed = new Set();
let editingId = null;
let dragId = null;

try {
  const saved = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
  if (saved.mode === 'board' || saved.mode === 'list') view.mode = saved.mode;
} catch { /* ignore */ }

const FILTERS = [
  ['all', 'All'], ['active', 'Active'], ['completed', 'Completed'], ['today', 'Due today'], ['overdue', 'Overdue'],
];
const STATUS_LABEL = { todo: 'To do', doing: 'Doing', done: 'Done' };
const PRIORITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High' };

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c) node.append(c);
  return node;
}

const pill = (cls, text) => el('span', { class: `pill ${cls}`, text });

function showMessage(text) {
  const m = $('message');
  m.textContent = text;
  m.hidden = !text;
}

function guard(fn) {
  try { fn(); showMessage(''); } catch (e) { showMessage(e.message); }
}

function formatDue(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function listName(id) {
  return store.lists.find((l) => l.id === id)?.name ?? 'Inbox';
}

// ---------- Sidebar ----------
function renderFilters() {
  const today = todayISO();
  const ul = $('status-filters');
  ul.replaceChildren();
  for (const [key, label] of FILTERS) {
    const n = queryTasks(store.tasks, { status: key }, today).length;
    ul.append(el('li', { class: 'nav-item' },
      el('button', { class: 'nav-btn', type: 'button', 'aria-current': view.filter === key,
        onclick: () => { view.filter = key; render(); } },
      el('span', { text: label }), el('span', { class: 'count', text: String(n) }))));
  }
}

function renderLists() {
  const ul = $('list-nav');
  ul.replaceChildren();
  ul.append(el('li', { class: 'nav-item' },
    el('button', { class: 'nav-btn', type: 'button', 'aria-current': view.listId === null,
      onclick: () => { view.listId = null; render(); } }, el('span', { text: 'All lists' }))));

  for (const list of store.lists) {
    const n = store.tasks.filter((t) => t.listId === list.id && !t.done).length;
    const li = el('li', { class: 'nav-item' },
      el('button', { class: 'nav-btn', type: 'button', 'aria-current': view.listId === list.id,
        onclick: () => { view.listId = list.id; render(); } },
      el('span', { text: list.name }), el('span', { class: 'count', text: String(n) })));
    if (list.id !== INBOX_ID) {
      li.append(
        el('button', { class: 'mini', type: 'button', 'aria-label': `Rename list ${list.name}`, text: '✎',
          onclick: () => {
            const name = prompt('Rename list', list.name);
            if (name !== null) guard(() => { store.renameList(list.id, name); render(); });
          } }),
        el('button', { class: 'mini', type: 'button', 'aria-label': `Delete list ${list.name}`, text: '✕',
          onclick: () => {
            if (!confirm(`Delete list "${list.name}"? Its tasks move to Inbox.`)) return;
            guard(() => { store.deleteList(list.id); if (view.listId === list.id) view.listId = null; render(); });
          } }));
    }
    ul.append(li);
  }
}

function renderTags() {
  const box = $('tag-nav');
  box.replaceChildren();
  const tags = store.allTags();
  if (!tags.length) box.append(el('span', { class: 'count', text: 'No tags yet' }));
  if (view.tag && !tags.some((t) => t.tag === view.tag)) view.tag = null;
  for (const { tag, count } of tags) {
    box.append(el('button', { class: 'tag', type: 'button', 'aria-pressed': view.tag === tag,
      onclick: () => { view.tag = view.tag === tag ? null : tag; render(); } }, `#${tag} ${count}`));
  }
}

// ---------- List view ----------
function taskRow(t, today) {
  const overdue = isOverdue(t, today);
  const sub = el('div', { class: 'sub' },
    ...t.tags.map((tag) => el('span', { class: 'chip', text: `#${tag}` })),
    t.notes && el('span', { class: 'notes-snip', text: t.notes.split('\n')[0].slice(0, 80) }));

  const statusSelect = el('select', { class: `status-select ${t.status}`, 'aria-label': `Status of "${t.title}"`,
    onchange: (e) => { store.setStatus(t.id, e.target.value); render(); } },
  ...STATUSES.map((s) => el('option', { value: s, text: STATUS_LABEL[s] })));
  statusSelect.value = t.status;

  return el('div', { class: `row task-row${t.done ? ' done' : ''}` },
    el('input', { type: 'checkbox', 'aria-label': `Mark "${t.title}" ${t.done ? 'not done' : 'done'}`, checked: t.done,
      onchange: () => { store.toggleTask(t.id); render(); } }),
    el('div', {}, el('div', { class: 'name', text: t.title }), sub.childNodes.length ? sub : null),
    el('div', { class: 'cell-muted', text: listName(t.listId) }),
    el('div', { class: `cell-muted due${overdue ? ' overdue' : ''}`,
      text: t.dueDate ? `${overdue ? '⚠ ' : t.dueDate === today && !t.done ? 'Today · ' : ''}${formatDue(t.dueDate)}` : '—' }),
    el('div', {}, pill(t.priority, PRIORITY_LABEL[t.priority])),
    statusSelect,
    el('div', { class: 'row-actions' },
      el('button', { type: 'button', class: 'mini', text: 'Edit', 'aria-label': `Edit "${t.title}"`, onclick: () => openDialog(t) }),
      el('button', { type: 'button', class: 'mini', text: 'Delete', 'aria-label': `Delete "${t.title}"`,
        onclick: () => { store.deleteTask(t.id); render(); } })));
}

function renderListView(tasks) {
  const today = todayISO();
  const root = $('list-view');
  root.replaceChildren();
  if (!tasks.length) return;
  const table = el('div', { class: 'table' },
    el('div', { class: 'row head', 'aria-hidden': 'true' },
      el('span'), el('span', { text: 'Name' }), el('span', { text: 'List' }), el('span', { text: 'Due date' }),
      el('span', { text: 'Priority' }), el('span', { text: 'Status' }), el('span')));
  for (const status of STATUSES) {
    const group = tasks.filter((t) => t.status === status);
    if (!group.length) continue;
    const open = !collapsed.has(status);
    table.append(el('button', { type: 'button', class: 'group-head', 'aria-expanded': String(open),
      onclick: () => { if (open) collapsed.add(status); else collapsed.delete(status); render(); } },
    el('span', { class: 'caret', text: '▾', 'aria-hidden': 'true' }),
    el('span', { text: STATUS_LABEL[status] }), el('span', { class: 'count', text: String(group.length) })));
    if (open) for (const t of group) table.append(taskRow(t, today));
  }
  root.append(table);
}

// ---------- Board view ----------
function card(t) {
  const today = todayISO();
  const overdue = isOverdue(t, today);
  const c = el('div', { class: `card${t.done ? ' done' : ''}`, draggable: 'true', tabindex: '0', role: 'button',
    'aria-label': `Edit "${t.title}"`,
    onclick: () => openDialog(t),
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); openDialog(t); } },
    ondragstart: (e) => {
      dragId = t.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', t.id);
      requestAnimationFrame(() => c.classList.add('dragging'));
    },
    ondragend: () => { dragId = null; c.classList.remove('dragging'); } },
  el('div', { class: 'card-title', text: t.title }),
  el('div', { class: 'card-meta' },
    pill(t.priority, PRIORITY_LABEL[t.priority]),
    t.dueDate && el('span', { class: overdue ? 'due overdue' : '', text: `${overdue ? '⚠ ' : ''}${formatDue(t.dueDate)}` }),
    el('span', { text: listName(t.listId) }),
    ...t.tags.map((tag) => el('span', { class: 'chip', text: `#${tag}` }))));
  return c;
}

function renderBoard(tasks) {
  const root = $('board-view');
  root.replaceChildren();
  for (const status of STATUSES) {
    const items = tasks.filter((t) => t.status === status);
    const cards = el('div', { class: 'cards' }, ...items.map(card));
    const col = el('div', { class: 'column', 'data-status': status,
      ondragover: (e) => { if (!dragId) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; col.classList.add('over'); },
      ondragleave: (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); },
      ondrop: (e) => {
        e.preventDefault();
        col.classList.remove('over');
        const id = dragId ?? e.dataTransfer.getData('text/plain');
        dragId = null;
        if (id) guard(() => { store.setStatus(id, status); render(); });
      } },
    el('h2', {}, el('span', { text: STATUS_LABEL[status] }), el('span', { class: 'count', text: String(items.length) })),
    cards,
    el('button', { type: 'button', class: 'add-card', text: '+ Add a card', onclick: () => openDialog(null, { status }) }));
    root.append(col);
  }
}

// ---------- Page ----------
function pageTitle() {
  const parts = [];
  parts.push(view.listId ? listName(view.listId) : 'All tasks');
  const f = FILTERS.find(([k]) => k === view.filter);
  if (f && view.filter !== 'all') parts.push(f[1]);
  if (view.tag) parts.push(`#${view.tag}`);
  return parts.join(' · ');
}

function renderTasks() {
  const tasks = queryTasks(store.tasks,
    { listId: view.listId, status: view.filter, tag: view.tag, search: view.search, sort: view.sort }, todayISO());
  const board = view.mode === 'board';
  $('list-view').hidden = board;
  $('board-view').hidden = !board;
  $('tab-list').setAttribute('aria-selected', String(!board));
  $('tab-board').setAttribute('aria-selected', String(board));
  if (board) renderBoard(tasks); else renderListView(tasks);
  $('empty').hidden = tasks.length > 0 || board;
  $('count').textContent = `${tasks.length} task${tasks.length === 1 ? '' : 's'}`;
  $('page-title').textContent = pageTitle();
  $('clear-done').disabled = !store.tasks.some((t) => t.done);
}

function render() {
  renderFilters();
  renderLists();
  renderTags();
  renderTasks();
}

function setMode(mode) {
  view.mode = mode;
  try { localStorage.setItem(UI_KEY, JSON.stringify({ mode })); } catch { /* ignore */ }
  renderTasks();
}
$('tab-list').addEventListener('click', () => setMode('list'));
$('tab-board').addEventListener('click', () => setMode('board'));

// ---------- Create / edit dialog ----------
const dlg = $('task-dialog');

function openDialog(task, preset = {}) {
  editingId = task ? task.id : null;
  $('task-form').reset();
  $('list').replaceChildren(...store.lists.map((l) => el('option', { value: l.id, text: l.name })));
  $('dlg-title').textContent = task ? 'Edit task' : 'Create task';
  $('submit-btn').textContent = task ? 'Save' : 'Create';
  $('title').value = task?.title ?? '';
  $('status').value = task?.status ?? preset.status ?? 'todo';
  $('priority').value = task?.priority ?? 'medium';
  $('due').value = task?.dueDate ?? '';
  $('list').value = task?.listId ?? view.listId ?? INBOX_ID;
  $('tags').value = task ? task.tags.join(', ') : (view.tag ?? '');
  $('notes').value = task?.notes ?? '';
  $('dialog-error').hidden = true;
  dlg.showModal();
  $('title').focus();
}

$('create-btn').addEventListener('click', () => openDialog(null));
$('cancel-btn').addEventListener('click', () => dlg.close());
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

$('task-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const data = {
    title: $('title').value, status: $('status').value, priority: $('priority').value,
    dueDate: $('due').value, listId: $('list').value, tags: $('tags').value, notes: $('notes').value,
  };
  try {
    if (editingId) store.updateTask(editingId, data); else store.addTask(data);
    dlg.close();
    render();
  } catch (err) {
    $('dialog-error').textContent = err.message;
    $('dialog-error').hidden = false;
  }
});

// ---------- Lists / search / toolbar ----------
$('list-form').addEventListener('submit', (e) => {
  e.preventDefault();
  guard(() => {
    const list = store.addList($('list-name').value);
    $('list-name').value = '';
    view.listId = list.id;
    render();
  });
});
$('search').addEventListener('input', (e) => { view.search = e.target.value; renderTasks(); });
$('sort').addEventListener('change', (e) => { view.sort = e.target.value; renderTasks(); });
$('clear-done').addEventListener('click', () => {
  const n = store.tasks.filter((t) => t.done).length;
  if (n && confirm(`Remove ${n} completed task${n === 1 ? '' : 's'}?`)) { store.clearCompleted(); render(); }
});

// ---------- Backup ----------
$('export-btn').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([store.exportJSON()], { type: 'application/json' }));
  const a = el('a', { href: url, download: `todo-backup-${todayISO()}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});
$('import-btn').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (!confirm('Importing replaces all current tasks and lists. Continue?')) return;
  try {
    store.importJSON(await file.text());
    view.listId = null; view.tag = null;
    render();
    showMessage('');
  } catch (err) {
    showMessage(err.message);
  }
});

render();
})();
