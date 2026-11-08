import { Store, INBOX_ID, queryTasks, isOverdue, todayISO } from './store.js';

const store = new Store();
const $ = (id) => document.getElementById(id);

const view = { status: 'all', listId: null, tag: null, search: '', sort: 'created' };
let editingId = null;

const STATUS_FILTERS = [
  ['all', 'All'], ['active', 'Active'], ['completed', 'Completed'], ['today', 'Due today'], ['overdue', 'Overdue'],
];

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

function showMessage(text) {
  const m = $('message');
  m.textContent = text;
  m.hidden = !text;
}

function guard(fn) {
  try { fn(); showMessage(''); } catch (e) { showMessage(e.message); }
}

// ---------- Sidebar ----------
function renderStatusFilters() {
  const today = todayISO();
  const ul = $('status-filters');
  ul.replaceChildren();
  for (const [key, label] of STATUS_FILTERS) {
    const n = queryTasks(store.tasks, { status: key }, today).length;
    const btn = el('button', { class: 'nav-btn', type: 'button', 'aria-current': view.status === key,
      onclick: () => { view.status = key; render(); } },
      el('span', { text: label }), el('span', { class: 'count', text: String(n) }));
    ul.append(el('li', { class: 'nav-item' }, btn));
  }
}

function renderLists() {
  const ul = $('list-nav');
  ul.replaceChildren();
  const all = el('button', { class: 'nav-btn', type: 'button', 'aria-current': view.listId === null,
    onclick: () => { view.listId = null; render(); } }, el('span', { text: 'All lists' }));
  ul.append(el('li', { class: 'nav-item' }, all));

  for (const list of store.lists) {
    const n = store.tasks.filter((t) => t.listId === list.id && !t.done).length;
    const btn = el('button', { class: 'nav-btn', type: 'button', 'aria-current': view.listId === list.id,
      onclick: () => { view.listId = list.id; render(); } },
      el('span', { text: list.name }), el('span', { class: 'count', text: String(n) }));
    const li = el('li', { class: 'nav-item' }, btn);
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
          } }),
      );
    }
    ul.append(li);
  }

  const select = $('list');
  const current = select.value;
  select.replaceChildren(...store.lists.map((l) => el('option', { value: l.id, text: l.name })));
  select.value = store.lists.some((l) => l.id === current) ? current : (view.listId ?? INBOX_ID);
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

// ---------- Tasks ----------
function formatDue(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function renderTasks() {
  const today = todayISO();
  const tasks = queryTasks(store.tasks, view, today);
  const ul = $('tasks');
  ul.replaceChildren();
  for (const t of tasks) {
    const overdue = isOverdue(t, today);
    const listName = store.lists.find((l) => l.id === t.listId)?.name ?? 'Inbox';
    const meta = el('div', { class: 'meta' },
      t.dueDate && el('span', { class: `due${overdue ? ' overdue-text' : ''}`,
        text: `${overdue ? 'Overdue: ' : t.dueDate === today && !t.done ? 'Today: ' : 'Due '}${formatDue(t.dueDate)}` }),
      el('span', { class: 'chip', text: `${t.priority} priority` }),
      el('span', { class: 'chip', text: listName }),
      ...t.tags.map((tag) => el('span', { class: 'chip', text: `#${tag}` })));
    const body = el('div', {}, el('div', { class: 'title', text: t.title }),
      t.notes && el('p', { class: 'notes', text: t.notes }), meta);
    const checkbox = el('input', { type: 'checkbox', 'aria-label': `Mark "${t.title}" ${t.done ? 'not done' : 'done'}`,
      checked: t.done, onchange: () => { store.toggleTask(t.id); render(); } });
    const actions = el('div', { class: 'actions' },
      el('button', { type: 'button', text: 'Edit', 'aria-label': `Edit "${t.title}"`, onclick: () => startEdit(t.id) }),
      el('button', { type: 'button', class: 'delete', text: 'Delete', 'aria-label': `Delete "${t.title}"`,
        onclick: () => { store.deleteTask(t.id); if (editingId === t.id) stopEdit(); render(); } }));
    ul.append(el('li', { class: `task${t.done ? ' done' : ''}${overdue ? ' overdue' : ''}`, 'data-priority': t.priority },
      checkbox, body, actions));
  }
  $('empty').hidden = tasks.length > 0;
  $('count').textContent = `${tasks.length} task${tasks.length === 1 ? '' : 's'}`;
  $('clear-done').disabled = !store.tasks.some((t) => t.done);
}

function render() {
  renderStatusFilters();
  renderLists();
  renderTags();
  renderTasks();
}

// ---------- Form ----------
function startEdit(id) {
  const t = store.tasks.find((x) => x.id === id);
  if (!t) return;
  editingId = id;
  $('title').value = t.title;
  $('due').value = t.dueDate ?? '';
  $('priority').value = t.priority;
  $('list').value = t.listId;
  $('tags').value = t.tags.join(', ');
  $('notes').value = t.notes;
  $('form-title').textContent = 'Edit task';
  $('submit-btn').textContent = 'Save';
  $('cancel-btn').hidden = false;
  $('title').focus();
}

function stopEdit() {
  editingId = null;
  $('task-form').reset();
  $('list').value = view.listId ?? INBOX_ID;
  $('form-title').textContent = 'Add task';
  $('submit-btn').textContent = 'Add task';
  $('cancel-btn').hidden = true;
}

$('task-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const data = {
    title: $('title').value, dueDate: $('due').value, priority: $('priority').value,
    listId: $('list').value, tags: $('tags').value, notes: $('notes').value,
  };
  guard(() => {
    if (editingId) store.updateTask(editingId, data);
    else store.addTask(data);
    stopEdit();
    render();
    $('title').focus();
  });
});
$('cancel-btn').addEventListener('click', stopEdit);

$('list-form').addEventListener('submit', (e) => {
  e.preventDefault();
  guard(() => {
    const list = store.addList($('list-name').value);
    $('list-name').value = '';
    view.listId = list.id;
    render();
  });
});

// ---------- Toolbar / search ----------
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
    stopEdit();
    render();
    showMessage('');
  } catch (err) {
    showMessage(err.message);
  }
});

render();
