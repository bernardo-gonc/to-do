import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// store.js is a classic script (so the app opens from file://); load it and read its global.
vm.runInThisContext(fs.readFileSync(new URL('../js/store.js', import.meta.url), 'utf8'));
const { Store, INBOX_ID, STORAGE_KEY, queryTasks, isOverdue, normalizeTags, sanitizeState } = globalThis.TodoStore;

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    data,
  };
}

const col = (board, name) => board.columns.find((c) => c.name === name);

test('starts with an Inbox board with To do / Doing / Done', () => {
  const s = new Store(memoryStorage());
  assert.equal(s.boards.length, 1);
  assert.equal(s.boards[0].id, INBOX_ID);
  assert.deepEqual(s.boards[0].columns.map((c) => [c.name, c.done]), [['To do', false], ['Doing', false], ['Done', true]]);
  assert.equal(s.tasks.length, 0);
});

test('add, update, toggle, delete task', () => {
  const s = new Store(memoryStorage());
  const t = s.addTask({ title: '  Buy milk ', tags: 'Home, #errand, home' });
  assert.equal(t.title, 'Buy milk');
  assert.deepEqual(t.tags, ['home', 'errand']);
  assert.equal(t.columnId, s.boards[0].columns[0].id);
  s.updateTask(t.id, { title: 'Buy oat milk', priority: 'high', dueDate: '2026-01-02' });
  assert.equal(s.tasks[0].priority, 'high');
  s.toggleTask(t.id);
  assert.equal(s.tasks[0].done, true);
  assert.equal(s.tasks[0].columnId, col(s.boards[0], 'Done').id);
  assert.ok(s.tasks[0].completedAt);
  s.toggleTask(t.id);
  assert.equal(s.tasks[0].done, false);
  assert.equal(s.tasks[0].columnId, col(s.boards[0], 'To do').id);
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
  a.addBoard('Work');
  a.addTask({ title: 'Persist me' });
  const b = new Store(storage);
  assert.equal(b.tasks[0].title, 'Persist me');
  assert.equal(b.boards.length, 2);
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

test('boards: new boards get default columns; names are unique and non-empty', () => {
  const s = new Store(memoryStorage());
  const b = s.addBoard('Work');
  assert.equal(b.columns.length, 3);
  assert.notEqual(b.columns[0].id, s.boards[0].columns[0].id);
  assert.throws(() => s.addBoard('work'));
  assert.throws(() => s.addBoard(' '));
  s.renameBoard(b.id, 'Office');
  assert.equal(s.boards[1].name, 'Office');
  assert.throws(() => s.renameBoard(INBOX_ID, 'x'));
});

test('cards can be created in a specific board and column', () => {
  const s = new Store(memoryStorage());
  const b = s.addBoard('Work');
  s.addColumn(b.id, 'Review');
  const review = col(b, 'Review');
  const t = s.addTask({ title: 'Check PR', boardId: b.id, columnId: review.id });
  assert.equal(t.boardId, b.id);
  assert.equal(t.columnId, review.id);
  assert.equal(t.done, false);
  // unknown column falls back to the board's first column
  assert.equal(s.addTask({ title: 'x', boardId: b.id, columnId: 'nope' }).columnId, b.columns[0].id);
  // unknown board falls back to the Inbox
  assert.equal(s.addTask({ title: 'y', boardId: 'nope' }).boardId, INBOX_ID);
});

test('columns: add, rename, uniqueness', () => {
  const s = new Store(memoryStorage());
  const b = s.addBoard('Work');
  const c = s.addColumn(b.id, 'Blocked');
  assert.equal(b.columns.length, 4);
  assert.throws(() => s.addColumn(b.id, 'blocked'));
  assert.throws(() => s.addColumn(b.id, ' '));
  s.renameColumn(b.id, c.id, 'Waiting');
  assert.equal(col(b, 'Waiting').id, c.id);
  assert.throws(() => s.renameColumn(b.id, c.id, 'Doing'));
});

test('deleting a column moves its cards to the first remaining column; last column is protected', () => {
  const s = new Store(memoryStorage());
  const b = s.addBoard('Work');
  const doing = col(b, 'Doing');
  const t = s.addTask({ title: 'a', boardId: b.id, columnId: doing.id });
  s.deleteColumn(b.id, doing.id);
  assert.equal(s.tasks[0].columnId, b.columns[0].id);
  assert.equal(t.done, false);
  s.deleteColumn(b.id, col(b, 'Done').id);
  assert.equal(b.columns.length, 1);
  assert.throws(() => s.deleteColumn(b.id, b.columns[0].id));
});

test('moveTask: done columns complete cards, other columns reopen them', () => {
  const s = new Store(memoryStorage());
  const b = s.boards[0];
  const t = s.addTask({ title: 'a' });
  s.moveTask(t.id, col(b, 'Doing').id);
  assert.equal(s.tasks[0].done, false);
  s.moveTask(t.id, col(b, 'Done').id);
  assert.equal(s.tasks[0].done, true);
  assert.ok(s.tasks[0].completedAt);
  s.moveTask(t.id, col(b, 'Doing').id);
  assert.equal(s.tasks[0].done, false);
  assert.equal(s.tasks[0].completedAt, null);
  assert.throws(() => s.moveTask(t.id, 'nope'));
});

test('moveTask can move a card to another board', () => {
  const s = new Store(memoryStorage());
  const w = s.addBoard('Work');
  const t = s.addTask({ title: 'a' });
  s.moveTask(t.id, w.columns[1].id);
  assert.equal(s.tasks[0].boardId, w.id);
  assert.equal(s.tasks[0].columnId, w.columns[1].id);
});

test('updateTask can change board and column; keeping the same column does not reset done', () => {
  const s = new Store(memoryStorage());
  const w = s.addBoard('Work');
  const t = s.addTask({ title: 'a' });
  s.updateTask(t.id, { boardId: w.id });
  assert.equal(s.tasks[0].boardId, w.id);
  assert.equal(s.tasks[0].columnId, w.columns[0].id);
  s.updateTask(t.id, { boardId: w.id, columnId: w.columns[2].id });
  assert.equal(s.tasks[0].done, true);
  s.updateTask(t.id, { title: 'renamed', boardId: w.id, columnId: w.columns[2].id });
  assert.equal(s.tasks[0].done, true);
});

test('board without a done column: checkbox just toggles done', () => {
  const s = new Store(memoryStorage());
  const b = s.addBoard('Notes');
  s.setColumnDone(b.id, col(b, 'Done').id, false);
  const t = s.addTask({ title: 'a', boardId: b.id, columnId: col(b, 'Doing').id });
  s.toggleTask(t.id);
  assert.equal(s.tasks[0].done, true);
  assert.equal(s.tasks[0].columnId, col(b, 'Doing').id);
  s.toggleTask(t.id);
  assert.equal(s.tasks[0].done, false);
});

test('setColumnDone updates the cards already in the column', () => {
  const s = new Store(memoryStorage());
  const b = s.boards[0];
  const t = s.addTask({ title: 'a', columnId: col(b, 'Doing').id });
  s.setColumnDone(b.id, col(b, 'Doing').id, true);
  assert.equal(s.tasks[0].done, true);
  s.setColumnDone(b.id, col(b, 'Doing').id, false);
  assert.equal(s.tasks[0].done, false);
  assert.equal(t.completedAt, null);
});

test('deleting a board moves its cards to the Inbox and keeps done state; Inbox is protected', () => {
  const s = new Store(memoryStorage());
  const w = s.addBoard('Work');
  s.addTask({ title: 'open', boardId: w.id });
  const d = s.addTask({ title: 'closed', boardId: w.id });
  s.toggleTask(d.id);
  s.deleteBoard(w.id);
  assert.equal(s.boards.length, 1);
  const inbox = s.boards[0];
  const open = s.tasks.find((t) => t.title === 'open');
  const closed = s.tasks.find((t) => t.title === 'closed');
  assert.equal(open.boardId, INBOX_ID);
  assert.equal(open.columnId, col(inbox, 'To do').id);
  assert.equal(closed.done, true);
  assert.equal(closed.columnId, col(inbox, 'Done').id);
  assert.throws(() => s.deleteBoard(INBOX_ID));
});

test('clearCompleted removes only done tasks', () => {
  const s = new Store(memoryStorage());
  const a = s.addTask({ title: 'a' });
  s.addTask({ title: 'b' });
  s.toggleTask(a.id);
  assert.equal(s.clearCompleted(), 1);
  assert.deepEqual(s.tasks.map((t) => t.title), ['b']);
});

test('allTags can be scoped to a board', () => {
  const s = new Store(memoryStorage());
  const w = s.addBoard('Work');
  s.addTask({ title: 'a', tags: 'x,y' });
  s.addTask({ title: 'b', tags: 'y', boardId: w.id });
  assert.deepEqual(s.allTags().map((t) => t.tag), ['x', 'y']);
  assert.deepEqual(s.allTags(w.id), [{ tag: 'y', count: 1 }]);
});

test('queryTasks filters by status, board, tag and search', () => {
  const s = new Store(memoryStorage());
  const work = s.addBoard('Work');
  s.addTask({ title: 'Overdue thing', dueDate: '2026-01-01', tags: ['urgent'] });
  s.addTask({ title: 'Today thing', dueDate: '2026-06-15', boardId: work.id });
  const done = s.addTask({ title: 'Finished', notes: 'secret keyword' });
  s.toggleTask(done.id);
  const today = '2026-06-15';
  const q = (opts) => queryTasks(s.tasks, opts, today).map((t) => t.title);
  assert.deepEqual(q({ status: 'overdue' }), ['Overdue thing']);
  assert.deepEqual(q({ status: 'today' }), ['Today thing']);
  assert.deepEqual(q({ status: 'completed' }), ['Finished']);
  assert.equal(q({ status: 'active' }).length, 2);
  assert.deepEqual(q({ boardId: work.id }), ['Today thing']);
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

test('export/import round-trip keeps boards, columns and cards', () => {
  const a = new Store(memoryStorage());
  const w = a.addBoard('Work');
  const review = a.addColumn(w.id, 'Review');
  a.addTask({ title: 'Task', tags: ['x'], boardId: w.id, columnId: review.id });
  const b = new Store(memoryStorage());
  b.importJSON(a.exportJSON());
  assert.equal(b.tasks[0].title, 'Task');
  assert.equal(b.boards.length, 2);
  assert.equal(b.tasks[0].columnId, review.id);
  assert.equal(b.boards[1].columns.length, 4);
});

test('import rejects bad data without clobbering current data', () => {
  const s = new Store(memoryStorage());
  s.addTask({ title: 'keep me' });
  assert.throws(() => s.importJSON('nope'));
  assert.throws(() => s.importJSON('{"tasks":1}'));
  assert.equal(s.tasks[0].title, 'keep me');
});

test('sanitizeState repairs unknown boards/columns, priorities and bad dates', () => {
  const st = sanitizeState({
    boards: [{ id: 'b1', name: 'B', columns: [{ id: 'c1', name: 'One' }, { id: 'c2', name: 'Two', done: true }] }],
    tasks: [
      { title: 'x', boardId: 'ghost', priority: 'urgent', dueDate: 'tomorrow', tags: 'A,b' },
      { title: 'y', boardId: 'b1', columnId: 'missing' },
      { title: 'z', boardId: 'b1', columnId: 'c2' },
      { title: '' },
    ],
  });
  assert.equal(st.tasks.length, 3);
  assert.equal(st.tasks[0].boardId, INBOX_ID);
  assert.equal(st.tasks[0].priority, 'medium');
  assert.equal(st.tasks[0].dueDate, null);
  assert.deepEqual(st.tasks[0].tags, ['a', 'b']);
  assert.equal(st.tasks[1].columnId, 'c1');
  assert.equal(st.tasks[2].done, true);
});

test('migrates version 1 data (lists + status) to boards and columns', () => {
  const v1 = {
    version: 1,
    lists: [{ id: 'inbox', name: 'Inbox' }, { id: 'w', name: 'Work' }],
    tasks: [
      { id: 't1', title: 'a', listId: 'w', status: 'doing', done: false, tags: ['x'], priority: 'high', dueDate: '2026-01-01' },
      { id: 't2', title: 'b', listId: 'inbox', status: 'done', done: true },
      { id: 't3', title: 'c', listId: 'gone', done: true },
      { id: 't4', title: 'd', done: false },
    ],
  };
  const s = new Store(memoryStorage({ [STORAGE_KEY]: JSON.stringify(v1) }));
  assert.deepEqual(s.boards.map((b) => b.name), ['Inbox', 'Work']);
  const work = s.boards[1];
  const byTitle = (t) => s.tasks.find((x) => x.title === t);
  assert.equal(byTitle('a').boardId, 'w');
  assert.equal(byTitle('a').columnId, col(work, 'Doing').id);
  assert.equal(byTitle('a').priority, 'high');
  assert.equal(byTitle('b').columnId, col(s.boards[0], 'Done').id);
  assert.equal(byTitle('b').done, true);
  assert.equal(byTitle('c').boardId, INBOX_ID);
  assert.equal(byTitle('c').done, true);
  assert.equal(byTitle('d').columnId, col(s.boards[0], 'To do').id);
});

test('normalizeTags', () => {
  assert.deepEqual(normalizeTags(' A , #b,,a '), ['a', 'b']);
  assert.deepEqual(normalizeTags(undefined), []);
});

test('moveTask orders cards: before a card, to the end, and across columns', () => {
  const s = new Store(memoryStorage());
  const b = s.boards[0];
  const todo = col(b, 'To do').id;
  const doing = col(b, 'Doing').id;
  const a = s.addTask({ title: 'A' });
  const bb = s.addTask({ title: 'B' });
  const c = s.addTask({ title: 'C' });
  const order = (columnId) => queryTasks(s.tasks, { sort: 'manual' }).filter((t) => t.columnId === columnId).map((t) => t.title);
  assert.deepEqual(order(todo), ['A', 'B', 'C']); // new cards go to the bottom
  s.moveTask(c.id, todo, a.id);
  assert.deepEqual(order(todo), ['C', 'A', 'B']);
  s.moveTask(c.id, todo); // to the end
  assert.deepEqual(order(todo), ['A', 'B', 'C']);
  s.moveTask(a.id, todo, c.id); // in the middle
  assert.deepEqual(order(todo), ['B', 'A', 'C']);
  s.moveTask(c.id, doing);
  s.moveTask(bb.id, doing, c.id);
  assert.deepEqual(order(doing), ['B', 'C']);
  assert.deepEqual(order(todo), ['A']);
  // a "before" card from another column is ignored: the card goes to the end
  s.moveTask(a.id, doing, 'nope');
  assert.deepEqual(order(doing), ['B', 'C', 'A']);
  s.moveTask(a.id, doing, a.id); // before itself: stays last
  assert.deepEqual(order(doing), ['B', 'C', 'A']);
});

test('manual order persists and done cards do not sink in manual sort', () => {
  const storage = memoryStorage();
  const s = new Store(storage);
  const x = s.addTask({ title: 'X' });
  s.addTask({ title: 'Y' });
  const z = s.addTask({ title: 'Z' });
  s.toggleTask(x.id); // X is done, but stays first in the stored order
  s.moveTask(z.id, s.boards[0].columns[0].id, s.tasks.find((t) => t.title === 'Y').id);
  const titles = (sort) => queryTasks(new Store(storage).tasks, { sort }).map((t) => t.title);
  assert.deepEqual(titles('manual'), ['X', 'Z', 'Y']);
  assert.equal(titles('created').at(-1), 'X'); // other sorts still sink done cards
});
