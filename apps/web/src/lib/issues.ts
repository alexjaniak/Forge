import { execSync } from "child_process";
import { readCanonicalIssueLabels } from "@/lib/github-labels";
import { getForgeRoot } from "@/lib/paths";

export interface IssueSnapshot {
  issues: unknown[];
  labels: ReturnType<typeof readCanonicalIssueLabels>;
  repo: string;
}

let cache: (IssueSnapshot & { ts: number }) | null = null;
const TTL_MS = 5000;

export function invalidateIssueSnapshot(): void {
  cache = null;
}

export async function getIssueSnapshot(options?: {
  forceRefresh?: boolean;
}): Promise<IssueSnapshot> {
  const now = Date.now();
  if (!options?.forceRefresh && cache && now - cache.ts < TTL_MS) {
    return {
      issues: cache.issues,
      labels: cache.labels,
      repo: cache.repo,
    };
  }

  const cwd = getForgeRoot();
  const labels = readCanonicalIssueLabels();
  const raw = execSync(
    "gh issue list --state open --json number,title,labels,assignees --limit 100",
    { cwd, encoding: "utf-8", timeout: 10000 }
  );

  const issues = JSON.parse(raw) as unknown[];
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

  cache = { issues, labels, repo, ts: now };
  return { issues, labels, repo };
}
