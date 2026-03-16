import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import {
  atomicWriteJsonSync,
  cronJobsPath,
  cronStatePath,
  getForgeRoot,
  lockFilePath,
  templatePath,
} from "@/lib/paths";

interface CronJob {
  id: string;
  interval: string;
  prompt: string;
  contexts: string[];
  agentic: boolean;
  workspace: boolean;
  enabled?: boolean;
  repo?: string;
}

interface CronState {
  jobs: Record<
    string,
    {
      interval?: string;
      last_run?: string;
      stagger_offset?: number;
      installed_at?: string;
      contexts?: string[];
    }
  >;
}

function parseIntervalSeconds(interval: string): number {
  const match = interval.match(/^(\d+)(s|m|h)$/);
  if (!match) return 0;
  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case "s":
      return value;
    case "m":
      return value * 60;
    case "h":
      return value * 3600;
    default:
      return 0;
  }
}

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

function inferRole(id: string): string {
  const match = id.match(/^([a-zA-Z]+)-\d+$/);
  return match?.[1] ?? "worker";
}

function buildAgentFromJob(
  job: CronJob,
  jobState: CronState["jobs"][string] | undefined,
  status: "staged" | "active" | "modified" | "orphan",
  stagedInterval?: string
) {
  const intervalSeconds = parseIntervalSeconds(job.interval);
  const lastRun = jobState?.last_run ?? null;

  let running = false;
  try {
    const lockContent = fs.readFileSync(lockFilePath(job.id), "utf-8").trim();
    const pid = parseInt(lockContent, 10);
    if (!isNaN(pid)) {
      running = isProcessAlive(pid);
    }
  } catch {
    // no lock file
  }

  let nextRun: string | null = null;
  let overdue = false;
  if (lastRun) {
    const nextRunDate = new Date(
      new Date(lastRun).getTime() + intervalSeconds * 1000
    );
    nextRun = nextRunDate.toISOString();
    overdue = !running && new Date() > nextRunDate;
  }

  return {
    id: job.id,
    role: inferRole(job.id),
    interval: job.interval,
    intervalSeconds,
    enabled: job.enabled !== false,
    lastRun,
    nextRun,
    running,
    overdue,
    staggerOffset: jobState?.stagger_offset ?? 0,
    prompt: job.prompt,
    contexts: job.contexts,
    agentic: job.agentic,
    workspace: job.workspace,
    repo: job.repo ?? "",
    status,
    ...(stagedInterval ? { stagedInterval } : {}),
  };
}

export async function GET() {
  let jobs: CronJob[] = [];
  try {
    const raw = fs.readFileSync(cronJobsPath(), "utf-8");
    jobs = JSON.parse(raw).jobs ?? [];
  } catch {
    return NextResponse.json({ agents: [] });
  }

  let state: CronState = { jobs: {} };
  let hasState = false;
  try {
    const raw = fs.readFileSync(cronStatePath(), "utf-8");
    state = JSON.parse(raw);
    hasState = true;
  } catch {
    // no state file yet
  }

  const stagedIds = new Set(jobs.map((j) => j.id));
  const activeIds = new Set(Object.keys(state.jobs ?? {}));

  const agents = jobs.map((job) => {
    const jobState = state.jobs?.[job.id];
    const inState = activeIds.has(job.id);

    if (!hasState || !inState) {
      return buildAgentFromJob(job, undefined, "staged");
    }

    const activeInterval = jobState?.interval;
    if (activeInterval && activeInterval !== job.interval) {
      // interval field shows the active (running) interval
      // stagedInterval shows what it will change to on next apply
      const modifiedJob = { ...job, interval: activeInterval };
      return buildAgentFromJob(modifiedJob, jobState, "modified", job.interval);
    }

    return buildAgentFromJob(job, jobState, "active");
  });

  // Add orphan agents (in state but not in staged config)
  for (const id of activeIds) {
    if (!stagedIds.has(id)) {
      const jobState = state.jobs[id];
      const orphanJob: CronJob = {
        id,
        interval: jobState.interval ?? "?",
        prompt: "",
        contexts: jobState.contexts ?? [],
        agentic: false,
        workspace: false,
      };
      agents.push(buildAgentFromJob(orphanJob, jobState, "orphan"));
    }
  }

  return NextResponse.json({ agents });
}

function availableTemplateTypes(): Set<string> {
  const templatesDir = path.join(getForgeRoot(), "templates");
  try {
    return new Set(
      fs
        .readdirSync(templatesDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(/\.json$/, ""))
    );
  } catch {
    return new Set();
  }
}

const SAFE_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const type: string = body.type;

    const validTypes = availableTemplateTypes();
    if (!type || !validTypes.has(type)) {
      return NextResponse.json(
        { error: `type must be one of: ${[...validTypes].sort().join(", ")}` },
        { status: 400 }
      );
    }

    let template;
    try {
      const raw = fs.readFileSync(templatePath(type), "utf-8");
      template = JSON.parse(raw);
    } catch {
      return NextResponse.json(
        { error: `Template not found: ${type}` },
        { status: 500 }
      );
    }

    const filePath = cronJobsPath();
    let data: { stagger?: boolean; jobs: CronJob[] } = { stagger: true, jobs: [] };
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      data = JSON.parse(raw);
      if (!Array.isArray(data.jobs)) data.jobs = [];
    } catch {
      // fresh config
    }

    let id: string = body.id ?? "";
    if (id && !SAFE_ID_RE.test(id)) {
      return NextResponse.json(
        { error: "Invalid agent ID format" },
        { status: 400 }
      );
    }

    if (!id) {
      const existingIds = new Set(data.jobs.map((j) => j.id));
      for (let n = 1; n <= 99; n++) {
        const candidate = `${type}-${String(n).padStart(2, "0")}`;
        if (!existingIds.has(candidate)) {
          id = candidate;
          break;
        }
      }
      if (!id) {
        return NextResponse.json(
          { error: "Too many agents of this type" },
          { status: 400 }
        );
      }
    }

    if (data.jobs.some((j) => j.id === id)) {
      return NextResponse.json(
        { error: `Agent ${id} already exists` },
        { status: 409 }
      );
    }

    const newJob: CronJob = {
      id,
      interval: body.interval ?? template.interval ?? "2m",
      prompt: template.prompt ?? "",
      contexts: template.contexts ?? [],
      agentic: template.agentic ?? true,
      workspace: template.workspace ?? true,
    };

    data.jobs.push(newJob);
    atomicWriteJsonSync(filePath, data);

    return NextResponse.json({ ok: true, agent: newJob });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
