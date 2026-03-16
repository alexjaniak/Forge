import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getForgeRoot } from "@/lib/paths";

export async function GET() {
  const templatesDir = path.join(getForgeRoot(), "templates");

  let files: string[];
  try {
    files = fs
      .readdirSync(templatesDir)
      .filter((f) => f.endsWith(".json"));
  } catch {
    return NextResponse.json({ templates: [] });
  }

  const templates = files.map((file) => {
    const type = file.replace(/\.json$/, "");
    const raw = fs.readFileSync(path.join(templatesDir, file), "utf-8");
    const data = JSON.parse(raw);
    return {
      type,
      interval: data.interval ?? "2m",
      contexts: data.contexts ?? [],
      agentic: data.agentic ?? true,
      workspace: data.workspace ?? true,
    };
  });

  return NextResponse.json({ templates });
}
