import type { DataFile, PostcodeFile } from "./types";

/* Cached client loaders for the precomputed JSON. data.json drives the whole
   dashboard; postcodes.json is loaded lazily, only when the map needs it. */

let dataPromise: Promise<DataFile> | null = null;
let postcodePromise: Promise<PostcodeFile> | null = null;

export function loadData(): Promise<DataFile> {
  if (!dataPromise) {
    dataPromise = fetch("/data/data.json").then((r) => {
      if (!r.ok) throw new Error(`Failed to load data.json (${r.status})`);
      return r.json() as Promise<DataFile>;
    });
  }
  return dataPromise;
}

export function loadPostcodes(): Promise<PostcodeFile> {
  if (!postcodePromise) {
    postcodePromise = fetch("/data/postcodes.json").then((r) => {
      if (!r.ok) throw new Error(`Failed to load postcodes.json (${r.status})`);
      return r.json() as Promise<PostcodeFile>;
    });
  }
  return postcodePromise;
}
