import { NextResponse } from "next/server";
import fs from "fs";
import { cronJobsPath, cronStatePath } from "@/lib/paths";
import {
  COMPARE_FIELDS,
  diffAgentConfig,
  type FieldChange,
} from "@/lib/agent-config-diff";

interface CronJob {
  id: string;
  interval: string;
  prompt: string;
  contexts: string[];
  agentic: boolean;
  workspace: boolean;
  repo?: string;
  runtime?: string;
  model?: string;
}

interface CronState {
  jobs: Record<
    string,
    {
      interval?: string;
      prompt?: string;
      contexts?: string[];
      agentic?: boolean;
      workspace?: boolean;
      repo?: string;
      runtime?: string;
      model?: string;
    }
  >;
}

type DiffStatus = "new" | "modified" | "deleted";

interface FieldChange {
  from: unknown;
  to: unknown;
}
interface AgentDiff {
  id: string;
  status: DiffStatus;
  fields?: Record<string, unknown>;
  changes?: Record<string, FieldChange>;
}

export async function GET() {
  try {
    let jobs: CronJob[] = [];
    try {
      const raw = fs.readFileSync(cronJobsPath(), "utf-8");
      jobs = JSON.parse(raw).jobs ?? [];
    } catch {
      // no config file
    }

    let state: CronState = { jobs: {} };
    try {
      const raw = fs.readFileSync(cronStatePath(), "utf-8");
      state = JSON.parse(raw);
    } catch {
      // no state file
    }

    const stagedIds = new Set(jobs.map((j) => j.id));
    const activeIds = new Set(Object.keys(state.jobs ?? {}));
    const agents: AgentDiff[] = [];

    // New agents: in staged but not in applied state
    for (const job of jobs) {
      if (!activeIds.has(job.id)) {
        const fields: Record<string, unknown> = {};
        for (const field of COMPARE_FIELDS) {
          if (job[field] !== undefined) {
            fields[field] = job[field];
          }
        }
        agents.push({ id: job.id, status: "new", fields });
        continue;
      }

      // Modified agents: in both but with different fields
      const applied = state.jobs[job.id];
      const changes = diffAgentConfig(job, applied);
      if (Object.keys(changes).length > 0) {
        agents.push({ id: job.id, status: "modified", changes });
      }
    }

    // Deleted agents: in applied state but not in staged config
    for (const id of activeIds) {
      if (!stagedIds.has(id)) {
        agents.push({ id, status: "deleted" });
      }
    }

    return NextResponse.json({
      hasDiff: agents.length > 0,
      agents,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
