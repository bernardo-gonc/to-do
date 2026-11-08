# To-Do

A local, dependency-free to-do app. Everything runs in the browser and is saved in `localStorage`; there is no server and no account.

## Features
- **Boards** (Trello-style): create as many as you like. Each board has its own **columns** (start with To do / Doing / Done) that you can add, rename and delete
- **Board view**: drag cards between columns and to any position within a column (Sort: Manual; or focus a card and press Alt+↑ / Alt+↓); "+ Add a card" in any column; `✓` on a column makes its cards count as done
- **List view**: table grouped by column (or by board when "All boards" is selected), with coloured priority pills and a column dropdown per card
- Create/edit cards in a dialog: title, board, column, priority, due date (overdue highlighted), tags, notes
- Filters: All, Active, Completed, Due today, Overdue; tag filter; search; sort by newest, due date or priority
- Export/import JSON backups; clear completed
- Data from earlier versions (lists and To do/Doing/Done status) is converted automatically: lists become boards

## Run
No install or server needed: double-click `index.html` (or drag it into a browser) and bookmark it.

Keep the file in one place: browsers store the data per file location, so moving it starts you with an empty list. Use Export JSON to back up or move your tasks.

## Test
Requires Node 18+.

```bash
node --test tests/*.test.js
```

## Layout
- `index.html`, `styles.css` — page and styling
- `js/store.js` — data layer (storage, boards, columns, cards, filtering/sorting, migration); no DOM access. A classic script exposing `TodoStore`, so the app works from `file://`
- `js/app.js` — UI rendering and events
- `tests/store.test.js` — unit tests for the data layer
