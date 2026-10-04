# Knit Guide V1: build report

## Implemented (all 14 phases, local only)
1. Project model + local persistence (IndexedDB, write-ahead copy in localStorage, flush on hide/close)
2. Projects home: status, progress, last worked, create/rename/archive/delete, photo, resume active project
3. Project detail: CONTINUE KNITTING card, photo, pattern/yarn/needles/gauge/size, modifications, notes, INSTRUCTIONS / ORIGINAL PDF
4. Collapsible outline: Project Data, For Reference (Charts, Diagrams, Abbreviations), designer's sections
5. Current instruction: KNIT FROM HERE, highlight, persistent TO CURRENT INSTRUCTION, per-instruction action sheet
6. Counters: rows / rounds / repeats / stitches / custom, +1 −1, two-tap reset, target, completion, auto-advance
   Stitch counter: groups of 5/10/20/custom, "16 × 10 + 4 = 164", remaining
7. Notes (project / section / instruction / stopping point, edit + delete, timestamps), QUICK STOP, resume card with last note
8. Original PDF viewer (pdf.js): zoom, pinch, remembers page, jump to source page, back to instructions
9. PDF import pipeline + REVIEW IMPORT screen (details, outline, charts & images, abbreviations)
10. Size selection with finished measurements; `50 [50, 54, …]` resolved per size, "Original" toggle
11. Charts/diagrams cropped from the original pages; full-screen zoom/pan; link a chart to an instruction
12. Simultaneous engine (raglan spans + V-neck interval + lace repeat from one row number), NEEDS REVIEW flags
13. EXPLAIN THIS (rule-based, labelled GUIDANCE), tappable abbreviations (pattern definition first)
14. PWA: manifest, icons, standalone, precached app + pdf.js worker, offline verified

## Mocked / not real
* Nothing is faked in the UI. Two things are *rule-based stand-ins* for AI: the parser and EXPLAIN THIS.
* No sync, accounts, Ravelry, videos or yarn stock (data model leaves room).

## Needs an external AI / API later
* Layouts the rules can't read (multi-column, scanned PDFs → OCR, unusual headings)
* Reading charts (symbol recognition → row-by-row text). Charts are shown as pictures only.
* Explaining prose instructions (the rule-based explainer only translates stitch sequences like `k2, yo, ssk`)
* Resolving ambiguous simultaneous instructions without asking you
* Reading the schematic image (measurements inside images)

## Parsing uncertainties found in the test cardigan
1. `working 4-st pattern repeat 2 (2, 2, 3, 3, 3, 4) more times` has **7** numbers for 6 sizes. Not resolved; NEEDS REVIEW; original shown.
2. "every 4th row 11 (…) times" never says which row is the first V-neck row. Assumed row 1 (first RS row). Flagged, adjustable in the row guide.
3. Lace alignment assumed: garment row 1 = lace row 1. Flagged, adjustable.
4. Charts are 450 px JPEGs inside the PDF, so zoom is soft. Stitch rows can't be read by the app; follow the printed chart.
5. Chart captions sit above images; "Sleeve Chart" caption is at the bottom of page 4 and its image at the top of page 5. Paired by position; correct here, but a heuristic.
6. The schematic on page 6 (image only, not parsed) reads `C=chest: 32 (36, 40, 44, 48, 52)`, while the text says `36 [40, 44, 48, 52, 56]`. The PDF disagrees with itself; check before choosing a size by chest.
7. By arithmetic (not by the app): printed stitch counts before division match S to 2X if raglan increases are worked on every RS row, but 3X gives 318, not the printed 316. Likely a typo in the pattern. The app does not check this.
8. Heading detection depends on bold or short Title Case lines; a short non-bold instruction without a full stop could be mistaken for a heading. Fix in Review.
9. `Work 8-12 rows` is a range; counter target set to 12 and flagged.
10. Sleeve "k3tog every 4th round" also has no stated first round (assumed round 1, flagged).

## Results
Unit tests: 27 pass (`npm test`). Acceptance (`npm run build && npm run e2e`): see `acceptance-results.json`.
Run on Chromium emulating an iPhone (390×844 @2x, touch). Not run on real iOS Safari.
