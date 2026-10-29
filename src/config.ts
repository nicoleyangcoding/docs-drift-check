import { parse } from "yaml";

export interface Mapping {
  name: string;
  code: string[];
  docs: string[];
}

export interface Config {
  mappings: Mapping[];
  ignore: string[];
}

export class ConfigError extends Error {}

const MAPPING_KEYS = new Set(["name", "code", "docs"]);
const TOP_KEYS = new Set(["mappings", "ignore"]);

function patterns(value: unknown, where: string): string[] {
  const list = typeof value === "string" ? [value] : value;
  if (!Array.isArray(list) || list.length === 0 || !list.every((p) => typeof p === "string" && p.trim())) {
    throw new ConfigError(`${where} must be a path pattern or a list of them`);
  }
  return list.map((p: string) => p.trim().replace(/^\.\//, ""));
}

export function parseConfig(text: string): Config {
  let data: unknown;
  try {
    data = parse(text);
  } catch (err) {
    throw new ConfigError(`not valid YAML: ${(err as Error).message}`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new ConfigError("expected a 'mappings:' list at the top level");
  }
  const root = data as Record<string, unknown>;
  const unknownTop = Object.keys(root).filter((k) => !TOP_KEYS.has(k));
  if (unknownTop.length) throw new ConfigError(`unknown top-level key(s): ${unknownTop.join(", ")}`);

  if (!Array.isArray(root.mappings) || root.mappings.length === 0) {
    throw new ConfigError("add at least one entry under 'mappings:'");
  }
  const mappings = root.mappings.map((raw, i): Mapping => {
    const where = `mappings[${i + 1}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new ConfigError(`${where} must have 'code' and 'docs'`);
    }
    const entry = raw as Record<string, unknown>;
    const unknown = Object.keys(entry).filter((k) => !MAPPING_KEYS.has(k));
    if (unknown.length) throw new ConfigError(`${where}: unknown key(s) ${unknown.join(", ")}`);
    const code = patterns(entry.code, `${where}.code`);
    const docs = patterns(entry.docs, `${where}.docs`);
    const name = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : code.join(", ");
    return { name, code, docs };
  });
  const ignore = root.ignore === undefined ? [] : patterns(root.ignore, "ignore");
  return { mappings, ignore };
}
