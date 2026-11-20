import { minimatch } from "minimatch";
import type { Config, Mapping } from "./config.js";

export interface ChangedFile {
  path: string;
  /** Set when the file was renamed. */
  previousPath?: string;
  /** Added plus deleted lines. */
  changes: number;
}

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

function paths(file: ChangedFile): string[] {
  return file.previousPath ? [file.path, file.previousPath] : [file.path];
}

/**
 * A mapping has drifted when the pull request changes at least one of its code files
 * but none of its docs. Changing any one of the listed docs counts as updating them,
 * unless the mapping sets `require: all`, in which case every doc pattern needs a change.
 * Code changes smaller than `minChangedLines` in total, summed per mapping, are left alone.
 */
export function findDrift(config: Config, changedFiles: ChangedFile[], minChangedLines = 0): Drift[] {
  const drift: Drift[] = [];
  for (const mapping of config.mappings) {
    const isCode = (p: string) =>
      matchesAny(p, mapping.code) && !matchesAny(p, config.ignore) && !matchesAny(p, mapping.docs);
    const codeFiles = changedFiles.filter((f) => paths(f).some(isCode));
    if (codeFiles.length === 0) continue;
    const lines = codeFiles.reduce((sum, f) => sum + f.changes, 0);
    if (lines < minChangedLines) continue;
    const changedCode = [...new Set(codeFiles.flatMap(paths).filter(isCode))].sort();
    const missingDocs = mapping.docs.filter(
      (doc) => !changedFiles.some((f) => paths(f).some((p) => matchesAny(p, [doc]))),
    );
    const updated = mapping.require === "all" ? missingDocs.length === 0 : missingDocs.length < mapping.docs.length;
    if (!updated) drift.push({ mapping, changedCode, missingDocs });
  }
  return drift;
}
