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
      .filter((f) => f.endsWith(".json") || f.endsWith(".example.json"))
      .sort((a, b) => {
        const aIsLocal = a.endsWith(".json") && !a.endsWith(".example.json");
        const bIsLocal = b.endsWith(".json") && !b.endsWith(".example.json");
        if (aIsLocal !== bIsLocal) {
          return aIsLocal ? -1 : 1;
        }
        return a.localeCompare(b);
      });
  } catch {
    return NextResponse.json({ templates: [] });
  }

  const seen = new Set<string>();
  const templates = files.flatMap((file) => {
    const type = file.endsWith(".example.json")
      ? file.replace(/\.example\.json$/, "")
      : file.replace(/\.json$/, "");
    if (seen.has(type)) {
      return [];
    }
    seen.add(type);
    const raw = fs.readFileSync(path.join(templatesDir, file), "utf-8");
    const data = JSON.parse(raw);
    return [{
      type,
      interval: data.interval ?? "2m",
      contexts: data.contexts ?? [],
      agentic: data.agentic ?? true,
      workspace: data.workspace ?? true,
      model: data.model ?? "",
      repo: data.repo ?? "",
    }];
  });

  return NextResponse.json({ templates });
}
