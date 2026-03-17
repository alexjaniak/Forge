export interface CanonicalIssueLabels {
  status: string[];
  role: string[];
  type: string[];
}

const CANONICAL_ISSUE_LABELS: CanonicalIssueLabels = {
  status: [
    "status:ready-for-planning",
    "status:planning",
    "status:ready-for-work",
    "status:in-progress",
    "status:needs-review",
    "status:blocked",
    "status:done",
  ],
  role: ["role:worker", "role:planner", "role:super", "role:admin"],
  type: ["type:epic", "type:task", "type:fix"],
};

export function readCanonicalIssueLabels(): CanonicalIssueLabels {
  return {
    status: [...CANONICAL_ISSUE_LABELS.status],
    role: [...CANONICAL_ISSUE_LABELS.role],
    type: [...CANONICAL_ISSUE_LABELS.type],
  };
}
