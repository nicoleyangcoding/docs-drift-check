import { describe, expect, it } from "vitest";
import { run, type GitHubApi, type Inputs, type Log, type PullRequest } from "../src/action.js";
import { MARKER, driftComment } from "../src/comment.js";
import { ConfigError, parseConfig } from "../src/config.js";
import { findDrift, type ChangedFile } from "../src/drift.js";

function changed(...paths: string[]): ChangedFile[] {
  return paths.map((path) => ({ path, changes: 1 }));
}

const CONFIG = `
mappings:
  - name: Authentication
    code: "src/auth/**"
    docs: docs/authentication.md
  - code: ["src/api/**", "!ignored"]
    docs: ["docs/api.md", "README.md"]
  - name: Guides
    code: "src/cli/**"
    docs: "docs/guides/**"
ignore:
  - "**/*.test.ts"
`;

describe("parseConfig", () => {
  it("accepts strings or lists and fills names", () => {
    const config = parseConfig(CONFIG);
    expect(config.mappings).toHaveLength(3);
    expect(config.mappings[0]).toEqual({
      name: "Authentication",
      code: ["src/auth/**"],
      docs: ["docs/authentication.md"],
      require: "any",
    });
    expect(config.mappings[1]?.name).toBe("src/api/**, !ignored");
    expect(config.ignore).toEqual(["**/*.test.ts"]);
  });

  it.each([
    ["", "mappings"],
    ["mappings: []", "at least one"],
    ["mappings:\n  - code: a", "docs"],
    ["mappings:\n  - code: a\n    docs: b\n    doc: c", "unknown key"],
    ["mapings:\n  - code: a\n    docs: b", "unknown top-level"],
    ["mappings: [", "YAML"],
    ["mappings:\n  - code: []\n    docs: b", "code"],
    ["mappings:\n  - code: a\n    docs: b\n    require: some", "'any' or 'all'"],
  ])("rejects %j", (text, message) => {
    expect(() => parseConfig(text)).toThrow(ConfigError);
    expect(() => parseConfig(text)).toThrow(new RegExp(message));
  });
});

describe("findDrift", () => {
  const config = parseConfig(CONFIG);

  it("flags code changes without doc changes", () => {
    const drift = findDrift(config, changed("src/auth/login.ts", "src/auth/session.ts", "package.json"));
    expect(drift).toHaveLength(1);
    expect(drift[0]?.mapping.name).toBe("Authentication");
    expect(drift[0]?.changedCode).toEqual(["src/auth/login.ts", "src/auth/session.ts"]);
  });

  it("is satisfied by any one of the listed docs", () => {
    expect(findDrift(config, changed("src/api/routes.ts", "README.md"))).toEqual([]);
  });

  it("supports doc globs", () => {
    expect(findDrift(config, changed("src/cli/main.ts", "docs/guides/start.md"))).toEqual([]);
    expect(findDrift(config, changed("src/cli/main.ts"))).toHaveLength(1);
  });

  it("skips ignored files and dotfiles match", () => {
    expect(findDrift(config, changed("src/auth/login.test.ts"))).toEqual([]);
    expect(findDrift(config, changed("src/auth/.env.example"))).toHaveLength(1);
  });

  it("reports several areas at once", () => {
    const names = findDrift(config, changed("src/auth/a.ts", "src/api/b.ts")).map((d) => d.mapping.name);
    expect(names).toEqual(["Authentication", "src/api/**, !ignored"]);
  });

  it("with require: all, needs every doc to change and lists the missing ones", () => {
    const strict = parseConfig(
      'mappings:\n  - code: "src/api/**"\n    docs: [docs/api.md, "docs/clients/**"]\n    require: all',
    );
    expect(strict.mappings[0]?.require).toBe("all");
    const drift = findDrift(strict, changed("src/api/routes.ts", "docs/api.md"));
    expect(drift).toHaveLength(1);
    expect(drift[0]?.missingDocs).toEqual(["docs/clients/**"]);
    expect(findDrift(strict, changed("src/api/routes.ts", "docs/api.md", "docs/clients/js.md"))).toEqual([]);
  });

  it("ignores areas whose code changes are below min-changed-lines", () => {
    const files = [
      { path: "src/auth/login.ts", changes: 1 },
      { path: "src/auth/session.ts", changes: 2 },
      { path: "src/api/routes.ts", changes: 40 },
    ];
    expect(findDrift(config, files, 3).map((d) => d.mapping.name)).toEqual(["Authentication", "src/api/**, !ignored"]);
    expect(findDrift(config, files, 4).map((d) => d.mapping.name)).toEqual(["src/api/**, !ignored"]);
    expect(findDrift(config, files, 0)).toHaveLength(2);
  });

  it("counts a renamed file once and matches either name", () => {
    const moved = [{ path: "src/auth/new.ts", previousPath: "src/auth/old.ts", changes: 2 }];
    expect(findDrift(config, moved, 3)).toEqual([]);
    expect(findDrift(config, moved, 2)[0]?.changedCode).toEqual(["src/auth/new.ts", "src/auth/old.ts"]);
    const renamedDoc = [...moved, { path: "docs/auth.md", previousPath: "docs/authentication.md", changes: 0 }];
    expect(findDrift(config, renamedDoc)).toEqual([]);
  });

  it("lists every doc as missing in the default mode", () => {
    expect(findDrift(config, changed("src/api/routes.ts"))[0]?.missingDocs).toEqual(["docs/api.md", "README.md"]);
  });
});

describe("driftComment", () => {
  it("escapes table characters and truncates long lists", () => {
    const files = Array.from({ length: 8 }, (_, i) => `src/a|${i}.ts`);
    const mapping = { name: "A|B", code: ["src/**"], docs: ["d.md"], require: "any" as const };
    const body = driftComment([{ mapping, changedCode: files, missingDocs: ["d.md"] }], "skip");
    expect(body.startsWith(MARKER)).toBe(true);
    expect(body).toContain("A\\|B");
    expect(body).toContain("and 3 more");
    expect(body).toContain("`skip`");
    expect(body).toContain("| `d.md` |");
  });

  it("links literal doc paths but not globs", () => {
    const mapping = { name: "A", code: ["src/**"], docs: ["docs/a b.md", "docs/guides/**"], require: "any" as const };
    const drift = [{ mapping, changedCode: ["src/x.ts"], missingDocs: mapping.docs }];
    const body = driftComment(drift, "skip", "https://github.com/o/r/blob/abc");
    expect(body).toContain("[`docs/a b.md`](https://github.com/o/r/blob/abc/docs/a%20b.md), `docs/guides/**`");
  });
});

class FakeApi implements GitHubApi {
  files: Record<string, Record<string, string>> = {};
  changed: string[] = [];
  lines: Record<string, number> = {};
  comments: { id: number; body: string }[] = [];
  failComments = false;
  async readFile(path: string, ref: string) {
    return this.files[ref]?.[path] ?? null;
  }
  async changedFiles() {
    return this.changed.map((path) => ({ path, changes: this.lines[path] ?? 1 }));
  }
  async listComments() {
    if (this.failComments) throw Object.assign(new Error("forbidden"), { status: 403 });
    return this.comments;
  }
  async createComment(body: string) {
    this.comments.push({ id: this.comments.length + 1, body });
  }
  async updateComment(id: number, body: string) {
    const c = this.comments.find((x) => x.id === id);
    if (c) c.body = body;
  }
}

class FakeLog implements Log {
  failed: string[] = [];
  warnings: string[] = [];
  notices: string[] = [];
  outputs: Record<string, string> = {};
  summaries: string[] = [];
  info() {}
  notice(m: string) {
    this.notices.push(m);
  }
  warning(m: string) {
    this.warnings.push(m);
  }
  setFailed(m: string) {
    this.failed.push(m);
  }
  setOutput(n: string, v: string) {
    this.outputs[n] = v;
  }
  async summary(m: string) {
    this.summaries.push(m);
  }
}

const PR: PullRequest = {
  serverUrl: "https://github.com",
  owner: "o",
  repo: "r",
  number: 1,
  baseSha: "base",
  headSha: "head",
  labels: [],
};
const INPUTS: Inputs = {
  configPath: ".github/docs-map.yml",
  mode: "warn",
  skipLabel: "docs-not-needed",
  comment: true,
  minChangedLines: 0,
};

function setup() {
  const api = new FakeApi();
  api.files.base = { ".github/docs-map.yml": CONFIG };
  return { api, log: new FakeLog() };
}

describe("run", () => {
  it("comments once and updates the same comment later", async () => {
    const { api, log } = setup();
    api.changed = ["src/auth/login.ts"];
    expect((await run(INPUTS, PR, api, log)).drift).toBe(true);
    expect(api.comments).toHaveLength(1);
    expect(api.comments[0]?.body).toContain("(https://github.com/o/r/blob/head/docs/authentication.md)");
    expect(log.outputs.drift).toBe("true");
    expect(log.failed).toEqual([]);

    api.changed = ["src/auth/login.ts", "docs/authentication.md"];
    expect((await run(INPUTS, PR, api, log)).drift).toBe(false);
    expect(api.comments).toHaveLength(1);
    expect(api.comments[0]?.body).toContain("Docs look up to date");
  });

  it("never posts a comment when there was no drift", async () => {
    const { api, log } = setup();
    api.changed = ["unrelated.txt"];
    await run(INPUTS, PR, api, log);
    expect(api.comments).toEqual([]);
  });

  it("fails in strict mode", async () => {
    const { api, log } = setup();
    api.changed = ["src/auth/login.ts"];
    await run({ ...INPUTS, mode: "strict" }, PR, api, log);
    expect(log.failed[0]).toMatch(/Authentication/);
  });

  it("passes small changes when min-changed-lines is set", async () => {
    const { api, log } = setup();
    api.changed = ["src/auth/login.ts"];
    api.lines = { "src/auth/login.ts": 2 };
    const result = await run({ ...INPUTS, mode: "strict", minChangedLines: 5 }, PR, api, log);
    expect(result.drift).toBe(false);
    expect(log.failed).toEqual([]);
    expect(api.comments).toEqual([]);

    api.lines = { "src/auth/login.ts": 5 };
    expect((await run({ ...INPUTS, mode: "strict", minChangedLines: 5 }, PR, api, log)).drift).toBe(true);
  });

  it("respects the skip label", async () => {
    const { api, log } = setup();
    api.changed = ["src/auth/login.ts"];
    const result = await run({ ...INPUTS, mode: "strict" }, { ...PR, labels: ["docs-not-needed"] }, api, log);
    expect(result).toEqual({ drift: false, skipped: true });
    expect(log.failed).toEqual([]);
  });

  it("reads config from the base branch, not the pull request", async () => {
    const { api, log } = setup();
    api.files.head = { ".github/docs-map.yml": "mappings:\n  - code: nothing\n    docs: x" };
    api.changed = ["src/auth/login.ts"];
    expect((await run(INPUTS, PR, api, log)).drift).toBe(true);
  });

  it("falls back to the pull request's config when the base has none", async () => {
    const api = new FakeApi();
    const log = new FakeLog();
    api.files.head = { ".github/docs-map.yml": CONFIG };
    api.changed = ["src/auth/login.ts"];
    expect((await run(INPUTS, PR, api, log)).drift).toBe(true);
    expect(log.notices[0]).toMatch(/base branch has none/);
  });

  it("explains a missing or broken config", async () => {
    const api = new FakeApi();
    const log = new FakeLog();
    await run(INPUTS, PR, api, log);
    expect(log.failed[0]).toMatch(/No config found/);

    api.files.base = { ".github/docs-map.yml": "mappings: 3" };
    const log2 = new FakeLog();
    await run(INPUTS, PR, api, log2);
    expect(log2.failed[0]).toMatch(/at least one/);
  });

  it("falls back to the job summary when it can't comment", async () => {
    const { api, log } = setup();
    api.failComments = true;
    api.changed = ["src/auth/login.ts"];
    await run(INPUTS, PR, api, log);
    expect(log.warnings.some((w) => w.includes("job summary"))).toBe(true);
    expect(log.summaries[0]).toContain("Docs may need an update");
  });
});
