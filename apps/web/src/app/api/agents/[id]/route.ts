import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { atomicWriteJsonSync, cronJobsPath } from "@/lib/paths";
import { CronJob, CronJobsData } from "@/lib/cron-types";

const SAFE_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!SAFE_ID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid agent ID" }, { status: 400 });
  }

  try {
    const raw = fs.readFileSync(cronJobsPath(), "utf-8");
    const data: CronJobsData = JSON.parse(raw);
    const jobs: CronJob[] = data.jobs ?? [];

    const newJobs = jobs.filter((j) => j.id !== id);
    if (newJobs.length === jobs.length) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    data.jobs = newJobs;
    atomicWriteJsonSync(cronJobsPath(), data);

    return NextResponse.json({ ok: true, agents: newJobs.map((j) => j.id) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
