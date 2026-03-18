import { execSync } from "child_process";
import { readCanonicalIssueLabels } from "@/lib/github-labels";
import { getForgeRoot } from "@/lib/paths";
import { IssueLinkMetadata, readIssueLocks } from "@/lib/issue-locks";

interface GitHubIssue {
  number: number;
  title: string;
  labels: { name: string; color: string }[];
  assignees: { login: string }[];
  workingAgentId?: string;
  workingLock?: IssueLinkMetadata & { claimedAt: string };
}

export interface IssueSnapshot {
  issues: GitHubIssue[];
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

  const issues = JSON.parse(raw) as GitHubIssue[];
  const issueLocks = readIssueLocks();
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

  const issuesWithLockMetadata = issues.map((issue) => {
    const issueLock = issueLocks.get(issue.number);
    if (!issueLock) {
      return issue;
    }

    return {
      ...issue,
      workingAgentId: issueLock.agentId,
      workingLock: {
        claimedAt: issueLock.claimedAt,
        repo: issueLock.repo,
        repoUrl: issueLock.repoUrl,
        issueUrl: issueLock.issueUrl,
      },
    };
  });

  cache = { issues: issuesWithLockMetadata, labels, repo, ts: now };
  return { issues: issuesWithLockMetadata, labels, repo };
}
