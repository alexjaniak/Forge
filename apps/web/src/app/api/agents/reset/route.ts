import { NextResponse } from "next/server";
import fs from "fs";
import { atomicWriteJsonSync, cronJobsPath, cronStatePath } from "@/lib/paths";

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

interface CronJobsConfig {
  stagger?: boolean;
  jobs: Array<{
    id: string;
    interval: string;
    prompt: string;
    contexts: string[];
    agentic: boolean;
    workspace: boolean;
    repo?: string;
    runtime?: string;
    model?: string;
  }>;
}

export async function POST() {
  try {
    // Match CLI reset semantics: no applied state means "reset to empty".
    let state: CronState = { jobs: {} };
    try {
      const raw = fs.readFileSync(cronStatePath(), "utf-8");
      state = JSON.parse(raw);
    } catch (err: unknown) {
      if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
        // no applied state file yet
      } else {
        throw err;
      }
    }

    // Read current config to preserve stagger setting
    let stagger = true;
    let currentJobs: CronJobsConfig["jobs"] = [];
    try {
      const raw = fs.readFileSync(cronJobsPath(), "utf-8");
      const data = JSON.parse(raw);
      stagger = data.stagger ?? true;
      currentJobs = data.jobs ?? [];
    } catch {
      // fresh config
    }

    const activeIds = new Set(Object.keys(state.jobs ?? {}));
    const currentIds = new Set(currentJobs.map((j) => j.id));

    // Rebuild jobs array from applied state
    const jobs: CronJobsConfig["jobs"] = [];
    for (const [id, entry] of Object.entries(state.jobs ?? {})) {
      // Find the existing job to use as base for fields not in state
      const existingJob = currentJobs.find((j) => j.id === id);

      jobs.push({
        id,
        interval: entry.interval ?? existingJob?.interval ?? "2m",
        prompt: entry.prompt ?? existingJob?.prompt ?? "",
        contexts: entry.contexts ?? existingJob?.contexts ?? [],
        agentic: entry.agentic ?? existingJob?.agentic ?? true,
        workspace: entry.workspace ?? existingJob?.workspace ?? true,
        ...(entry.repo !== undefined ? { repo: entry.repo } : existingJob?.repo !== undefined ? { repo: existingJob.repo } : {}),
        ...(entry.runtime !== undefined ? { runtime: entry.runtime } : existingJob?.runtime !== undefined ? { runtime: existingJob.runtime } : {}),
        ...(entry.model !== undefined ? { model: entry.model } : existingJob?.model !== undefined ? { model: existingJob.model } : {}),
      });
    }

    atomicWriteJsonSync(cronJobsPath(), { stagger, jobs });

    // Compute what changed
    const restored = [...activeIds].filter((id) => !currentIds.has(id));
    const removed = [...currentIds].filter((id) => !activeIds.has(id));

    return NextResponse.json({ success: true, restored, removed });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
