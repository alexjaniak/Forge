import fs from "fs";
import path from "path";
import { getForgeRoot } from "@/lib/paths";

export interface CanonicalIssueLabels {
  status: string[];
  role: string[];
  type: string[];
}

const EMPTY_LABELS: CanonicalIssueLabels = {
  status: [],
  role: [],
  type: [],
};

function parseSection(
  markdown: string,
  heading: string,
  prefix: "status" | "role" | "type"
): string[] {
  const start = markdown.indexOf(heading);
  if (start === -1) {
    return [];
  }

  const rest = markdown.slice(start + heading.length);
  const end = rest.search(/\n##\s+/);
  const section = end === -1 ? rest : rest.slice(0, end);
  const matches = section.matchAll(new RegExp("`(" + prefix + ":[^`]+)`", "g"));

  return [...new Set(Array.from(matches, (match) => match[1]))];
}

export function readCanonicalIssueLabels(): CanonicalIssueLabels {
  try {
    const labelsPath = path.join(getForgeRoot(), "contexts/LABELS.md");
    const markdown = fs.readFileSync(labelsPath, "utf-8");

    return {
      status: parseSection(markdown, "## Status (lifecycle)", "status"),
      role: parseSection(markdown, "## Role (who acts on it)", "role"),
      type: parseSection(markdown, "## Type", "type"),
    };
  } catch {
    return EMPTY_LABELS;
  }
}
