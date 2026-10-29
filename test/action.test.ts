import { describe, expect, it } from "vitest";
import { run, type GitHubApi, type Inputs, type Log, type PullRequest } from "../src/action.js";
import { MARKER, driftComment } from "../src/comment.js";
import { ConfigError, parseConfig } from "../src/config.js";
import { findDrift } from "../src/drift.js";

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
  ])("rejects %j", (text, message) => {
    expect(() => parseConfig(text)).toThrow(ConfigError);
    expect(() => parseConfig(text)).toThrow(new RegExp(message));
  });
});

describe("findDrift", () => {
  const config = parseConfig(CONFIG);

  it("flags code changes without doc changes", () => {
    const drift = findDrift(config, ["src/auth/login.ts", "src/auth/session.ts", "package.json"]);
    expect(drift).toHaveLength(1);
    expect(drift[0]?.mapping.name).toBe("Authentication");
    expect(drift[0]?.changedCode).toEqual(["src/auth/login.ts", "src/auth/session.ts"]);
  });

  it("is satisfied by any one of the listed docs", () => {
    expect(findDrift(config, ["src/api/routes.ts", "README.md"])).toEqual([]);
  });

  it("supports doc globs", () => {
    expect(findDrift(config, ["src/cli/main.ts", "docs/guides/start.md"])).toEqual([]);
    expect(findDrift(config, ["src/cli/main.ts"])).toHaveLength(1);
  });

  it("skips ignored files and dotfiles match", () => {
    expect(findDrift(config, ["src/auth/login.test.ts"])).toEqual([]);
    expect(findDrift(config, ["src/auth/.env.example"])).toHaveLength(1);
  });

  it("reports several areas at once", () => {
    const names = findDrift(config, ["src/auth/a.ts", "src/api/b.ts"]).map((d) => d.mapping.name);
    expect(names).toEqual(["Authentication", "src/api/**, !ignored"]);
  });
});

describe("driftComment", () => {
  it("escapes table characters and truncates long lists", () => {
    const files = Array.from({ length: 8 }, (_, i) => `src/a|${i}.ts`);
    const body = driftComment([{ mapping: { name: "A|B", code: ["src/**"], docs: ["d.md"] }, changedCode: files }], "skip");
    expect(body.startsWith(MARKER)).toBe(true);
    expect(body).toContain("A\\|B");
    expect(body).toContain("and 3 more");
    expect(body).toContain("`skip`");
  });
});

class FakeApi implements GitHubApi {
  files: Record<string, Record<string, string>> = {};
  changed: string[] = [];
  comments: { id: number; body: string }[] = [];
  failComments = false;
  async readFile(path: string, ref: string) {
    return this.files[ref]?.[path] ?? null;
  }
  async changedFiles() {
    return this.changed;
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

const PR: PullRequest = { owner: "o", repo: "r", number: 1, baseSha: "base", headSha: "head", labels: [] };
const INPUTS: Inputs = { configPath: ".github/docs-map.yml", mode: "warn", skipLabel: "docs-not-needed", comment: true };

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
