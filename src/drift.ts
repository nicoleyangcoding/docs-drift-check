import { minimatch } from "minimatch";
import type { Config, Mapping } from "./config.js";

export interface Drift {
  mapping: Mapping;
  changedCode: string[];
  /** Doc patterns no changed file matched. */
  missingDocs: string[];
}

const OPTIONS = { dot: true, nocomment: true, nonegate: true };

function matchesAny(file: string, globs: string[]): boolean {
  return globs.some((glob) => minimatch(file, glob, OPTIONS));
}

/**
 * A mapping has drifted when the pull request changes at least one of its code files
 * but none of its docs. Changing any one of the listed docs counts as updating them,
 * unless the mapping sets `require: all`, in which case every doc pattern needs a change.
 */
export function findDrift(config: Config, changedFiles: string[]): Drift[] {
  const files = [...new Set(changedFiles)].sort();
  const drift: Drift[] = [];
  for (const mapping of config.mappings) {
    const changedCode = files.filter(
      (f) => matchesAny(f, mapping.code) && !matchesAny(f, config.ignore) && !matchesAny(f, mapping.docs),
    );
    if (changedCode.length === 0) continue;
    const missingDocs = mapping.docs.filter((doc) => !files.some((f) => matchesAny(f, [doc])));
    const updated = mapping.require === "all" ? missingDocs.length === 0 : missingDocs.length < mapping.docs.length;
    if (!updated) drift.push({ mapping, changedCode, missingDocs });
  }
  return drift;
}
