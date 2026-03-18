import { NextResponse } from "next/server";
import fs from "fs";
import { availableTemplateTypes, templatePath } from "@/lib/paths";

export async function GET() {
  const types = availableTemplateTypes();
  if (types.length === 0) {
    return NextResponse.json({ templates: [] });
  }

  const templates = types.map((type) => {
    const raw = fs.readFileSync(templatePath(type), "utf-8");
    const data = JSON.parse(raw);
    return {
      type,
      interval: data.interval ?? "2m",
      contexts: data.contexts ?? [],
      agentic: data.agentic ?? true,
      workspace: data.workspace ?? true,
      repo: data.repo ?? "",
      model: data.model ?? "",
    };
  });

  return NextResponse.json({ templates });
}
