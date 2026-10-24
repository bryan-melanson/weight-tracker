# Weight & Calorie Tracker

A local-only tracker for daily weight, calories eaten, and the calorie target
you set. It runs as a small web app on your own machine: a Python standard
library server, a SQLite file, and a plain-JavaScript frontend. **No
dependencies to install, no account, no network calls** — nothing leaves the
machine it runs on.

## Run it

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

The database is `data/tracker.db` (SQLite, created on first run). To back it
up, copy that file, or use **Export CSV**. **Import CSV** reads the same shape
back:

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
tracker/         Python package — the server
  config.py        limits and paths, every bound in one place
  validation.py    boundary validation, pure functions
  store.py         SQLite repository
  api.py           routing, transport-agnostic (status, payload)
  server.py        http.server glue, static files, hardening
static/          the frontend — ES modules, no build step, no CDN
  js/format.js     units, numbers, dates
  js/stats.js      derived metrics (trend, balance, projection)
  js/charts/       SVG chart engine and the three charts
tests/           Python tests (pytest) and JS tests (node:test)
```

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

## Tests

```bash
python3 -m pytest                  # server: validation, store, API, HTTP
node --test "tests/js/*.test.js"   # frontend: units, dates, derived metrics
python3 -m pytest --cov=tracker --cov-report=term-missing
```

195 tests; the Python package is at 94% line coverage.
