import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { spawn } from "child_process";
import {
  cronJobsPath,
  runShPath,
  getForgeRoot,
} from "@/lib/paths";

const SAFE_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;

interface CronJob {
  id: string;
  interval: string;
  prompt: string;
  contexts: string[];
  agentic: boolean;
  workspace: boolean;
  repo?: string;
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!SAFE_ID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid agent ID" }, { status: 400 });
  }

  let jobs: CronJob[] = [];
  try {
    const raw = fs.readFileSync(cronJobsPath(), "utf-8");
    jobs = JSON.parse(raw).jobs ?? [];
  } catch {
    return NextResponse.json(
      { error: "Failed to read agent config" },
      { status: 500 }
    );
  }

  const agent = jobs.find((j) => j.id === id);
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const args: string[] = [];
  if (agent.agentic) args.push("--agentic");
  if (agent.workspace) args.push("--workspace", agent.id);
  for (const ctx of agent.contexts) {
    args.push("--context", ctx);
  }
  if (agent.repo) args.push("--repo", agent.repo);
  args.push(agent.prompt);

  const child = spawn("bash", [runShPath(), ...args], {
    cwd: getForgeRoot(),
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
  });
  child.unref();

  return NextResponse.json({ status: "started" });
}
