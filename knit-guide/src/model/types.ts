/**
 * Knit Guide data model.
 *
 * Three layers, kept apart so cloud sync / accounts can be added later:
 *   Pattern  - what the designer wrote (parsed from the PDF; text is verbatim)
 *   Project  - what *I* am doing with a pattern (size, progress, notes, counters)
 *   Files    - binary blobs (original PDF, chart crops, photos) keyed by id
 *
 * Every record carries `id`, `createdAt`, `updatedAt` so a sync layer can diff them.
 */

export const SCHEMA_VERSION = 1;
/** Bump when the PDF reader / parser changes in a way that fixes how existing patterns are read. */
export const READER_VERSION = 2;

/* ------------------------------------------------------------------ pattern */

export interface Pattern {
  id: string;
  schemaVersion: number;
  /** which reader produced this pattern (older patterns can be re-read from the stored PDF) */
  readerVersion?: number;
  createdAt: number;
  updatedAt: number;
  /** Key of the untouched original PDF in the file store. Never modified. */
  fileId: string;
  fileName: string;
  pageCount: number;
  /** 'pdf' = uploaded file, 'text' = pasted text (original text is stored as the source file) */
  sourceType?: 'pdf' | 'text';
  /** size the source page had highlighted, e.g. a DROPS print for size M */
  suggestedSize?: string;
  notions?: string;

  title: string;
  designer: string;
  difficulty?: string;
  description?: string;

  sizes: string[];
  measurements: Measurement[];
  yarn: { description: string; weight?: string; requirements: string };
  needles: string;
  gauge: Gauge;
  techniques: string[];
  abbreviations: Abbreviation[];
  stitchPatterns: StitchPattern[];
  images: PatternImage[];

  sections: Section[];
  instructions: Instruction[];
  trackers: TrackerSpec[];

  parse: ParseInfo;
}

export interface Measurement {
  id: string;
  label: string;
  /** Raw text exactly as printed */
  raw: string;
  inches?: string[];
  cm?: string[];
  /** metres per size (yardage tables printed in yards are converted when read) */
  m?: string[];
  page: number;
}

export interface Gauge {
  raw: string;
  stitches?: number;
  rows?: number;
  /** Square the gauge is measured over, in inches */
  overInches?: number;
}

export interface Abbreviation {
  abbr: string;
  definition: string;
  page: number;
}

export type ImageKind = 'chart' | 'diagram' | 'photo' | 'ignore';

export interface PatternImage {
  id: string;
  kind: ImageKind;
  title: string;
  /** Caption as printed in the PDF, if one was found */
  caption?: string;
  page: number;
  /** Bounding box on the page in PDF points (origin bottom-left) */
  bbox: { x: number; y: number; w: number; h: number };
  /** File-store key of the cropped image (rendered from the original PDF). */
  fileId?: string;
}

export interface StitchPattern {
  id: string;
  name: string;
  unit: 'row' | 'round' | 'text';
  /** Rows exactly as written. Empty for plain-text stitch patterns. */
  rows: { n: number; text: string; side?: string }[];
  /** Verbatim text for 'text' patterns */
  text?: string;
  repeatFrom?: number;
  /** Length of the repeat in rows/rounds */
  length: number;
  multipleOf?: number;
  page: number;
}

export interface Section {
  id: string;
  title: string;
  level: 1 | 2;
  parentId?: string;
  page?: number;
  /** sizes this section is written for ("SIZES S, M, XL: …"); absent = all sizes */
  appliesTo?: string[];
}

export type InstructionKind = 'action' | 'info' | 'stitch-pattern' | 'tracker';

export interface Instruction {
  id: string;
  sectionId: string;
  kind: InstructionKind;
  /** Designer's words, verbatim (whitespace-normalised). Never overwritten by interpretation. */
  text: string;
  source: {
    page: number;
    /** Raw lines as extracted, for "View original" */
    lines: string[];
    imageIds: string[];
  };
  stitchPatternId?: string;
  trackerId?: string;
  /** Written for only some sizes ("Sizes XL (XXL, 3XL) only:"): the sizes, in the pattern's order */
  appliesTo?: string[];
  /** A bare "Sizes XL only:" line: it only sets the scope for what follows and is not shown in the guide */
  scopeMarker?: boolean;
  /** Part of a printed sizing table or its legend: read into Project Data, not shown as a knitting step */
  tableRow?: boolean;
  /** Detected-counter suggestions the user dismissed in review (keyed by evidence text) */
  ignoredSuggestions?: string[];
  /** True when the app generated this item (it is not designer text) */
  generated?: boolean;
  review?: string[];
}

/* ----------------------------------------------------------------- trackers */

/**
 * Simultaneous-instruction model: lace repeat + raglan spans + "every Nth row"
 * events are derived from ONE row number, so they can never drift apart.
 * Each rule keeps a pointer to the designer instruction it came from.
 */
export interface TrackerSpec {
  id: string;
  title: string;
  unit: 'row' | 'round';
  sectionId: string;
  firstRow: number;
  lace?: { stitchPatternId: string; offset: number };
  /** e.g. "Row 2 and all even rows (WS): sl1, purl to end." */
  parity?: { evenSide?: 'WS' | 'RS'; text: string; sourceInstructionId: string };
  /** "Follow the Back Chart for 44 (..) rows" style rules, grouped under one label */
  spans: TrackerSpan[];
  spanLabel: string;
  intervals: TrackerInterval[];
  /** Values per size for where this tracker section ends, e.g. the 44 rows before the sleeve division */
  endRows?: string[];
  sourceInstructionIds: string[];
  review: string[];
}

export interface TrackerSpan {
  id: string;
  name: string;
  /** one value per size (raw strings) */
  rows: string[];
  /** key of the size value in the source instruction (for project overrides) */
  rowsKey?: string;
  sourceInstructionId: string;
  stopsAfter: boolean;
}

export interface TrackerInterval {
  id: string;
  label: string;
  every: number;
  /** values per size; undefined = until told otherwise (e.g. "to desired length") */
  times?: string[];
  timesKey?: string;
  /** first row the rule applies on (assumed - flagged for review when not stated) */
  first: number;
  firstAssumed: boolean;
  excerpt: string;
  sourceInstructionId: string;
  /** several overlapping "every Nth" rules in one sentence: the app does not calculate it */
  complex?: boolean;
}

export interface ParseInfo {
  parserVersion: string;
  extractedAt: number;
  warnings: ParseWarning[];
  reviewedAt?: number;
}

export interface ParseWarning {
  id: string;
  level: 'info' | 'needs-review';
  message: string;
  page?: number;
  instructionId?: string;
}

/* ------------------------------------------------------------------ project */

export type ProjectStatus = 'not-started' | 'active' | 'finished';

export interface Project {
  id: string;
  patternId: string;
  createdAt: number;
  updatedAt: number;
  /** increments on every change; used to order write-ahead copies against stored ones */
  rev?: number;
  name: string;
  photoId?: string;
  status: ProjectStatus;
  archived?: boolean;
  lastWorkedAt?: number;

  size: string;
  /**
   * Size values the knitter confirmed by hand because the source list could not be mapped safely.
   * Key = `${instructionId}#${groupIndex}`. The pattern itself is never changed. Cleared when the size changes.
   */
  sizeOverrides?: Record<string, string>;
  setup: ProjectSetup;
  modifications: Modification[];
  notes: Note[];
  counters: Counter[];
  stitchCounters: StitchCounter[];
  /** keyed by TrackerSpec.id */
  trackers: Record<string, TrackerState>;

  progress: Progress;
  /** how I like to knit (defaults: circular needles, Magic Loop for small circumferences) */
  prefs?: KnitPrefs;
  /** Knit mode runtime state (place in the guided steps, checkpoints, measured events, my interpretations) */
  knit?: KnitState;
}

export interface KnitPrefs {
  circular: boolean;
  smallCircumference: 'magic-loop' | 'dpn';
}

export const DEFAULT_PREFS: KnitPrefs = { circular: true, smallCircumference: 'magic-loop' };

export interface KnitState {
  /** step indices ticked off, keyed by `${instructionId}` or `${trackerId}:r${row}` */
  stepsDone: Record<string, number[]>;
  /** stitch-count checkpoints (expected vs counted by me) */
  checkpoints: Record<string, { expected: number; counted?: number; verifiedAt?: number }>;
  /** measurement-triggered events (sleeve decreases, buttonholes, yoke end) */
  measured: Record<string, MeasuredState>;
  /** my own interpretation of an instruction the guide could not translate safely */
  guidanceOverrides: Record<string, { steps: string[]; at: number }>;
  /** position inside an instruction made of parts / repeated rounds: part, repeat number, round within the repeat (all 0-based) */
  phase?: Record<string, { part: number; rep: number; idx: number }>;
  /** measurement-timeline events I have done, per instruction */
  eventsDone?: Record<string, string[]>;
  /** measurements I recorded (cm), keyed by measurement key */
  measurements: Record<string, { cm: number; at: number }>;
}

export interface MeasuredState {
  /** events completed */
  done: number;
  /** I confirmed the measurement is reached: the next matching row/round must do the event */
  due: boolean;
  /** an event row was just completed (used for "knit the yarn over on the next wrong-side row") */
  justDone?: boolean;
}

export interface ProjectSetup {
  yarn: string;
  colour: string;
  needle: string;
  gaugeSts: string;
  gaugeRows: string;
  bodyLength: string;
  sleeveLength: string;
}

export interface Modification {
  id: string;
  /** null = whole project */
  instructionId: string | null;
  text: string;
  createdAt: number;
  updatedAt: number;
}

export type NoteScope =
  | { type: 'project' }
  | { type: 'section'; sectionId: string }
  | { type: 'instruction'; instructionId: string }
  | { type: 'stop' };

export interface Note {
  id: string;
  scope: NoteScope;
  text: string;
  createdAt: number;
  updatedAt: number;
}

export type CounterKind = 'rows' | 'rounds' | 'times' | 'stitches' | 'custom';

export interface Counter {
  id: string;
  instructionId: string;
  kind: CounterKind;
  label: string;
  value: number;
  target?: number;
  autoAdvance: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface StitchCounter {
  id: string;
  instructionId: string;
  label: string;
  target: number;
  groupSize: number;
  /** Total stitches counted so far; groups/remainder are derived */
  total: number;
  createdAt: number;
  updatedAt: number;
}

export interface TrackerState {
  /** the row/round currently being worked (1-based) */
  row: number;
  /** per-interval first-row overrides */
  firstOverrides: Record<string, number>;
  laceOffset?: number;
}

export interface Progress {
  currentSectionId?: string;
  currentInstructionId?: string;
  currentSetAt?: number;
  completed: string[];
  /** scroll position (0..1) of the pasted-text viewer */
  sourceScroll?: number;
  /** ids of outline sections the user has open */
  expanded: string[];
  pdfPage: number;
  lastStop?: StopSnapshot;
}

/** Everything needed to show the CONTINUE KNITTING card, frozen at stop time. */
export interface StopSnapshot {
  at: number;
  /** frozen description for the "YOU STOPPED HERE" card */
  state?: { headline: string[]; nextAction?: string; tracking: string[]; stitches?: number };
  sectionId?: string;
  instructionId?: string;
  noteId?: string;
  /** compact human summary e.g. "Row 27" */
  position?: string;
}
