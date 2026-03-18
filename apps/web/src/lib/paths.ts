import path from "path";
import fs from "fs";

/**
 * Resolve the repo root from which all data files are located.
 * Defaults to two levels up from apps/web/ (the repo root).
 */
export function getForgeRoot(): string {
  return (
    process.env.FORGE_REPO_ROOT || path.resolve(process.cwd(), "../..")
  );
}

export function cronJobsPath(): string {
  return path.join(getForgeRoot(), "agent-kernel/cron/cron-jobs.json");
}

export function cronStatePath(): string {
  return path.join(getForgeRoot(), "agent-kernel/cron/cron-state.json");
}

export function worktreePath(agentId: string, repo?: string): string {
  if (repo) {
    return path.join(getForgeRoot(), `.repos/${repo}/.worktrees/${agentId}`);
  }
  return path.join(getForgeRoot(), `.worktrees/${agentId}`);
}

export function repoRootPath(repo?: string): string {
  if (repo) {
    return path.join(getForgeRoot(), `.repos/${repo}`);
  }
  return getForgeRoot();
}

export function lockFilePath(agentId: string, repo?: string): string {
  return path.join(worktreePath(agentId, repo), ".agent.lock");
}

export function issueLocksPath(repo?: string): string {
  return path.join(repoRootPath(repo), "locks/issues");
}

export function agentLogPath(agentId: string): string {
  return path.join(getForgeRoot(), `agent-kernel/logs/${agentId}.log`);
}

export function logsDir(): string {
  return path.join(getForgeRoot(), "agent-kernel/logs");
}

export function templatePath(type: string): string {
  return path.join(getForgeRoot(), `templates/${type}.json`);
}

export function eventsPath(): string {
  return path.join(getForgeRoot(), "apps/webhook-monitor/events.jsonl");
}

export function managePyPath(): string {
  return path.join(getForgeRoot(), "agent-kernel/cron/manage.py");
}

export function runShPath(): string {
  return path.join(getForgeRoot(), "agent-kernel/run.sh");
}

export function atomicWriteJsonSync(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  const content = JSON.stringify(data, null, 2) + "\n";
  const tmpPath = path.join(dir, `.cron-jobs.tmp.${process.pid}`);
  fs.writeFileSync(tmpPath, content, "utf-8");
  fs.renameSync(tmpPath, filePath);
}
