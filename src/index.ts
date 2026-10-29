import * as core from "@actions/core";
import * as github from "@actions/github";
import { run, type GitHubApi, type Inputs, type Log, type PullRequest } from "./action.js";

async function main(): Promise<void> {
  const payload = github.context.payload.pull_request;
  if (!payload) {
    core.warning("docs-drift-check only runs on pull_request events. Nothing to do.");
    return;
  }

  const mode = core.getInput("mode") || "warn";
  if (mode !== "warn" && mode !== "strict") {
    core.setFailed(`mode must be 'warn' or 'strict', got '${mode}'`);
    return;
  }
  const inputs: Inputs = {
    configPath: core.getInput("config") || ".github/docs-map.yml",
    mode,
    skipLabel: core.getInput("skip-label") || "docs-not-needed",
    comment: core.getBooleanInput("comment"),
  };

  const { owner, repo } = github.context.repo;
  const pr: PullRequest = {
    owner,
    repo,
    number: payload.number,
    baseSha: payload.base.sha,
    headSha: payload.head.sha,
    labels: (payload.labels ?? []).map((l: { name: string }) => l.name),
  };

  const octokit = github.getOctokit(core.getInput("github-token", { required: true }));
  const api: GitHubApi = {
    async readFile(path, ref) {
      try {
        const res = await octokit.rest.repos.getContent({ owner, repo, path, ref });
        const data = res.data as { type?: string; content?: string; encoding?: string };
        if (data.type !== "file" || typeof data.content !== "string") return null;
        return Buffer.from(data.content, (data.encoding as BufferEncoding) || "base64").toString("utf8");
      } catch (err) {
        if ((err as { status?: number }).status === 404) return null;
        throw err;
      }
    },
    async changedFiles() {
      const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
        owner,
        repo,
        pull_number: pr.number,
        per_page: 100,
      });
      return files.flatMap((f) => (f.previous_filename ? [f.filename, f.previous_filename] : [f.filename]));
    },
    async listComments() {
      const comments = await octokit.paginate(octokit.rest.issues.listComments, {
        owner,
        repo,
        issue_number: pr.number,
        per_page: 100,
      });
      return comments.map((c) => ({ id: c.id, body: c.body ?? "" }));
    },
    async createComment(body) {
      await octokit.rest.issues.createComment({ owner, repo, issue_number: pr.number, body });
    },
    async updateComment(id, body) {
      await octokit.rest.issues.updateComment({ owner, repo, comment_id: id, body });
    },
  };

  const log: Log = {
    info: core.info,
    notice: (m) => core.notice(m),
    warning: (m) => core.warning(m),
    setFailed: core.setFailed,
    setOutput: core.setOutput,
    summary: async (markdown) => {
      await core.summary.addRaw(markdown, true).write();
    },
  };

  await run(inputs, pr, api, log);
}

main().catch((err: unknown) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
