export type ClassificationResult =
  | 'BUG'
  | 'INTENTIONAL_CHANGE'
  | 'DYNAMIC_CONTENT'
  | 'NEEDS_REVIEW';

export type Severity = 'critical' | 'medium' | 'low' | 'none';

export interface AIClassification {
  classification: ClassificationResult;
  severity: Severity;
  component: string;
  explanation: string;
  recommended_action: string;
  confidence: number;
  diff_percentage: number;
}

export interface TestRun {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  created_at: string;
  completed_at?: string;
  results: TestResult[];
  pr_number?: string;
  branch?: string;
  commit_sha?: string;
}

export interface TestResult {
  id: string;
  run_id: string;
  page_name: string;
  before_screenshot: string;
  after_screenshot: string;
  diff_screenshot: string;
  classification: AIClassification;
  jira_ticket?: string;
  github_issue?: string;
  created_at: string;
}

export interface JiraIssue {
  project_key: string;
  summary: string;
  description: string;
  issue_type: string;
  priority: string;
  labels: string[];
}

export interface GitHubIssue {
  owner: string;
  repo: string;
  title: string;
  body: string;
  labels: string[];
}

export interface CompareRequest {
  run_id: string;
  page_name: string;
  auto_file_bugs: boolean;
  jira_project_key?: string;
  github_owner?: string;
  github_repo?: string;
}

export interface PlaywrightCaptureRequest {
  url_before: string;
  url_after: string;
  pages: { name: string; path: string }[];
  viewport?: { width: number; height: number };
  wait_for_selector?: string;
  run_id: string;
}
