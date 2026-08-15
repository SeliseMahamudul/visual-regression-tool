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

/**
 * FR-53: The structured form of what the QA engineer told the chatbot they
 * expect. Attached to a single comparison; never persisted as a reusable
 * profile.
 */
export interface ExpectationRules {
  /** Changes the user says are deliberate. Bias toward INTENTIONAL_CHANGE. */
  expected: string[];
  /** Changes the user explicitly says must NOT happen. Bias toward BUG. */
  unexpected: string[];
  /** Regions/elements known to be dynamic. Bias toward DYNAMIC_CONTENT. */
  ignore: string[];
  /** One-line summary the chat model produced, shown in the UI chip. */
  summary: string;
  /**
   * The user's own words, verbatim and unmodified.
   *
   * FR-56: this is not redundant with the three arrays. Extraction flattens
   * nuance ("the header is darker but the logo must stay exactly where it is"
   * becomes two disconnected bullets). The vision model sees the raw text too,
   * so intent that the extraction step lost is still available to it.
   */
  raw: string;
}

/** FR-52: one turn of the expectation conversation. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** FR-53/FR-54: what POST /api/chat returns for confirmation. */
export interface ChatResponse {
  reply: string;
  rules: ExpectationRules;
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
  jira_url?: string;
  github_issue?: string;
  created_at: string;
  /** FR-60: what the user claimed, stored alongside the verdict for audit. */
  expectations?: ExpectationRules;
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
