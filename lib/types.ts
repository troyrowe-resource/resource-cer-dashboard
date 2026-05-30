/* ============================================================
   ReSource CER dashboard - shared data types.
   The build-time parser (scripts/build-data.ts) emits JSON that
   conforms exactly to these shapes; the client consumes them.
   ============================================================ */

export type StateCode = "NSW" | "VIC" | "QLD" | "WA" | "SA" | "TAS" | "ACT" | "NT";

/** The 8 mappable states/territories, in default display order. */
export const STATE_CODES: readonly StateCode[] = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"] as const;

export const STATE_NAMES: Record<StateCode, string> = {
  NSW: "New South Wales",
  VIC: "Victoria",
  QLD: "Queensland",
  WA: "Western Australia",
  SA: "South Australia",
  TAS: "Tasmania",
  ACT: "Australian Capital Territory",
  NT: "Northern Territory",
};

/** Postcode bucket: a real state/territory, or OTHER (unmappable postcodes, ~0.002% of volume). */
export type PostcodeState = StateCode | "OTHER";

export type DatasetKey = "solar" | "battery";
export type Metric = "installations" | "capacity" | "avg";
export type Granularity = "month" | "year";

/** Capacity is RATED kW for solar, USABLE kWh for battery. Never mix the two. */
export type SizeUnit = "kW" | "kWh";

/** One month of a series. `capacity` units follow the dataset's SizeUnit. */
export interface MonthPoint {
  ym: string; // "YYYY-MM"
  y: number;
  m: number; // 1-12
  installs: number;
  capacity: number;
  /** True when this month is within the CER 12-month STC creation window and therefore under-counted. */
  incomplete?: boolean;
}

/** Cumulative running total to and including `ym`. */
export interface CumPoint {
  ym: string;
  y: number;
  m: number;
  installs: number;
  capacity: number;
}

/** Installs/capacity grouped by year of installation (the vintage / waste-arisings basis). */
export interface YearPoint {
  year: number;
  installs: number;
  capacity: number;
}

/** Cumulative totals for one postcode, with state + centroid for the map heat layer. */
export interface PostcodePoint {
  pc: string; // zero-padded 4-digit
  state: PostcodeState;
  installs: number;
  capacity: number;
  lng: number | null; // centroid longitude (null if no centroid match)
  lat: number | null;
}

export interface DatasetMeta {
  key: DatasetKey;
  label: string; // "Solar" | "Battery"
  title: string; // "Rooftop solar" | "Home battery"
  unitName: string; // "systems" | "batteries"
  sizeUnit: SizeUnit;
  startYM: string;
  endYM: string;
  months: string[]; // every "YYYY-MM" present, ascending
  totalInstalls: number; // national, incl OTHER
  totalCapacity: number; // national, incl OTHER (kW solar / kWh battery)
  /** Count of trailing months treated as incomplete (STC window). */
  incompleteMonths: number;
  /** Default assumed service life (years) for the arisings projection. */
  assumedLifeYears: number;
  /** Width (years) of the "approaching end-of-life" band before assumed life. */
  bandYears: number;
  /** Min/max the lifespan slider allows. */
  lifeMin: number;
  lifeMax: number;
}

export interface SeriesBundle {
  /** Per-state monthly series (9 keys incl OTHER). Primary source for dynamic state selection. */
  byState: Record<PostcodeState, MonthPoint[]>;
  /** Precomputed national convenience series (= sum over all buckets). */
  national: { monthly: MonthPoint[]; cumulative: CumPoint[] };
  /** Precomputed installs/capacity by install year. */
  vintage: { national: YearPoint[]; byState: Record<PostcodeState, YearPoint[]> };
}

export interface MetaFile {
  /** Headline date, from the newest (2011-present) file, e.g. "30 Apr 2026". */
  dataAsAt: string;
  dataAsAtISO: string; // "2026-04-30"
  /** Secondary source date of the static 2001-2010 history, e.g. "31 Mar 2024". */
  historicSourceDate: string;
  /** ISO timestamp the JSON was generated (passed in from the build runner). */
  generatedAt: string;
  datasets: Record<DatasetKey, DatasetMeta>;
  /** Source attribution shown in the footer. */
  source: string;
}

/** public/data/data.json */
export interface DataFile {
  meta: MetaFile;
  solar: SeriesBundle;
  battery: SeriesBundle;
}

/** public/data/postcodes.json - cumulative-only, for the map heat layer. */
export interface PostcodeFile {
  solar: PostcodePoint[];
  battery: PostcodePoint[];
}
