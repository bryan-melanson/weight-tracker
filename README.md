# Weight & Calorie Tracker

A tracker for daily weight, calories eaten, and the calorie target you set.
**No dependencies to install, and no account** — by default your data never
leaves the device you enter it on, and the app makes no network calls at all.

It runs two ways, from one frontend:

- **On the desktop** as a small web app on your own machine — a Python
  standard library server, a SQLite file, and a plain-JavaScript frontend.
- **On an iPhone** as an app installed to the home screen, storing data in the
  browser's own database. No App Store, no Apple developer account, no Mac.

Optionally it can keep a copy of your history in a private GitHub repository
you own, so losing the phone does not lose the data. That is the only thing
that ever talks to the network, it is off until you switch it on, and the app
is fully usable without it.

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

### How safe the data on the phone is

Safari's seven-day eviction of script-writable storage **does not apply to a
home-screen web app** — only to ordinary tabs. On top of that the app asks for
[persistent storage](https://webkit.org/blog/14403/updates-to-storage-policy/)
after your first save, which iOS grants an installed app silently, so the data
is not reclaimed under storage pressure either.

What that still does not survive: deleting the app, losing or resetting the
phone, or a bad restore. For those, back it up.

### Backup to a private GitHub repository (optional)

You do not need this. The app makes no network calls at all until you connect
it, and the data on the phone is not going anywhere on its own. It exists for
the cases storage permissions cannot cover: a deleted app, a lost phone, a bad
restore.

It lives in a **Backup** section below the logged-days table, collapsed and
silent until you open it. Once connected it copies your whole history to one
CSV file in a private repository after every change, and the collapsed header
reports the state — `up to date`, `changes not backed up`, `not backed up` —
so you never have to open it to know where you stand. It reopens itself if a
push fails or a decision is needed, because a section that folds away must not
fold a problem away with it.

It is one-way: the device is the source of truth, and nothing comes back
unless you ask for it.

Because each save is a commit, you get the history for free: read the file on
github.com, download it, diff two days, or recover the state from any earlier
point.

To set it up:

1. Make a **private** repository, e.g. `weight-data`. It can be empty.
2. GitHub → Settings → Developer settings → **Fine-grained tokens** → generate
   one with access to **only that repository** and the single permission
   **Contents: Read and write**. Give it whatever expiry you are willing to
   renew.
3. Open **Backup** below the table, put in the owner, repository and token,
   and press **Connect**. It verifies the token, then pushes immediately.

**Setting it up on a replacement phone is safe.** If the repository already
holds a backup, connecting writes *nothing* — it stops and tells you what it
found, and you choose **Restore it to this device** or **Replace it**. The
case where you have just lost a phone is exactly the case where a blind push
would destroy what you came to recover, so it refuses to guess.

Restoring imports the file, which merges by date: days in the backup overwrite
the matching days on the device, and days only on the device are left alone.

**About the token.** It is kept in this device's `localStorage`, scoped to this
origin, and never leaves it except as an `Authorization` header to
`api.github.com`. It is never written into the backup file, never rendered
into the page, and never put into an error message — so a CSV you export or
share carries no credential. Worth knowing: anyone who can unlock the phone
can read it, and it grants write access to that one repository, so scope the
token to that repository and nothing else. **Disconnect** forgets it.

The app's Content-Security-Policy allows exactly one external host,
`api.github.com`, and only for this.

### Export CSV

Still there, on both the desktop and the phone, and still the thing to use for
a one-off copy or to move data between devices. On the phone it saves through
the iOS share sheet, so it can go to Files, iCloud Drive, or anywhere else.

## What it tracks

**Log a day** records, for any date: weight, calories eaten, calories burnt
through exercise, a calorie target just for that day, and a note. Saving the
same date again updates it, so you can log weight in the morning and calories
at night.

**Food** is the day's food log, beside the form and following its date. Search
about 8,000 foods by name — banana, oats, cheddar — pick one, and give an
amount; the calories show as you type. The measure list is grouped:

- **Portions** USDA sized for that food: "medium", "slice", "large".
- **Volume**: USDA's own ("cup, chopped"), plus cup, tbsp, tsp, fl oz and ml
  worked out from the food's density wherever USDA weighed any volume of it.
  Where it weighed none, a food can borrow the density of a close relative
  (white rice from white rice), or of its family when at least three
  relatives agree within 15% (creamy peanut butter from the other peanut
  butters). Those measures are marked *est.*, and the picker says where the
  estimate came from. Anything less certain stays weight-only rather than
  guess: rolled oats do not borrow a cup from whole groats at twice the weight.
- **Weight**: g, oz, lb and kg, always.

Switching measure keeps the same amount of food, so 1 cup of oats becomes 81 g
rather than 1 g. A food opens on the measure and amount you last used for it,
or else a medium one, or else 100 g.

- **Recent** foods are listed under the search box when it is empty, and come
  first in results. One tap logs one again exactly as last time.
- **A food that isn't listed** — a recipe, or something off a label — takes a
  name and its calories per serving, per 100 g, per oz, or per cup, tbsp or
  tsp. You then pick how much you had like any other food: in servings, or
  in any weight or any volume, matching what the calories were given per. It
  then shows up under Recent like any other.
- **Tap a food on the day** to change its amount or measure, or remove it.

A running total against the day's target, with what is left, sits at the top.
Once a day has any foods, its *Calories eaten* is their total — the field
shows it and stops taking a number of its own. If you had already typed a
total for that day, adding the first food keeps it as an item, "Calories
logged before the food list", which you can remove like any other. A day with
no foods works exactly as before, typed total and all.

The search runs on the device against a copy of the index shipped with the
app, so it works offline and sends nothing anywhere. The calories are USDA
FoodData Central's ([SR Legacy](https://fdc.nal.usda.gov/) and Foundation
Foods, public domain): generic foods, not brands, so a packaged product is
best added from its label as a food that isn't listed.

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
date,weight_kg,calories,calories_burned,calorie_target,note,foods
2026-10-01,80.5,1950,420,2000,felt good,
2026-10-02,,105,,,,"[{""name"":""Bananas, raw"",""portion"":""medium"",""quantity"":1,""unit_kcal"":105.02,""unit_grams"":118}]"
```

Only `date` is required; blank cells clear a value — a CSV written before the
`calories_burned` or `foods` columns existed still imports.

`foods` is the day's food log as one JSON cell, so a day stays one row and the
file stays readable in a spreadsheet: each item is a `quantity` of one
`portion`, with the energy (`unit_kcal`) and weight (`unit_grams`, when
known) of a single portion. On import, a day's `calories` are recomputed from
its foods whenever it has any. The log is in the backup file too, since that
is the same CSV. Weight in the CSV is always in
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
  js/foods/        catalog.js (search, measures, recents — pure), panel.js (the card)
  foods.json       the food index, built by tools/build_food_index.py
  backup/github.js the GitHub Contents API, reduced to three calls
  backup/service.js one-way push of the whole CSV; restore on request
  backup/          config.js (device-local settings), panel.js (the section)
  persistence.js   asks the browser not to reclaim the data
  sw.js            service worker: precaches the app for offline use
tools/           build_food_index.py — USDA releases in, static/foods.json out
tests/           Python tests (pytest) and JS tests (node:test)
```

### The food index

`static/foods.json` is generated, not hand-edited. `tools/build_food_index.py`
reads USDA's SR Legacy and Foundation Foods CSV releases and keeps, for each
food, its name, its calories per 100 g, and its household measures normalized
to one of each ("cup, mashed" = 225 g). Foods listed under the same name more
than once are merged, preferring Foundation Foods' newer analysis. The result
is about 800 KB, 130 KB over the wire compressed, and the service worker
caches it with the rest of the app.

`.github/workflows/food-index.yml` runs the builder on GitHub's runners and
commits the result to the branch it ran on — never to `master` directly. To
pick up a newer USDA release, change the URLs at the top of the script on a
branch and push; the workflow rebuilds the file there for review. The builder
uses only the standard library and also runs locally against downloaded zips:

```bash
python3 tools/build_food_index.py sr_legacy.zip foundation.zip
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
- a Content-Security-Policy limits the page to its own origin, plus
  `api.github.com` for the optional backup and nothing else.

This is a single-user local app: there is no authentication, so anyone with an
account on this machine can read the data file.

The installed app has no server to defend. It is served as static files from
an HTTPS origin and repeats the same Content-Security-Policy in a meta tag,
since a static host sends no headers of its own. Its data lives in the
browser's own storage, reachable only by that origin on that device, and
anyone who can unlock the phone can read it.

The backup token lives in that same storage. The app writes no HTML from data
— every DOM write goes through `textContent`, and `script-src 'self'` with no
inline scripts and no CDN leaves nothing to inject — so the usual way a token
leaks from a page is closed off. It is also kept out of the backup file, the
rendered page, and every error message, each of which is covered by a test.

## Tests

```bash
python3 -m pytest                  # server: validation, store, API, HTTP
node --test "tests/js/*.test.js"   # frontend: units, dates, metrics, backend
python3 -m pytest --cov=tracker --cov-report=term-missing
```

560 tests: 263 for the server and the food-index builder, 297 for the frontend.

The frontend suite covers the ported validation, CSV and store logic against
an in-memory stand-in for IndexedDB, so it needs no browser and no
dependencies.
