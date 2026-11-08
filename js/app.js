(function () {
'use strict';
const { Store, INBOX_ID, queryTasks, isOverdue, todayISO } = globalThis.TodoStore;

const store = new Store();
const $ = (id) => document.getElementById(id);

const UI_KEY = 'todo-app:ui';
const view = { filter: 'all', boardId: null, tag: null, search: '', sort: 'manual', mode: 'list' };
const collapsed = new Set();
let editingId = null;
let dragId = null;

try {
  const saved = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
  if (saved.mode === 'board' || saved.mode === 'list') view.mode = saved.mode;
  if (typeof saved.boardId === 'string') view.boardId = saved.boardId;
} catch { /* ignore */ }
if (view.boardId && !store.boards.some((b) => b.id === view.boardId)) view.boardId = null;
if (view.mode === 'board' && !view.boardId) view.boardId = INBOX_ID;

const FILTERS = [
  ['all', 'All'], ['active', 'Active'], ['completed', 'Completed'], ['today', 'Due today'], ['overdue', 'Overdue'],
];
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

function saveUi() {
  try { localStorage.setItem(UI_KEY, JSON.stringify({ mode: view.mode, boardId: view.boardId })); } catch { /* ignore */ }
}

function formatDue(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const boardById = (id) => store.boards.find((b) => b.id === id);
const boardName = (id) => boardById(id)?.name ?? 'Inbox';
const currentBoard = () => (view.boardId ? boardById(view.boardId) : null);

// ---------- Sidebar ----------
function renderFilters() {
  const today = todayISO();
  const ul = $('status-filters');
  ul.replaceChildren();
  for (const [key, label] of FILTERS) {
    const n = queryTasks(store.tasks, { status: key, boardId: view.boardId }, today).length;
    ul.append(el('li', { class: 'nav-item' },
      el('button', { class: 'nav-btn', type: 'button', 'aria-current': view.filter === key,
        onclick: () => { view.filter = key; render(); } },
      el('span', { text: label }), el('span', { class: 'count', text: String(n) }))));
  }
}

function selectBoard(id) {
  view.boardId = id;
  if (id === null && view.mode === 'board') view.mode = 'list'; // columns only make sense for one board
  saveUi();
  render();
}

function renderBoards() {
  const ul = $('board-nav');
  ul.replaceChildren();
  ul.append(el('li', { class: 'nav-item' },
    el('button', { class: 'nav-btn', type: 'button', 'aria-current': view.boardId === null,
      onclick: () => selectBoard(null) }, el('span', { text: 'All boards' }))));

  for (const board of store.boards) {
    const n = store.tasks.filter((t) => t.boardId === board.id && !t.done).length;
    const li = el('li', { class: 'nav-item' },
      el('button', { class: 'nav-btn', type: 'button', 'aria-current': view.boardId === board.id,
        onclick: () => selectBoard(board.id) },
      el('span', { text: board.name }), el('span', { class: 'count', text: String(n) })));
    if (board.id !== INBOX_ID) {
      li.append(
        el('button', { class: 'mini', type: 'button', 'aria-label': `Rename board ${board.name}`, text: '✎',
          onclick: () => {
            const name = prompt('Rename board', board.name);
            if (name !== null) guard(() => { store.renameBoard(board.id, name); render(); });
          } }),
        el('button', { class: 'mini', type: 'button', 'aria-label': `Delete board ${board.name}`, text: '✕',
          onclick: () => {
            if (!confirm(`Delete board "${board.name}"? Its cards move to the Inbox.`)) return;
            guard(() => {
              store.deleteBoard(board.id);
              if (view.boardId === board.id) view.boardId = view.mode === 'board' ? INBOX_ID : null;
              saveUi();
              render();
            });
          } }));
    }
    ul.append(li);
  }
}

function renderTags() {
  const box = $('tag-nav');
  box.replaceChildren();
  const tags = store.allTags(view.boardId);
  if (!tags.length) box.append(el('span', { class: 'count', text: 'No tags yet' }));
  if (view.tag && !tags.some((t) => t.tag === view.tag)) view.tag = null;
  for (const { tag, count } of tags) {
    box.append(el('button', { class: 'tag', type: 'button', 'aria-pressed': view.tag === tag,
      onclick: () => { view.tag = view.tag === tag ? null : tag; render(); } }, `#${tag} ${count}`));
  }
}

// ---------- List view ----------
function columnSelect(t) {
  const board = boardById(t.boardId);
  const current = board?.columns.find((c) => c.id === t.columnId);
  const select = el('select', { class: `col-select${current?.done ? ' done' : ''}`, 'aria-label': `Column of "${t.title}"`,
    onchange: (e) => { store.moveTask(t.id, e.target.value); render(); } },
  ...(board?.columns ?? []).map((c) => el('option', { value: c.id, text: c.name })));
  select.value = t.columnId;
  return select;
}

function taskRow(t, today) {
  const overdue = isOverdue(t, today);
  const sub = el('div', { class: 'sub' },
    ...t.tags.map((tag) => el('span', { class: 'chip', text: `#${tag}` })),
    t.notes && el('span', { class: 'notes-snip', text: t.notes.split('\n')[0].slice(0, 80) }));

  return el('div', { class: `row task-row${t.done ? ' done' : ''}` },
    el('input', { type: 'checkbox', 'aria-label': `Mark "${t.title}" ${t.done ? 'not done' : 'done'}`, checked: t.done,
      onchange: () => { store.toggleTask(t.id); render(); } }),
    el('div', {}, el('div', { class: 'name', text: t.title }), sub.childNodes.length ? sub : null),
    el('div', { class: 'cell-muted', text: boardName(t.boardId) }),
    el('div', { class: `cell-muted due${overdue ? ' overdue' : ''}`,
      text: t.dueDate ? `${overdue ? '⚠ ' : t.dueDate === today && !t.done ? 'Today · ' : ''}${formatDue(t.dueDate)}` : '—' }),
    el('div', {}, pill(t.priority, PRIORITY_LABEL[t.priority])),
    columnSelect(t),
    el('div', { class: 'row-actions' },
      el('button', { type: 'button', class: 'mini', text: 'Edit', 'aria-label': `Edit "${t.title}"`, onclick: () => openDialog(t) }),
      el('button', { type: 'button', class: 'mini', text: 'Delete', 'aria-label': `Delete "${t.title}"`,
        onclick: () => { store.deleteTask(t.id); render(); } })));
}

// One board selected: group by its columns. All boards: group by board.
function listGroups(tasks) {
  const board = currentBoard();
  if (board) return board.columns.map((c) => ({ key: `c:${c.id}`, label: c.name, items: tasks.filter((t) => t.columnId === c.id) }));
  return store.boards.map((b) => ({ key: `b:${b.id}`, label: b.name, items: tasks.filter((t) => t.boardId === b.id) }));
}

function renderListView(tasks) {
  const today = todayISO();
  const root = $('list-view');
  root.replaceChildren();
  if (!tasks.length) return;
  const table = el('div', { class: 'table' },
    el('div', { class: 'row head', 'aria-hidden': 'true' },
      el('span'), el('span', { text: 'Name' }), el('span', { text: 'Board' }), el('span', { text: 'Due date' }),
      el('span', { text: 'Priority' }), el('span', { text: 'Column' }), el('span')));
  for (const group of listGroups(tasks)) {
    if (!group.items.length) continue;
    const open = !collapsed.has(group.key);
    table.append(el('button', { type: 'button', class: 'group-head', 'aria-expanded': String(open),
      onclick: () => { if (open) collapsed.add(group.key); else collapsed.delete(group.key); render(); } },
    el('span', { class: 'caret', text: '▾', 'aria-hidden': 'true' }),
    el('span', { text: group.label }), el('span', { class: 'count', text: String(group.items.length) })));
    if (open) for (const t of group.items) table.append(taskRow(t, today));
  }
  root.append(table);
}

// ---------- Board view ----------
function moveCardByKey(t, items, index, key) {
  if (key === 'ArrowUp' && index === 0) return;
  if (key === 'ArrowDown' && index === items.length - 1) return;
  const beforeId = key === 'ArrowUp' ? items[index - 1].id : (items[index + 2]?.id ?? null);
  guard(() => { store.moveTask(t.id, t.columnId, beforeId); render(); });
  $('board-view').querySelector(`.card[data-id="${t.id}"]`)?.focus();
}

function card(t, items, index) {
  const overdue = isOverdue(t, todayISO());
  const c = el('div', { class: `card${t.done ? ' done' : ''}`, draggable: 'true', tabindex: '0', role: 'button',
    'data-id': t.id,
    'aria-label': `Edit "${t.title}"`,
    'aria-keyshortcuts': 'Alt+ArrowUp Alt+ArrowDown',
    onclick: () => openDialog(t),
    onkeydown: (e) => {
      if (e.key === 'Enter') { e.preventDefault(); openDialog(t); }
      else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && view.sort === 'manual') {
        e.preventDefault();
        moveCardByKey(t, items, index, e.key);
      }
    },
    ondragstart: (e) => {
      dragId = t.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', t.id);
      requestAnimationFrame(() => c.classList.add('dragging'));
    },
    ondragend: () => { dragId = null; c.classList.remove('dragging'); clearDropIndicators(); } },
  el('div', { class: 'card-title', text: t.title }),
  el('div', { class: 'card-meta' },
    pill(t.priority, PRIORITY_LABEL[t.priority]),
    t.dueDate && el('span', { class: overdue ? 'due overdue' : '', text: `${overdue ? '⚠ ' : ''}${formatDue(t.dueDate)}` }),
    ...t.tags.map((tag) => el('span', { class: 'chip', text: `#${tag}` }))));
  return c;
}

function columnHeader(board, column, count) {
  const act = (text, label, handler, extra = {}) => el('button', { type: 'button', class: 'mini', text, 'aria-label': label, title: label, onclick: handler, ...extra });
  return el('h2', {},
    el('span', { class: 'col-name', text: column.name }),
    el('span', { class: 'count', text: String(count) }),
    el('span', { class: 'col-actions' },
      act('✓', `Cards in "${column.name}" count as done`, () => guard(() => { store.setColumnDone(board.id, column.id, !column.done); render(); }),
        { 'aria-pressed': String(column.done), class: `mini toggle${column.done ? ' on' : ''}` }),
      act('✎', `Rename column ${column.name}`, () => {
        const name = prompt('Rename column', column.name);
        if (name !== null) guard(() => { store.renameColumn(board.id, column.id, name); render(); });
      }),
      act('✕', `Delete column ${column.name}`, () => {
        if (!confirm(`Delete column "${column.name}"? Its cards move to "${board.columns.find((c) => c.id !== column.id)?.name ?? 'another column'}".`)) return;
        guard(() => { store.deleteColumn(board.id, column.id); render(); });
      })));
}

// The card the dragged card would be dropped in front of (null = end of the column).
function dropTarget(cardsEl, y) {
  return [...cardsEl.querySelectorAll('.card:not(.dragging)')]
    .find((c) => { const r = c.getBoundingClientRect(); return y < r.top + r.height / 2; }) ?? null;
}

function clearDropIndicators() {
  for (const n of $('board-view').querySelectorAll('.drop-before, .drop-end')) n.classList.remove('drop-before', 'drop-end');
}

function showDropIndicator(cardsEl, target) {
  clearDropIndicators();
  if (view.sort !== 'manual') return;
  (target ?? cardsEl).classList.add(target ? 'drop-before' : 'drop-end');
}

function renderBoard(tasks) {
  const root = $('board-view');
  root.replaceChildren();
  const board = currentBoard();
  if (!board) return;
  for (const column of board.columns) {
    const items = tasks.filter((t) => t.columnId === column.id);
    const cardsEl = el('div', { class: 'cards' }, ...items.map((t, i) => card(t, items, i)));
    const col = el('div', { class: 'column', 'data-column': column.name,
      ondragover: (e) => {
        if (!dragId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        col.classList.add('over');
        showDropIndicator(cardsEl, dropTarget(cardsEl, e.clientY));
      },
      ondragleave: (e) => { if (!col.contains(e.relatedTarget)) { col.classList.remove('over'); clearDropIndicators(); } },
      ondrop: (e) => {
        e.preventDefault();
        col.classList.remove('over');
        const id = dragId ?? e.dataTransfer.getData('text/plain');
        const beforeId = view.sort === 'manual' ? (dropTarget(cardsEl, e.clientY)?.dataset.id ?? null) : null;
        dragId = null;
        clearDropIndicators();
        if (id) guard(() => { store.moveTask(id, column.id, beforeId); render(); });
      } },
    columnHeader(board, column, items.length),
    cardsEl,
    el('button', { type: 'button', class: 'add-card', text: '+ Add a card', onclick: () => openDialog(null, { columnId: column.id }) }));
    root.append(col);
  }
  root.append(el('form', { class: 'column add-column',
    onsubmit: (e) => {
      e.preventDefault();
      try {
        store.addColumn(board.id, e.target.elements.name.value);
        showMessage('');
        render();
        $('board-view').querySelector('.add-column input')?.focus();
      } catch (err) {
        showMessage(err.message);
      }
    } },
  el('label', { class: 'sr-only', for: 'new-column-name', text: 'New column name' }),
  el('input', { id: 'new-column-name', name: 'name', placeholder: '+ Add another column', maxlength: '40', autocomplete: 'off' }),
  el('button', { type: 'submit', class: 'btn', text: 'Add column' })));
}

// ---------- Page ----------
function pageTitle() {
  const parts = [currentBoard()?.name ?? 'All boards'];
  const f = FILTERS.find(([k]) => k === view.filter);
  if (f && view.filter !== 'all') parts.push(f[1]);
  if (view.tag) parts.push(`#${view.tag}`);
  return parts.join(' · ');
}

function renderTasks() {
  const tasks = queryTasks(store.tasks,
    { boardId: view.boardId, status: view.filter, tag: view.tag, search: view.search, sort: view.sort }, todayISO());
  const board = view.mode === 'board';
  $('list-view').hidden = board;
  $('board-view').hidden = !board;
  $('tab-list').setAttribute('aria-selected', String(!board));
  $('tab-board').setAttribute('aria-selected', String(board));
  if (board) renderBoard(tasks); else renderListView(tasks);
  $('empty').hidden = tasks.length > 0 || board;
  $('count').textContent = `${tasks.length} card${tasks.length === 1 ? '' : 's'}`;
  $('page-title').textContent = pageTitle();
  $('clear-done').disabled = !store.tasks.some((t) => t.done);
}

function render() {
  renderFilters();
  renderBoards();
  renderTags();
  renderTasks();
}

function setMode(mode) {
  view.mode = mode;
  if (mode === 'board' && !view.boardId) view.boardId = INBOX_ID; // the board view shows one board's columns
  saveUi();
  render();
}
$('tab-list').addEventListener('click', () => setMode('list'));
$('tab-board').addEventListener('click', () => setMode('board'));

// ---------- Create / edit dialog ----------
const dlg = $('task-dialog');

function fillColumns(boardId, selected) {
  const board = boardById(boardId) ?? store.boards[0];
  $('column').replaceChildren(...board.columns.map((c) => el('option', { value: c.id, text: c.name })));
  $('column').value = board.columns.some((c) => c.id === selected) ? selected : board.columns[0].id;
}

function openDialog(task, preset = {}) {
  editingId = task ? task.id : null;
  $('task-form').reset();
  $('board').replaceChildren(...store.boards.map((b) => el('option', { value: b.id, text: b.name })));
  $('dlg-title').textContent = task ? 'Edit card' : 'Create card';
  $('submit-btn').textContent = task ? 'Save' : 'Create';
  $('title').value = task?.title ?? '';
  $('board').value = task?.boardId ?? view.boardId ?? INBOX_ID;
  fillColumns($('board').value, task?.columnId ?? preset.columnId);
  $('priority').value = task?.priority ?? 'medium';
  $('due').value = task?.dueDate ?? '';
  $('tags').value = task ? task.tags.join(', ') : (view.tag ?? '');
  $('notes').value = task?.notes ?? '';
  $('dialog-error').hidden = true;
  dlg.showModal();
  $('title').focus();
}

$('board').addEventListener('change', () => fillColumns($('board').value));
$('create-btn').addEventListener('click', () => openDialog(null));
$('cancel-btn').addEventListener('click', () => dlg.close());
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

$('task-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const data = {
    title: $('title').value, boardId: $('board').value, columnId: $('column').value,
    priority: $('priority').value, dueDate: $('due').value, tags: $('tags').value, notes: $('notes').value,
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

// ---------- Boards form / search / toolbar ----------
$('board-form').addEventListener('submit', (e) => {
  e.preventDefault();
  guard(() => {
    const board = store.addBoard($('board-name').value);
    $('board-name').value = '';
    view.boardId = board.id;
    saveUi();
    render();
  });
});
$('search').addEventListener('input', (e) => { view.search = e.target.value; renderTasks(); });
$('sort').addEventListener('change', (e) => { view.sort = e.target.value; renderTasks(); });
$('clear-done').addEventListener('click', () => {
  const n = store.tasks.filter((t) => t.done).length;
  if (n && confirm(`Remove ${n} completed card${n === 1 ? '' : 's'}?`)) { store.clearCompleted(); render(); }
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
  if (!confirm('Importing replaces all current boards and cards. Continue?')) return;
  try {
    store.importJSON(await file.text());
    view.boardId = view.mode === 'board' ? INBOX_ID : null;
    view.tag = null;
    saveUi();
    render();
    showMessage('');
  } catch (err) {
    showMessage(err.message);
  }
});

render();
})();
