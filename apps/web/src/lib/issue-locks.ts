import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { issueLocksPath, repoRootPath } from "@/lib/paths";

export interface IssueLockMetadata {
  issueNumber: number;
  agentId: string;
  claimedAt: string;
  pid: number;
  repo: string;
  repoUrl: string | null;
  issueUrl: string | null;
}

export interface IssueLinkMetadata {
  repo: string;
  repoUrl: string | null;
  issueUrl: string | null;
}

const repoMetadataCache = new Map<string, { repo: string; repoUrl: string | null }>();

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && err.code === "EPERM") {
      return true;
    }
    return false;
  }
}

function readRepoMetadata(repo?: string): { repo: string; repoUrl: string | null } {
  const cacheKey = repo ?? "";
  const cached = repoMetadataCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  let repoName = "";
  if (repo?.startsWith("github.com/")) {
    repoName = repo.slice("github.com/".length);
  } else {
    try {
      repoName = execSync("gh repo view --json nameWithOwner -q '.nameWithOwner'", {
        cwd: repoRootPath(repo),
        encoding: "utf-8",
        timeout: 10000,
      }).trim();
    } catch {
      repoName = "";
    }
  }

  const metadata = {
    repo: repoName,
    repoUrl: repoName ? `https://github.com/${repoName}` : null,
  };
  repoMetadataCache.set(cacheKey, metadata);
  return metadata;
}

function parseIssueNumber(dirName: string): number | null {
  const match = dirName.match(/^(\d+)\.lock$/);
  if (!match) {
    return null;
  }
  const number = Number.parseInt(match[1], 10);
  return Number.isFinite(number) ? number : null;
}

export function readIssueLocks(repo?: string): Map<number, IssueLockMetadata> {
  const locks = new Map<number, IssueLockMetadata>();
  const locksDir = issueLocksPath(repo);
  const repoMetadata = readRepoMetadata(repo);

  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(locksDir, { withFileTypes: true });
  } catch {
    return locks;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const issueNumber = parseIssueNumber(entry.name);
    if (issueNumber === null) {
      continue;
    }

    try {
      const infoPath = path.join(locksDir, entry.name, "info.json");
      const raw = fs.readFileSync(infoPath, "utf-8");
      const parsed = JSON.parse(raw) as {
        agent?: unknown;
        claimed_at?: unknown;
        pid?: unknown;
      };

      if (
        typeof parsed.agent !== "string" ||
        parsed.agent.trim() === "" ||
        typeof parsed.claimed_at !== "string" ||
        parsed.claimed_at.trim() === "" ||
        typeof parsed.pid !== "number" ||
        !Number.isInteger(parsed.pid) ||
        parsed.pid <= 0 ||
        !isProcessAlive(parsed.pid)
      ) {
        continue;
      }

      locks.set(issueNumber, {
        issueNumber,
        agentId: parsed.agent,
        claimedAt: parsed.claimed_at,
        pid: parsed.pid,
        repo: repoMetadata.repo,
        repoUrl: repoMetadata.repoUrl,
        issueUrl: repoMetadata.repo
          ? `https://github.com/${repoMetadata.repo}/issues/${issueNumber}`
          : null,
      });
    } catch {
      continue;
    }
  }

  return locks;
}
