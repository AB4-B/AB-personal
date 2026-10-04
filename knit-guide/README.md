# Knit Guide

Private, mobile-first web app for following knitting-pattern PDFs without losing your place.
Upload a PDF → parse → review → pick a size → guided project with counters, notes, Quick Stop and resume.

The original PDF is the source of truth. Designer text is stored verbatim; anything the app
calculates or explains is labelled (`GUIDANCE`, `MY MODIFICATION`, `NEEDS REVIEW`) and never replaces it.
Everything is stored on the device (IndexedDB). No accounts, no servers, no paid services.

## Importing
* **PDF upload** (New project → Choose PDF).
* **Paste text** (New project → paste box) for patterns you can't download. Copy the whole web page; menus, ads and repeated
  banners are hidden from the guide, but the pasted text is stored untouched and is what ORIGINAL TEXT shows.
* Both go through the same parser and the same REVIEW IMPORT screen. Pasted patterns have no page numbers or charts.

## Run

```bash
cd knit-guide
npm install
npm run dev            # http://localhost:5173  (also on your LAN, see below)
npm test               # unit tests (parser, size resolution, tracker, explain)
npm run build          # type-check + production build
npm run preview        # serves the built PWA at http://localhost:4173 (service worker active)
npm run e2e            # build first; iPhone-sized acceptance run, writes docs/screenshots + docs/acceptance-results.json
```

`npm run e2e` needs Chromium. It defaults to `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; set `CHROME_PATH` to override.
Tests that use real patterns expect the files listed in `fixtures/README.md` (git-ignored, copyrighted); they skip when absent.

### On the iPhone
* Same Wi-Fi: open `http://<computer-ip>:5173`. The app works and saves data.
* Service workers (offline + installability) only run on **https or localhost**. For "Add to Home Screen" with offline use you need to serve it over https (later: your own host, or a private tunnel). Nothing is deployed by this repo.
* iOS keeps Safari-tab storage and home-screen-app storage **separate**. Create your projects in the installed app, not in the Safari tab.

## Structure

```
src/model/     types.ts (Pattern / Project / counters), size.ts (multi-size resolution), helpers.ts
src/parser/    extract.ts (pdf.js → lines/images) · clean.ts (web chrome, caps headings, paste → lines) · parse.ts (lines → Pattern) · detect.ts (counters, trackers)
               edit.ts (review-screen edits + re-derive) · parser.test.ts
src/engine/    tracker.ts (simultaneous row engine) · stitch.ts · explain.ts (glossary + plain-English steps)
src/storage/   db.ts  Repo interface + IndexedDB implementation (swap for cloud sync later)
src/store/     store.ts  zustand state; every project change is written immediately
src/pdf/       pdfjs.ts, importPdf.ts (parse + crop charts from the original pages)
src/screens/   Home · NewProject (upload/review/setup) · ProjectDetail · Outline · PdfViewer · ChartViewer
src/components Counters, TrackerCard, InstructionSheet, Notes, RichText
e2e/           acceptance.mjs (Playwright, iPhone emulation)
```

Pattern (designer data), Project (your progress) and Files (PDF, chart crops, photos) are separate records with
ids and timestamps, so accounts / iCloud / multi-device sync / Ravelry / yarn stock can be added around them.

## How the hard parts work

* **Parser** (`src/parser`): rule-based, no AI. Labels (`Sizes:`, `Gauge:` …), heading detection (bold + short),
  `Row n:` stitch-pattern blocks, size groups like `50 [50, 54, 54, 54, 58]`, chart captions paired to images.
  Every instruction keeps its PDF page, source lines and linked chart images.
* **Size resolution**: `50 [50, 54, …]` → the selected size's number, highlighted; tap **Original** to see the untouched text.
  A list whose length ≠ number of sizes is *not* resolved and is flagged NEEDS REVIEW.
* **Simultaneous engine** (`tracker.ts`): one row number drives lace repeat position, chart spans (raglan) and
  "every Nth row X times" events, so they cannot drift apart. It only does arithmetic on numbers the designer printed;
  assumptions (e.g. which row is the first V-neck row) are shown as NEEDS REVIEW and are adjustable.
* **Never lose your place**: each tap is persisted to IndexedDB immediately (serialised per project) and flushed on `visibilitychange`/`pagehide`.
  Counter reset needs a second tap. QUICK STOP freezes a timestamped snapshot (+ optional note).

## Limits (V1)
See the report in the PR/chat: charts are pictures (not read), parsing is heuristic, explanations are rule-based.
