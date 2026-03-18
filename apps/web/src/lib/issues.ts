import { execSync } from "child_process";
import { readCanonicalIssueLabels } from "@/lib/github-labels";
import fs from "fs";
import path from "path";
import { getForgeRoot, issueLocksPath } from "@/lib/paths";

interface IssueListItem {
  number: number;
  title: string;
  labels: { name: string; color: string }[];
  assignees: { login: string }[];
  workingAgentId?: string;
}

export interface IssueSnapshot {
  issues: IssueListItem[];
  labels: ReturnType<typeof readCanonicalIssueLabels>;
  repo: string;
}

let cache: (IssueSnapshot & { ts: number }) | null = null;
const TTL_MS = 5000;

export function invalidateIssueSnapshot(): void {
  cache = null;
}

export function getEmptyIssueSnapshot(): IssueSnapshot {
  return {
    issues: [],
    labels: readCanonicalIssueLabels(),
    repo: "",
  };
}

export async function getIssueSnapshot(options?: {
  forceRefresh?: boolean;
}): Promise<IssueSnapshot> {
  const now = Date.now();
  if (!options?.forceRefresh && cache && now - cache.ts < TTL_MS) {
    return { issues: cache.issues, labels: cache.labels, repo: cache.repo };
  }

  const cwd = getForgeRoot();
  const labels = readCanonicalIssueLabels();
  const raw = execSync(
    "gh issue list --state open --json number,title,labels,assignees --limit 100",
    { cwd, encoding: "utf-8", timeout: 10000 }
  );

  let repo = "";

  try {
    repo = execSync("gh repo view --json nameWithOwner -q '.nameWithOwner'", {
      cwd,
      encoding: "utf-8",
      timeout: 10000,
    }).trim();
  } catch {
    // Non-fatal. Issue links fall back to plain cards.
  }

  const workingAgentsByIssue = readIssueLocks(repo);
  const issues = (JSON.parse(raw) as IssueListItem[]).map((issue) => ({
    ...issue,
    ...(workingAgentsByIssue.get(issue.number)
      ? { workingAgentId: workingAgentsByIssue.get(issue.number) }
      : {}),
  }));

  cache = { issues, labels, repo, ts: now };
  return { issues, labels, repo };
}

function readIssueLocks(repo?: string): Map<number, string> {
  const locks = new Map<number, string>();

  let entries: string[] = [];
  try {
    entries = fs.readdirSync(issueLocksPath(repo || undefined));
  } catch {
    return locks;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".lock")) continue;

    const issueNumber = Number.parseInt(path.basename(entry, ".lock"), 10);
    if (!Number.isInteger(issueNumber)) continue;

    try {
      const raw = fs.readFileSync(
        path.join(issueLocksPath(repo || undefined), entry, "info.json"),
        "utf-8"
      );
      const parsed = JSON.parse(raw) as { agent?: unknown; pid?: unknown };
      if (typeof parsed.agent !== "string" || parsed.agent.length === 0) continue;
      if (typeof parsed.pid !== "number") continue;

      try {
        process.kill(parsed.pid, 0);
      } catch (error: unknown) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "EPERM")) {
          continue;
        }
      }

      locks.set(issueNumber, parsed.agent);
    } catch {
      // Ignore malformed or stale lock files.
    }
  }

  return locks;
}
