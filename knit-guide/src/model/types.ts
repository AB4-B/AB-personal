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

/* ------------------------------------------------------------------ pattern */

export interface Pattern {
  id: string;
  schemaVersion: number;
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
  sourceInstructionId: string;
  stopsAfter: boolean;
}

export interface TrackerInterval {
  id: string;
  label: string;
  every: number;
  /** values per size; undefined = until told otherwise (e.g. "to desired length") */
  times?: string[];
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
  setup: ProjectSetup;
  modifications: Modification[];
  notes: Note[];
  counters: Counter[];
  stitchCounters: StitchCounter[];
  /** keyed by TrackerSpec.id */
  trackers: Record<string, TrackerState>;

  progress: Progress;
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
  sectionId?: string;
  instructionId?: string;
  noteId?: string;
  /** compact human summary e.g. "Row 27" */
  position?: string;
}
