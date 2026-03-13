export interface CronJob {
  id: string;
  interval: string;
  prompt: string;
  contexts: string[];
  agentic: boolean;
  workspace: boolean;
  enabled?: boolean;
  repo?: string;
}

export interface CronState {
  jobs: Record<
    string,
    {
      interval?: string;
      last_run?: string;
      stagger_offset?: number;
      installed_at?: string;
      contexts?: string[];
    }
  >;
}

export interface CronJobsData {
  jobs: CronJob[];
  [key: string]: unknown;
}
