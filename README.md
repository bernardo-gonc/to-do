# To-Do

A local, dependency-free to-do app. Everything runs in the browser and is saved in `localStorage`; there is no server and no account.

## Features
- Add, edit, complete and delete tasks, with notes
- Due dates (with today/overdue highlighting) and low/medium/high priority
- Lists (Inbox plus your own) and free-form tags
- Filters: All, Active, Completed, Due today, Overdue
- Search across title, notes and tags; sort by newest, due date or priority
- Export/import JSON backups; clear completed
- Light/dark theme follows your system

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
- `js/store.js` — data layer (storage, CRUD, filtering/sorting); no DOM access. A classic script exposing `TodoStore`, so the app works from `file://`
- `js/app.js` — UI rendering and events
- `tests/store.test.js` — unit tests for the data layer
