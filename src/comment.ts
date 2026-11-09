import type { Drift } from "./drift.js";

export const MARKER = "<!-- docs-drift-check -->";
const MAX_FILES = 5;

function code(text: string): string {
  // Backticks can't appear inside inline code safely; paths with them are vanishingly rare.
  return "`" + text.replace(/`/g, "'").replace(/\|/g, "\\|") + "`";
}

function fileList(files: string[]): string {
  const shown = files.slice(0, MAX_FILES).map(code).join(", ");
  const extra = files.length - MAX_FILES;
  return extra > 0 ? `${shown} and ${extra} more` : shown;
}

function isGlob(pattern: string): boolean {
  return /[*?[\]{}]/.test(pattern);
}

function docLink(doc: string, blobUrl: string | undefined): string {
  // A glob like docs/guides/** has no single file to point at.
  if (!blobUrl || isGlob(doc)) return code(doc);
  const path = doc.split("/").map(encodeURIComponent).join("/");
  return `[${code(doc)}](${blobUrl}/${path})`;
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
}

/** `blobUrl` is the base for file links, like https://github.com/owner/repo/blob/<head sha>. */
export function driftComment(drift: Drift[], skipLabel: string, blobUrl?: string): string {
  const rows = drift.map((d) => {
    const docs = d.mapping.docs.map((doc) => docLink(doc, blobUrl)).join(", ");
    return `| ${cell(d.mapping.name)} | ${fileList(d.changedCode)} | ${docs} |`;
  });
  return [
    MARKER,
    "### Docs may need an update",
    "",
    "This pull request changes code that has related documentation, but the docs weren't changed.",
    "",
    "| Area | Changed code | Docs to check |",
    "| --- | --- | --- |",
    ...rows,
    "",
    `If the docs are still accurate, add the \`${skipLabel}\` label and this check will pass.`,
  ].join("\n");
}

export function resolvedComment(skipped: boolean): string {
  return [
    MARKER,
    skipped
      ? "### Docs check skipped\n\nMarked as not needing documentation changes."
      : "### Docs look up to date\n\nEvery area changed in this pull request has matching documentation updates.",
  ].join("\n");
}
