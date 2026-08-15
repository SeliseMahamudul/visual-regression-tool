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
}

export interface CompareFormData {
  before: File | null;
  after: File | null;
  page_name: string;
  auto_file_bugs: boolean;
  jira_project_key: string;
  github_owner: string;
  github_repo: string;
}

export interface IntegrationStatus {
  gemini: boolean;
  jira: boolean;
  github: boolean;
}
