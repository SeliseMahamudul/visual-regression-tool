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

/**
 * FR-53: The structured form of what the QA engineer told the chatbot they
 * expect. Attached to a single comparison; never persisted as a reusable
 * profile. Kept identical to backend/src/types/index.ts — this repo duplicates
 * types between packages rather than sharing them.
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
  /** FR-56: the user's own words, verbatim — the vision model sees these too. */
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
  /** FR-60/FR-61: rules in force for this run, shown on the result card. */
  expectations?: ExpectationRules;
}

export interface CompareFormData {
  before: File | null;
  after: File | null;
  page_name: string;
  auto_file_bugs: boolean;
  jira_project_key: string;
  github_owner: string;
  github_repo: string;
  /** FR-55: applied to this one comparison only. */
  expectations?: ExpectationRules;
}

export interface IntegrationStatus {
  gemini: boolean;
  jira: boolean;
  github: boolean;
}
