import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// store.js is a classic script (so the app opens from file://); load it and read its global.
vm.runInThisContext(fs.readFileSync(new URL('../js/store.js', import.meta.url), 'utf8'));
const { Store, INBOX_ID, STORAGE_KEY, STATUSES, queryTasks, isOverdue, normalizeTags, sanitizeState } = globalThis.TodoStore;

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    data,
  };
}

test('starts with an Inbox and no tasks', () => {
  const s = new Store(memoryStorage());
  assert.deepEqual(s.lists, [{ id: INBOX_ID, name: 'Inbox' }]);
  assert.equal(s.tasks.length, 0);
});

test('add, update, toggle, delete task', () => {
  const s = new Store(memoryStorage());
  const t = s.addTask({ title: '  Buy milk ', tags: 'Home, #errand, home' });
  assert.equal(t.title, 'Buy milk');
  assert.deepEqual(t.tags, ['home', 'errand']);
  s.updateTask(t.id, { title: 'Buy oat milk', priority: 'high', dueDate: '2026-01-02' });
  assert.equal(s.tasks[0].priority, 'high');
  s.toggleTask(t.id);
  assert.equal(s.tasks[0].done, true);
  assert.ok(s.tasks[0].completedAt);
  s.toggleTask(t.id);
  assert.equal(s.tasks[0].completedAt, null);
  s.deleteTask(t.id);
  assert.equal(s.tasks.length, 0);
});

test('rejects empty titles', () => {
  const s = new Store(memoryStorage());
  assert.throws(() => s.addTask({ title: '   ' }));
  const t = s.addTask({ title: 'x' });
  assert.throws(() => s.updateTask(t.id, { title: '' }));
});

test('persists and reloads', () => {
  const storage = memoryStorage();
  const a = new Store(storage);
  a.addTask({ title: 'Persist me' });
  const b = new Store(storage);
  assert.equal(b.tasks[0].title, 'Persist me');
});

test('corrupt storage falls back to empty state', () => {
  const s = new Store(memoryStorage({ [STORAGE_KEY]: '{not json' }));
  assert.equal(s.tasks.length, 0);
});

test('works when storage is missing or throws', () => {
  const s = new Store(null);
  s.addTask({ title: 'in memory' });
  assert.equal(s.tasks.length, 1);
  const bad = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  const s2 = new Store(bad);
  s2.addTask({ title: 'still works' });
  assert.equal(s2.tasks.length, 1);
});

test('deleting a list moves its tasks to Inbox; Inbox is protected', () => {
  const s = new Store(memoryStorage());
  const list = s.addList('Work');
  const t = s.addTask({ title: 'Report', listId: list.id });
  assert.equal(t.listId, list.id);
  s.deleteList(list.id);
  assert.equal(s.tasks[0].listId, INBOX_ID);
  assert.equal(s.lists.length, 1);
  assert.throws(() => s.deleteList(INBOX_ID));
  assert.throws(() => s.renameList(INBOX_ID, 'x'));
});

test('list names must be unique and non-empty', () => {
  const s = new Store(memoryStorage());
  s.addList('Work');
  assert.throws(() => s.addList('work'));
  assert.throws(() => s.addList(' '));
});

test('clearCompleted removes only done tasks', () => {
  const s = new Store(memoryStorage());
  const a = s.addTask({ title: 'a' });
  s.addTask({ title: 'b' });
  s.toggleTask(a.id);
  assert.equal(s.clearCompleted(), 1);
  assert.deepEqual(s.tasks.map((t) => t.title), ['b']);
});

test('queryTasks filters by status, list, tag and search', () => {
  const s = new Store(memoryStorage());
  const work = s.addList('Work');
  s.addTask({ title: 'Overdue thing', dueDate: '2026-01-01', tags: ['urgent'] });
  s.addTask({ title: 'Today thing', dueDate: '2026-06-15', listId: work.id });
  const done = s.addTask({ title: 'Finished', notes: 'secret keyword' });
  s.toggleTask(done.id);
  const today = '2026-06-15';
  const q = (opts) => queryTasks(s.tasks, opts, today).map((t) => t.title);
  assert.deepEqual(q({ status: 'overdue' }), ['Overdue thing']);
  assert.deepEqual(q({ status: 'today' }), ['Today thing']);
  assert.deepEqual(q({ status: 'completed' }), ['Finished']);
  assert.equal(q({ status: 'active' }).length, 2);
  assert.deepEqual(q({ listId: work.id }), ['Today thing']);
  assert.deepEqual(q({ tag: 'urgent' }), ['Overdue thing']);
  assert.deepEqual(q({ search: 'KEYWORD' }), ['Finished']);
});

test('sorting: due date nulls last, priority order, done tasks sink', () => {
  const s = new Store(memoryStorage());
  s.addTask({ title: 'none', priority: 'low' });
  s.addTask({ title: 'late', dueDate: '2026-12-01', priority: 'low' });
  s.addTask({ title: 'soon', dueDate: '2026-02-01', priority: 'high' });
  const d = s.addTask({ title: 'done-early', dueDate: '2026-01-01' });
  s.toggleTask(d.id);
  const titles = (sort) => queryTasks(s.tasks, { sort }).map((t) => t.title);
  assert.deepEqual(titles('due'), ['soon', 'late', 'none', 'done-early']);
  assert.equal(titles('priority')[0], 'soon');
  assert.equal(titles('priority').at(-1), 'done-early');
});

test('isOverdue ignores done tasks and undated tasks', () => {
  assert.equal(isOverdue({ done: false, dueDate: '2020-01-01' }, '2026-01-01'), true);
  assert.equal(isOverdue({ done: true, dueDate: '2020-01-01' }, '2026-01-01'), false);
  assert.equal(isOverdue({ done: false, dueDate: null }, '2026-01-01'), false);
});

test('export/import round-trip', () => {
  const a = new Store(memoryStorage());
  a.addList('Work');
  a.addTask({ title: 'Task', tags: ['x'] });
  const b = new Store(memoryStorage());
  b.importJSON(a.exportJSON());
  assert.equal(b.tasks[0].title, 'Task');
  assert.equal(b.lists.length, 2);
});

test('import rejects bad data without clobbering current data', () => {
  const s = new Store(memoryStorage());
  s.addTask({ title: 'keep me' });
  assert.throws(() => s.importJSON('nope'));
  assert.throws(() => s.importJSON('{"tasks":1}'));
  assert.equal(s.tasks[0].title, 'keep me');
});

test('sanitizeState repairs unknown lists, priorities and bad dates', () => {
  const st = sanitizeState({
    lists: [],
    tasks: [{ title: 'x', listId: 'ghost', priority: 'urgent', dueDate: 'tomorrow', tags: 'A,b' }, { title: '' }],
  });
  assert.equal(st.tasks.length, 1);
  assert.equal(st.tasks[0].listId, INBOX_ID);
  assert.equal(st.tasks[0].priority, 'medium');
  assert.equal(st.tasks[0].dueDate, null);
  assert.deepEqual(st.tasks[0].tags, ['a', 'b']);
});

test('normalizeTags', () => {
  assert.deepEqual(normalizeTags(' A , #b,,a '), ['a', 'b']);
  assert.deepEqual(normalizeTags(undefined), []);
});

test('status stays consistent with done/completedAt', () => {
  const s = new Store(memoryStorage());
  const t = s.addTask({ title: 'x' });
  assert.equal(t.status, 'todo');
  s.setStatus(t.id, 'doing');
  assert.equal(s.tasks[0].status, 'doing');
  assert.equal(s.tasks[0].done, false);
  s.setStatus(t.id, 'done');
  assert.equal(s.tasks[0].done, true);
  assert.ok(s.tasks[0].completedAt);
  s.toggleTask(t.id);
  assert.equal(s.tasks[0].status, 'todo');
  assert.equal(s.tasks[0].completedAt, null);
  s.toggleTask(t.id);
  assert.equal(s.tasks[0].status, 'done');
  s.updateTask(t.id, { status: 'doing' });
  assert.equal(s.tasks[0].done, false);
  assert.throws(() => s.setStatus(t.id, 'nope'));
  assert.deepEqual(STATUSES, ['todo', 'doing', 'done']);
});

test('can create a task directly in a status', () => {
  const s = new Store(memoryStorage());
  assert.equal(s.addTask({ title: 'a', status: 'done' }).done, true);
  assert.equal(s.addTask({ title: 'b', status: 'bogus' }).status, 'todo');
});

test('old data without status is migrated from done', () => {
  const st = sanitizeState({ lists: [], tasks: [{ title: 'a', done: true }, { title: 'b', done: false }] });
  assert.deepEqual(st.tasks.map((t) => t.status), ['done', 'todo']);
});
