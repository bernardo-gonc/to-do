(function () {
'use strict';
const { Store, INBOX_ID, queryTasks, isOverdue, todayISO, checklistProgress } = globalThis.TodoStore;

const store = new Store();
const $ = (id) => document.getElementById(id);

const UI_KEY = 'todo-app:ui';
const view = { filter: 'all', boardId: null, tag: null, search: '', sort: 'manual', mode: 'list', lastMode: 'list' };
const collapsed = new Set();
let editingId = null;
let dragId = null;

try {
  const saved = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
  if (['board', 'list', 'notes'].includes(saved.mode)) view.mode = saved.mode;
  if (typeof saved.boardId === 'string') view.boardId = saved.boardId;
} catch { /* ignore */ }
if (view.boardId && !store.boards.some((b) => b.id === view.boardId)) view.boardId = null;
if (view.mode === 'board' && !view.boardId) view.boardId = INBOX_ID;
if (view.mode === 'notes' && store.boards.find((b) => b.id === view.boardId)?.kind !== 'meeting') view.mode = 'list';
view.lastMode = view.mode === 'board' ? 'board' : 'list';

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

// Pasted multi-line text becomes one item per line (bullets, numbers and [ ] stripped); single lines return null.
function pastedLines(pasted) {
  if (!/\r?\n/.test(pasted.trim())) return null;
  return pasted.split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)]|\[[ xX]?\])\s*/, '').trim()).filter(Boolean);
}

function checklistBadge(t) {
  const { done, total } = checklistProgress(t);
  return total
    ? el('span', { class: `badge${done === total ? ' complete' : ''}`, title: 'Checklist items done', text: `☑ ${done}/${total}` })
    : null;
}

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

// ----- Meeting notes are saved shortly after typing stops, and always before the view changes -----
let meetingTimer = null;
let pendingMeeting = null;

function flushMeeting() {
  clearTimeout(meetingTimer);
  if (!pendingMeeting) return;
  const { boardId, changes } = pendingMeeting;
  pendingMeeting = null;
  try { store.updateMeeting(boardId, changes); } catch (e) { showMessage(e.message); }
}

function queueMeetingSave(boardId, changes) {
  const same = pendingMeeting && pendingMeeting.boardId === boardId;
  if (pendingMeeting && !same) flushMeeting();
  pendingMeeting = { boardId, changes: { ...(same ? pendingMeeting.changes : {}), ...changes } };
  clearTimeout(meetingTimer);
  meetingTimer = setTimeout(flushMeeting, 400);
}
window.addEventListener('pagehide', flushMeeting);
window.addEventListener('beforeunload', flushMeeting);

function selectBoard(id) {
  flushMeeting();
  view.boardId = id;
  const board = id ? boardById(id) : null;
  if (board?.kind === 'meeting') {
    view.mode = 'notes';
  } else {
    if (view.mode === 'notes') view.mode = view.lastMode;
    if (!board && view.mode === 'board') view.mode = 'list'; // columns only make sense for one board
  }
  saveUi();
  render();
}

function navItem(board) {
  const meeting = board.kind === 'meeting';
  const n = store.tasks.filter((t) => t.boardId === board.id && !t.done).length;
  const label = el('span', { class: 'nav-label' }, el('span', { text: board.name }),
    meeting && board.meeting.date ? el('small', { text: formatDue(board.meeting.date) }) : null);
  const li = el('li', { class: 'nav-item' },
    el('button', { class: 'nav-btn', type: 'button', 'aria-current': view.boardId === board.id,
      onclick: () => selectBoard(board.id) },
    label, el('span', { class: 'count', text: String(n) })));
  if (board.id !== INBOX_ID) {
    const kind = meeting ? 'meeting' : 'board';
    li.append(
      el('button', { class: 'mini', type: 'button', 'aria-label': `Rename ${kind} ${board.name}`, text: '✎',
        onclick: () => {
          const name = prompt(`Rename ${kind}`, board.name);
          if (name !== null) guard(() => { store.renameBoard(board.id, name); render(); });
        } }),
      el('button', { class: 'mini', type: 'button', 'aria-label': `Delete ${kind} ${board.name}`, text: '✕',
        onclick: () => {
          const msg = meeting
            ? `Delete meeting "${board.name}"? Its notes and checklist are deleted and its action items move to the Inbox.`
            : `Delete board "${board.name}"? Its cards move to the Inbox.`;
          if (!confirm(msg)) return;
          guard(() => {
            flushMeeting();
            store.deleteBoard(board.id);
            if (view.boardId === board.id) {
              view.mode = view.lastMode === 'board' ? 'board' : 'list';
              view.boardId = view.mode === 'board' ? INBOX_ID : null;
            }
            saveUi();
            render();
          });
        } }));
  }
  return li;
}

function renderBoards() {
  const ul = $('board-nav');
  ul.replaceChildren();
  ul.append(el('li', { class: 'nav-item' },
    el('button', { class: 'nav-btn', type: 'button', 'aria-current': view.boardId === null,
      onclick: () => selectBoard(null) }, el('span', { text: 'All boards' }))));
  for (const board of store.boards.filter((b) => b.kind !== 'meeting')) ul.append(navItem(board));

  const mu = $('meeting-nav');
  mu.replaceChildren();
  const meetings = store.boards.filter((b) => b.kind === 'meeting')
    .sort((a, b) => (b.meeting.date ?? '').localeCompare(a.meeting.date ?? '')); // newest first, undated last
  if (!meetings.length) mu.append(el('li', { class: 'count empty-note', text: 'No meetings yet' }));
  for (const board of meetings) mu.append(navItem(board));
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
    checklistBadge(t),
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
    checklistBadge(t),
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

// The checklist panel redraws on its own so that typing in the notes box is never interrupted.
function renderChecklist(board, panel) {
  const items = board.meeting.checklist;
  const done = items.filter((i) => i.done).length;
  const refresh = () => renderChecklist(board, panel);
  const run = (fn, refocus = false) => {
    guard(fn);
    refresh();
    if (refocus) panel.querySelector('.check-add input')?.focus();
  };

  const rows = items.map((item) => {
    const text = el('input', { class: 'check-text', maxlength: '300', autocomplete: 'off', 'aria-label': 'Checklist item' });
    text.value = item.text;
    text.addEventListener('change', () => {
      try {
        store.updateChecklistItem(board.id, item.id, { text: text.value });
        showMessage('');
      } catch (e) {
        showMessage(e.message);
        refresh(); // put the old text back
      }
    });
    text.addEventListener('keydown', (e) => { if (e.key === 'Enter') text.blur(); });
    return el('li', { class: `check-item${item.done ? ' done' : ''}` },
      el('input', { type: 'checkbox', checked: item.done, 'aria-label': `Mark "${item.text}" ${item.done ? 'not done' : 'done'}`,
        onchange: (e) => run(() => store.updateChecklistItem(board.id, item.id, { done: e.target.checked })) }),
      text,
      el('button', { type: 'button', class: 'mini', text: '✕', 'aria-label': `Delete checklist item "${item.text}"`,
        onclick: () => run(() => store.deleteChecklistItem(board.id, item.id)) }));
  });

  const input = el('input', { id: 'check-new', placeholder: 'Add an item and press Enter', maxlength: '300', autocomplete: 'off' });
  // Pasting several lines (an agenda, a list) adds one item per line.
  input.addEventListener('paste', (e) => {
    const lines = pastedLines(e.clipboardData?.getData('text') ?? '');
    if (!lines) return;
    e.preventDefault();
    run(() => lines.forEach((l) => store.addChecklistItem(board.id, l)), true);
  });
  const form = el('form', { class: 'check-add',
    onsubmit: (e) => { e.preventDefault(); run(() => store.addChecklistItem(board.id, input.value), true); } },
  el('label', { class: 'sr-only', for: 'check-new', text: 'New checklist item' }), input,
  el('button', { type: 'submit', class: 'btn', text: 'Add' }));

  panel.replaceChildren(
    el('div', { class: 'notes-head' },
      el('h2', { text: `Checklist${items.length ? ` (${done}/${items.length})` : ''}` }),
      done ? el('button', { type: 'button', class: 'btn', text: 'Clear checked', onclick: () => run(() => store.clearCheckedItems(board.id)) }) : null),
    items.length
      ? el('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Checklist progress', 'aria-valuemin': '0',
        'aria-valuemax': String(items.length), 'aria-valuenow': String(done) },
      el('span', { style: `width:${Math.round((done / items.length) * 100)}%` }))
      : null,
    items.length ? el('ul', { class: 'check-list' }, ...rows) : el('p', { class: 'count', text: 'No items yet. Add agenda points or things to confirm. Pasting a list adds one item per line.' }),
    form);
}

function renderNotes(board) {
  const m = board.meeting;
  const root = $('notes-view');
  root.replaceChildren();

  const date = el('input', { id: 'meeting-date', type: 'date' });
  date.value = m.date ?? '';
  date.addEventListener('change', () => {
    flushMeeting();
    guard(() => { store.updateMeeting(board.id, { date: date.value }); renderBoards(); });
  });
  const attendees = el('input', { id: 'meeting-attendees', placeholder: 'Names, comma separated', maxlength: '300', autocomplete: 'off' });
  attendees.value = m.attendees;
  attendees.addEventListener('input', () => queueMeetingSave(board.id, { attendees: attendees.value }));
  attendees.addEventListener('blur', flushMeeting);
  const notes = el('textarea', { id: 'meeting-notes', rows: '14', placeholder: 'Agenda, discussion, decisions…' });
  notes.value = m.notes;
  notes.addEventListener('input', () => queueMeetingSave(board.id, { notes: notes.value }));
  notes.addEventListener('blur', flushMeeting);

  const today = todayISO();
  const items = store.tasks.filter((t) => t.boardId === board.id);
  const open = items.filter((t) => !t.done).length;
  const list = el('ul', { class: 'action-list' }, ...items.map((t) => el('li', { class: `action${t.done ? ' done' : ''}` },
    el('input', { type: 'checkbox', checked: t.done, 'aria-label': `Mark "${t.title}" ${t.done ? 'not done' : 'done'}`,
      onchange: () => { store.toggleTask(t.id); render(); } }),
    el('button', { type: 'button', class: 'action-title', text: t.title, onclick: () => openDialog(t) }),
    t.dueDate && el('span', { class: `cell-muted due${isOverdue(t, today) ? ' overdue' : ''}`, text: formatDue(t.dueDate) }),
    pill(t.priority, PRIORITY_LABEL[t.priority]))));

  const checklistPanel = el('div', { class: 'notes-panel', id: 'checklist-panel' });
  renderChecklist(board, checklistPanel);

  root.append(
    el('div', { class: 'notes-panel' },
      el('div', { class: 'notes-fields' },
        el('label', {}, 'Date', date),
        el('label', { class: 'grow' }, 'Attendees', attendees)),
      el('label', {}, 'Meeting notes', notes)),
    checklistPanel,
    el('div', { class: 'notes-panel' },
      el('div', { class: 'notes-head' },
        el('h2', { text: `Action items (${open} open)` }),
        el('button', { type: 'button', class: 'btn', text: '+ Add action item', onclick: () => openDialog(null) })),
      items.length ? list : el('p', { class: 'count', text: 'No action items yet. Add one, or drag them around in the Board tab.' })));
}

// ---------- Page ----------
function pageTitle() {
  if (view.mode === 'notes' && currentBoard()) return currentBoard().name;
  const parts = [currentBoard()?.name ?? 'All boards'];
  const f = FILTERS.find(([k]) => k === view.filter);
  if (f && view.filter !== 'all') parts.push(f[1]);
  if (view.tag) parts.push(`#${view.tag}`);
  return parts.join(' · ');
}

function renderTasks() {
  const board = currentBoard();
  const isMeeting = board?.kind === 'meeting';
  if (view.mode === 'notes' && !isMeeting) view.mode = view.lastMode === 'board' && board ? 'board' : 'list';
  if (view.mode === 'board' && !board) view.mode = 'list';
  const mode = view.mode;

  $('tab-notes').hidden = !isMeeting;
  for (const [id, name] of [['list-view', 'list'], ['board-view', 'board'], ['notes-view', 'notes']]) $(id).hidden = mode !== name;
  for (const [id, name] of [['tab-notes', 'notes'], ['tab-list', 'list'], ['tab-board', 'board']]) $(id).setAttribute('aria-selected', String(mode === name));
  $('toolbar').hidden = mode === 'notes';
  $('page-title').textContent = pageTitle();

  if (mode === 'notes') {
    renderNotes(board);
    $('empty').hidden = true;
    return;
  }
  const tasks = queryTasks(store.tasks,
    { boardId: view.boardId, status: view.filter, tag: view.tag, search: view.search, sort: view.sort }, todayISO());
  if (mode === 'board') renderBoard(tasks); else renderListView(tasks);
  $('empty').hidden = tasks.length > 0 || mode === 'board';
  $('count').textContent = `${tasks.length} card${tasks.length === 1 ? '' : 's'}`;
  $('clear-done').disabled = !store.tasks.some((t) => t.done);
}

function render() {
  flushMeeting();
  renderFilters();
  renderBoards();
  renderTags();
  renderTasks();
}

function setMode(mode) {
  flushMeeting();
  view.mode = mode;
  if (mode !== 'notes') view.lastMode = mode;
  if (mode === 'board' && !view.boardId) view.boardId = INBOX_ID; // the board view shows one board's columns
  saveUi();
  render();
}
$('tab-notes').addEventListener('click', () => setMode('notes'));
$('tab-list').addEventListener('click', () => setMode('list'));
$('tab-board').addEventListener('click', () => setMode('board'));

// ---------- Create / edit dialog ----------
const dlg = $('task-dialog');

// ----- Checklists inside the card dialog: edited as a working copy, saved with the card (Cancel discards) -----
let draftChecklists = [];

function noEnterSubmit(input, onEnter) {
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault(); // Enter must not save the whole card
    onEnter?.();
  });
}

function draftChecklist(list, index) {
  const total = list.items.length;
  const done = list.items.filter((i) => i.done).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  const title = el('input', { class: 'cl-title', maxlength: '80', autocomplete: 'off', 'aria-label': 'Checklist title', 'data-focus': `title.${index}` });
  title.value = list.title;
  title.addEventListener('input', () => { list.title = title.value; });
  noEnterSubmit(title, () => title.blur());

  const rows = list.items.map((item, i) => {
    if (list.hideChecked && item.done) return null;
    const text = el('input', { class: 'check-text', maxlength: '300', autocomplete: 'off', 'aria-label': 'Checklist item' });
    text.value = item.text;
    text.addEventListener('input', () => { item.text = text.value; });
    noEnterSubmit(text, () => text.blur());
    return el('li', { class: `check-item${item.done ? ' done' : ''}` },
      el('input', { type: 'checkbox', checked: item.done, 'data-focus': `item.${index}.${i}`,
        'aria-label': `Mark "${item.text}" ${item.done ? 'not done' : 'done'}`,
        onchange: (e) => { item.done = e.target.checked; renderDraftChecklists(`item.${index}.${i}`); } }),
      text,
      el('button', { type: 'button', class: 'mini', text: '✕', 'aria-label': `Delete item "${item.text}"`,
        onclick: () => { list.items.splice(i, 1); renderDraftChecklists(`add.${index}`); } }));
  });

  const input = el('input', { class: 'cl-add-input', placeholder: 'Add an item', maxlength: '300', autocomplete: 'off',
    'aria-label': `New item for ${list.title}`, 'data-focus': `add.${index}` });
  const add = () => {
    const text = input.value.trim();
    if (!text) return;
    list.items.push({ text, done: false });
    renderDraftChecklists(`add.${index}`);
  };
  noEnterSubmit(input, add);
  input.addEventListener('paste', (e) => {
    const lines = pastedLines(e.clipboardData?.getData('text') ?? '');
    if (!lines) return;
    e.preventDefault();
    for (const text of lines) list.items.push({ text, done: false });
    renderDraftChecklists(`add.${index}`);
  });

  return el('section', { class: 'cl', 'aria-label': `Checklist ${list.title}` },
    el('div', { class: 'cl-head' },
      el('span', { class: 'cl-icon', 'aria-hidden': 'true', text: '☑' }), title,
      done || list.hideChecked
        ? el('button', { type: 'button', class: 'btn', text: list.hideChecked ? 'Show checked items' : 'Hide checked items', 'data-focus': `hide.${index}`,
          onclick: () => { list.hideChecked = !list.hideChecked; renderDraftChecklists(`hide.${index}`); } })
        : null,
      el('button', { type: 'button', class: 'btn', text: 'Delete', 'aria-label': `Delete checklist ${list.title}`,
        onclick: () => {
          if (total && !confirm(`Delete checklist "${list.title}" and its ${total} item${total === 1 ? '' : 's'}?`)) return;
          draftChecklists.splice(index, 1);
          renderDraftChecklists();
        } })),
    el('div', { class: 'cl-progress' },
      el('span', { class: 'cl-pct', text: `${pct}%` }),
      el('div', { class: `progress${total && done === total ? ' complete' : ''}`, role: 'progressbar', 'aria-label': `${list.title} progress`,
        'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(done) },
      el('span', { style: `width:${pct}%` }))),
    rows.some(Boolean) ? el('ul', { class: 'check-list' }, ...rows) : null,
    el('div', { class: 'cl-add' }, input, el('button', { type: 'button', class: 'btn', text: 'Add', onclick: add })));
}

function renderDraftChecklists(focusKey = null) {
  const root = $('dlg-checklists');
  root.replaceChildren(...draftChecklists.map(draftChecklist));
  if (focusKey) {
    const target = root.querySelector(`[data-focus="${focusKey}"]`);
    target?.focus();
    if (target?.classList.contains('cl-title')) target.select();
  }
}

function fillColumns(boardId, selected) {
  const board = boardById(boardId) ?? store.boards[0];
  $('column').replaceChildren(...board.columns.map((c) => el('option', { value: c.id, text: c.name })));
  $('column').value = board.columns.some((c) => c.id === selected) ? selected : board.columns[0].id;
}

function openDialog(task, preset = {}) {
  editingId = task ? task.id : null;
  $('task-form').reset();
  const group = (label, boards) => (boards.length ? el('optgroup', { label }, ...boards.map((b) => el('option', { value: b.id, text: b.name }))) : null);
  $('board').replaceChildren(
    group('Boards', store.boards.filter((b) => b.kind !== 'meeting')),
    group('Meetings', store.boards.filter((b) => b.kind === 'meeting')));
  $('dlg-title').textContent = task ? 'Edit card' : 'Create card';
  $('submit-btn').textContent = task ? 'Save' : 'Create';
  $('title').value = task?.title ?? '';
  $('board').value = task?.boardId ?? view.boardId ?? INBOX_ID;
  fillColumns($('board').value, task?.columnId ?? preset.columnId);
  $('priority').value = task?.priority ?? 'medium';
  $('due').value = task?.dueDate ?? '';
  $('tags').value = task ? task.tags.join(', ') : (view.tag ?? '');
  $('notes').value = task?.notes ?? '';
  draftChecklists = JSON.parse(JSON.stringify(task?.checklists ?? []));
  renderDraftChecklists();
  $('dialog-error').hidden = true;
  dlg.showModal();
  $('title').focus();
}

$('board').addEventListener('change', () => fillColumns($('board').value));
$('create-btn').addEventListener('click', () => openDialog(null));
$('cancel-btn').addEventListener('click', () => dlg.close());
$('add-checklist').addEventListener('click', () => {
  draftChecklists.push({ title: 'Checklist', hideChecked: false, items: [] });
  renderDraftChecklists(`title.${draftChecklists.length - 1}`);
});
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

$('task-form').addEventListener('submit', (e) => {
  e.preventDefault();
  // text typed in an "Add an item" box but not added yet still counts
  $('dlg-checklists').querySelectorAll('.cl-add-input').forEach((input, i) => {
    const text = input.value.trim();
    if (text && draftChecklists[i]) draftChecklists[i].items.push({ text, done: false });
  });
  const data = {
    title: $('title').value, boardId: $('board').value, columnId: $('column').value,
    priority: $('priority').value, dueDate: $('due').value, tags: $('tags').value, notes: $('notes').value,
    checklists: draftChecklists,
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
$('new-meeting-date').value = todayISO();
$('meeting-form').addEventListener('submit', (e) => {
  e.preventDefault();
  guard(() => {
    flushMeeting();
    const meeting = store.addBoard($('new-meeting-name').value, { kind: 'meeting', date: $('new-meeting-date').value || null });
    $('new-meeting-name').value = '';
    $('new-meeting-date').value = todayISO();
    view.boardId = meeting.id;
    view.mode = 'notes';
    saveUi();
    render();
    $('meeting-notes')?.focus();
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
    view.mode = view.lastMode === 'board' ? 'board' : 'list';
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
