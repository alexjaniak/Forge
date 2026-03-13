import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import {
  atomicWriteJsonSync,
  cronJobsPath,
  cronStatePath,
  templatePath,
} from "@/lib/paths";

const SAFE_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;

interface CronJob {
  id: string;
  interval: string;
  prompt: string;
  contexts: string[];
  agentic: boolean;
  workspace: boolean;
}

interface CronJobsData {
  jobs: CronJob[];
  [key: string]: unknown;
}

interface CronState {
  jobs: Record<
    string,
    {
      interval?: string;
      contexts?: string[];
    }
  >;
}

function inferTemplateType(id: string): string {
  if (id.startsWith("planner")) return "planner";
  if (id.startsWith("super")) return "super";
  return "worker";
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!SAFE_ID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid agent ID" }, { status: 400 });
  }

  try {
    // Read cron-state.json to verify agent exists in state
    let state: CronState = { jobs: {} };
    try {
      const raw = fs.readFileSync(cronStatePath(), "utf-8");
      state = JSON.parse(raw);
    } catch {
      return NextResponse.json(
        { error: "No cron state found" },
        { status: 404 }
      );
    }

    if (!state.jobs?.[id]) {
      return NextResponse.json(
        { error: `Agent ${id} not found in cron state` },
        { status: 404 }
      );
    }

    // Read cron-jobs.json — verify agent is not already staged
    const filePath = cronJobsPath();
    let data: CronJobsData = { jobs: [] };
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      data = JSON.parse(raw);
      if (!Array.isArray(data.jobs)) data.jobs = [];
    } catch {
      // fresh config
    }

    if (data.jobs.some((j) => j.id === id)) {
      return NextResponse.json(
        { error: `Agent ${id} is already staged` },
        { status: 409 }
      );
    }

    // Infer template type from ID prefix
    const type = inferTemplateType(id);

    // Load template
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

    // Reconstruct job entry with state data + template defaults
    const jobState = state.jobs[id];
    const newJob: CronJob = {
      id,
      interval: jobState.interval ?? template.interval ?? "2m",
      prompt: template.prompt ?? "",
      contexts: jobState.contexts ?? template.contexts ?? [],
      agentic: template.agentic ?? true,
      workspace: template.workspace ?? true,
    };

    data.jobs.push(newJob);
    atomicWriteJsonSync(filePath, data);

    return NextResponse.json({
      ok: true,
      agent: { id: newJob.id, interval: newJob.interval },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
