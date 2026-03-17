export interface AgentConfigFields {
  interval?: string;
  prompt?: string;
  contexts?: string[];
  agentic?: boolean;
  workspace?: boolean;
  repo?: string;
  runtime?: string;
  model?: string;
}

export interface FieldChange {
  from: unknown;
  to: unknown;
}

export const COMPARE_FIELDS = [
  "interval",
  "prompt",
  "contexts",
  "agentic",
  "workspace",
  "repo",
  "runtime",
  "model",
] as const;

const OPTIONAL_FIELD_DEFAULTS = {
  repo: "",
  runtime: "claude",
  model: "",
} as const;

function normalizeOptionalField(
  field: keyof AgentConfigFields,
  value: unknown
): unknown {
  if (
    Object.prototype.hasOwnProperty.call(OPTIONAL_FIELD_DEFAULTS, field) &&
    value === undefined
  ) {
    return OPTIONAL_FIELD_DEFAULTS[field as keyof typeof OPTIONAL_FIELD_DEFAULTS];
  }

  return value;
}
function fieldsEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function diffAgentConfig(
  staged: AgentConfigFields,
  applied: AgentConfigFields
): Record<string, FieldChange> {
  const changes: Record<string, FieldChange> = {};

  for (const field of COMPARE_FIELDS) {
    const stagedVal = normalizeOptionalField(field, staged[field]);
    const appliedVal = normalizeOptionalField(field, applied[field]);
    if (!fieldsEqual(stagedVal, appliedVal)) {
      changes[field] = { from: appliedVal, to: stagedVal };
    }
  }

  return changes;
}
