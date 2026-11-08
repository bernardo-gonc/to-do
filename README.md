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
ES modules need `http://`, so serve the folder rather than opening the file directly:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Test
Requires Node 18+.

```bash
node --test tests/*.test.js
```

## Layout
- `index.html`, `styles.css` — page and styling
- `js/store.js` — data layer (storage, CRUD, filtering/sorting); no DOM access
- `js/app.js` — UI rendering and events
- `tests/store.test.js` — unit tests for the data layer

Data is stored per browser and per origin (`localhost:8000` differs from other ports), so use Export to move or back up your tasks.
