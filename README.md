# Weight & Calorie Tracker

A local-only tracker for daily weight, calories eaten, and the calorie target
you set. **No dependencies to install, no account, no network calls** — your
data never leaves the device you enter it on.

It runs two ways, from one frontend:

- **On the desktop** as a small web app on your own machine — a Python
  standard library server, a SQLite file, and a plain-JavaScript frontend.
- **On an iPhone** as an app installed to the home screen, storing data in the
  browser's own database. No App Store, no Apple developer account, no Mac.

## Run it on the desktop

```bash
./run.sh
```

That starts the server on <http://127.0.0.1:8777> and opens a browser.
`Ctrl+C` stops it. Options:

```bash
./run.sh --port 9000        # a different port
./run.sh --no-browser       # don't open a browser
./run.sh --db ~/weight.db   # a different data file
```

Requires Python 3.10 or newer — nothing else.

## Install it on an iPhone

Open the published app in **Safari** (it must be Safari — other iOS browsers
cannot install a web app), then **Share → Add to Home Screen**.

That is the whole installation. It gets its own icon, opens full screen with
no browser chrome, and works with no signal at all: everything it needs is
cached on the device the first time it loads.

### Publishing it

The app installs from any HTTPS address — a service worker, which is what
makes it work offline, will not run over plain HTTP, so a LAN address like
`http://192.168.1.x:8777` cannot be installed.

`.github/workflows/pages.yml` publishes `static/` to GitHub Pages on every
push to `master`, with both test suites gating the deploy. Enable it under
**Settings → Pages → Source: GitHub Actions**. Pages needs the repository to
be public unless you have GitHub Pro.

What gets published is the code, not your data: the page is static files, and
every weight you log stays in your phone's own storage.

### Moving your existing data over

The phone and the desktop keep **separate databases** — there is no server
between them and nothing syncs. To carry your history across, **Export CSV**
on the desktop and **Import CSV** on the phone.

Pick one as the one you actually log into, or they will drift apart.

### Backups

iOS can reclaim a web app's storage if you leave it unopened for a long
stretch, and an app deleted from the home screen takes its data with it. So
**Export CSV every so often** — that file is the real backup. It saves through
the iOS share sheet, so it can go to Files, iCloud Drive, or anywhere else.

## What it tracks

**Log a day** records, for any date: weight, calories eaten, calories burnt
through exercise, a calorie target just for that day, and a note. Saving the
same date again updates it, so you can log weight in the morning and calories
at night.

**Targets** holds your standing settings: weight unit (pounds by default, or
kilograms), a calorie target for each weekday, a goal weight, and an optional
target date.

Each weekday carries its own target, so a week can run 1,900 on Monday through
Thursday, 2,100 on Friday and 2,400 at the weekend. A weekday left blank
follows the default daily target. Each day is measured against the most
specific target it has:

1. the target saved on that day's own entry, if you set one;
2. otherwise the target for that weekday;
3. otherwise the default daily target.

Changing a weekday's target re-scores every past day that falls on it, since
nothing is copied onto an entry unless you set it there.

## What it shows

Everything below the range filter (30 days / 90 days / 1 year / All) is scoped
to that range.

- **Summary tiles** — current weight and its change over the range, distance to
  goal with a projected date, 7-day average intake against target, average
  exercise per logged day, the running calorie balance, and how many days you
  logged.
- **Weight** — every logged reading, a 7-day trailing average as the trend, and
  your goal as a labelled reference line.
- **Calories against target** — each day as a column above or below the target
  baseline, so the chart shows how far off target you were rather than
  re-drawing the ~1,800 kcal every day has in common. Exercise you logged is
  netted out of that day's intake first. Past 120 days in view it folds into
  weekly averages. Intake, exercise and the net of the two stay in the tooltip
  and the table.
- **Running calorie balance** — the cumulative sum of (eaten − burnt − target),
  with the equivalent body mass at 7,700 kcal/kg. Exercise counts only on the
  days you logged it and nothing estimates the rest, so treat that equivalent
  as a rough guide.
- **Logged days** — the same values as a table, readable without hovering, with
  per-row edit and delete.

Charts respond to hover and to keyboard: focus a chart and use ← / → to walk
through the days, `Esc` to dismiss. Light and dark themes are both supported;
the toggle is in the top right.

## Your data

On the desktop the database is `data/tracker.db` (SQLite, created on first
run); to back it up, copy that file. The installed iPhone app keeps its data
in IndexedDB instead, where there is no file to copy — there, **Export CSV**
is the backup.

**Import CSV** reads the same shape back, on either:

```csv
date,weight_kg,calories,calories_burned,calorie_target,note
2026-10-01,80.5,1950,420,2000,felt good
2026-10-02,,2100,,,
```

Only `date` is required; blank cells clear a value — a CSV written before the
`calories_burned` column existed still imports. Weight in the CSV is always in
kilograms regardless of the display unit. An import is validated in full
before anything is written, so a bad row cannot leave a half-applied import.

## How it is built

```
tracker/         Python package — the desktop server
  config.py        limits and paths, every bound in one place
  validation.py    boundary validation, pure functions
  store.py         SQLite repository
  api.py           routing, transport-agnostic (status, payload)
  server.py        http.server glue, static files, hardening
static/          the frontend — ES modules, no build step, no CDN
  api.js           picks the backend; everything downstream is unaware
  backend/http.js  talks to the Python server
  backend/local.js the same API over IndexedDB, for the installed app
  backend/         validate.js, store.js, csv.js, idb.js, limits.js
  js/format.js     units, numbers, dates
  js/stats.js      derived metrics (trend, balance, projection)
  js/charts/       SVG chart engine and the three charts
  sw.js            service worker: precaches the app for offline use
tests/           Python tests (pytest) and JS tests (node:test)
```

### Two backends, one frontend

`static/js/api.js` chooses at load time. On a loopback address the page came
from the Python server, so it uses that; anywhere else there is no server to
talk to, so it stores data on the device.

`backend/validate.js`, `backend/store.js` and `backend/csv.js` are ports of
`validation.py`, `store.py` and the CSV half of `api.py`, so both backends
accept and reject exactly the same things and their CSV exports are
interchangeable. The limits are the one thing written down twice —
`tests/test_js_limits.py` fails if the two copies ever disagree.

To exercise the on-device backend locally, serve `static/` with any static
server and add `?backend=local`:

```bash
cd static && python3 -m http.server 8899   # then open
                                           # http://localhost:8899/?backend=local
```

That is also the only way to see the service worker run, since it needs HTTPS
or localhost.

### Security

The server holds personal health data with no login, so it only accepts
requests that look like they came from your own browser:

- it binds `127.0.0.1` and emits no CORS headers;
- the `Host` header must name loopback, which blocks DNS rebinding;
- mutating requests must carry `X-Requested-With: weight-tracker`, a header
  cross-origin form posts cannot set, and any `Origin` they send must be
  loopback;
- static file paths are resolved and confined to `static/`;
- a Content-Security-Policy limits the page to its own origin.

This is a single-user local app: there is no authentication, so anyone with an
account on this machine can read the data file.

The installed app has no server to defend. It is served as static files from
an HTTPS origin and repeats the same Content-Security-Policy in a meta tag,
since a static host sends no headers of its own. Its data lives in the
browser's own storage, reachable only by that origin on that device, and
anyone who can unlock the phone can read it.

## Tests

```bash
python3 -m pytest                  # server: validation, store, API, HTTP
node --test "tests/js/*.test.js"   # frontend: units, dates, metrics, backend
python3 -m pytest --cov=tracker --cov-report=term-missing
```

362 tests; the Python package is at 94% line coverage.

The frontend suite covers the ported validation, CSV and store logic against
an in-memory stand-in for IndexedDB, so it needs no browser and no
dependencies.
