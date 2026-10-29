import { ConfigError, parseConfig } from "./config.js";
import { MARKER, driftComment, resolvedComment } from "./comment.js";
import { findDrift } from "./drift.js";

export interface Inputs {
  configPath: string;
  mode: "warn" | "strict";
  skipLabel: string;
  comment: boolean;
}

export interface PullRequest {
  owner: string;
  repo: string;
  number: number;
  baseSha: string;
  headSha: string;
  labels: string[];
}

/** The small slice of the GitHub API this action uses, so tests can provide a fake. */
export interface GitHubApi {
  readFile(path: string, ref: string): Promise<string | null>;
  changedFiles(): Promise<string[]>;
  listComments(): Promise<{ id: number; body: string }[]>;
  createComment(body: string): Promise<void>;
  updateComment(id: number, body: string): Promise<void>;
}

export interface Log {
  info(message: string): void;
  notice(message: string): void;
  warning(message: string): void;
  setFailed(message: string): void;
  setOutput(name: string, value: string): void;
  summary(markdown: string): Promise<void>;
}

export interface Result {
  drift: boolean;
  skipped: boolean;
}

function isPermissionError(err: unknown): boolean {
  const status = (err as { status?: number }).status;
  return status === 403 || status === 404;
}

async function upsertComment(api: GitHubApi, body: string, createIfMissing: boolean, log: Log): Promise<void> {
  try {
    const existing = (await api.listComments()).find((c) => c.body.startsWith(MARKER));
    if (existing) {
      if (existing.body !== body) await api.updateComment(existing.id, body);
    } else if (createIfMissing) {
      await api.createComment(body);
    }
  } catch (err) {
    if (!isPermissionError(err)) throw err;
    log.warning(
      "Could not comment on the pull request (missing permission, or a pull request from a fork). " +
        "The result is in the job summary instead. Add `permissions: pull-requests: write` to the workflow to enable comments.",
    );
  }
}

export async function run(inputs: Inputs, pr: PullRequest, api: GitHubApi, log: Log): Promise<Result> {
  // Read the rules from the base branch so a pull request can't loosen its own check.
  let text = await api.readFile(inputs.configPath, pr.baseSha);
  if (text === null) {
    text = await api.readFile(inputs.configPath, pr.headSha);
    if (text !== null) log.notice(`Using ${inputs.configPath} from this pull request; the base branch has none yet.`);
  }
  if (text === null) {
    log.setFailed(
      `No config found at ${inputs.configPath}. Create it with a 'mappings:' list. ` +
        "See https://github.com/nicoleyangcoding/docs-drift-check#configuration",
    );
    return { drift: false, skipped: false };
  }

  let config;
  try {
    config = parseConfig(text);
  } catch (err) {
    if (err instanceof ConfigError) {
      log.setFailed(`${inputs.configPath}: ${err.message}`);
      return { drift: false, skipped: false };
    }
    throw err;
  }

  const skipped = pr.labels.includes(inputs.skipLabel);
  const drift = skipped ? [] : findDrift(config, await api.changedFiles());
  log.setOutput("drift", String(drift.length > 0));
  log.setOutput("areas", JSON.stringify(drift.map((d) => ({ name: d.mapping.name, docs: d.mapping.docs }))));

  if (drift.length > 0) {
    const body = driftComment(drift, inputs.skipLabel);
    await log.summary(body.replace(MARKER, "").trim());
    if (inputs.comment) await upsertComment(api, body, true, log);
    const areas = drift.map((d) => d.mapping.name).join(", ");
    if (inputs.mode === "strict") {
      log.setFailed(`Docs not updated for: ${areas}. Update them or add the '${inputs.skipLabel}' label.`);
    } else {
      log.warning(`Docs may need an update for: ${areas}`);
    }
    return { drift: true, skipped };
  }

  const body = resolvedComment(skipped);
  await log.summary(body.replace(MARKER, "").trim());
  // Only edit an earlier warning; never add a new comment just to say everything is fine.
  if (inputs.comment) await upsertComment(api, body, false, log);
  log.info(skipped ? `Skipped: '${inputs.skipLabel}' label is set.` : "Docs look up to date.");
  return { drift: false, skipped };
}
