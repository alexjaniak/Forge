import { execSync } from "child_process";
import { NextResponse } from "next/server";
import { readCanonicalIssueLabels } from "@/lib/github-labels";
import { getForgeRoot } from "@/lib/paths";

let cache:
  | {
      issues: unknown[];
      labels: ReturnType<typeof readCanonicalIssueLabels>;
      repo: string;
      ts: number;
    }
  | null = null;
const TTL = 5000;

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.ts < TTL) {
    return NextResponse.json({
      issues: cache.issues,
      labels: cache.labels,
      repo: cache.repo,
    });
  }

  const cwd = getForgeRoot();
  const labels = readCanonicalIssueLabels();

  let issues: unknown[] = [];
  let repo = "";

  try {
    const raw = execSync(
      "gh issue list --state open --json number,title,labels,assignees --limit 100",
      { cwd, encoding: "utf-8", timeout: 10000 }
    );
    issues = JSON.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ issues: [], labels, repo: "", error: msg });
  }

  try {
    repo = execSync(
      "gh repo view --json nameWithOwner -q '.nameWithOwner'",
      { cwd, encoding: "utf-8", timeout: 10000 }
    ).trim();
  } catch {
    // non-fatal — links just won't work
  }

  cache = { issues, labels, repo, ts: now };
  return NextResponse.json({ issues, labels, repo });
}
