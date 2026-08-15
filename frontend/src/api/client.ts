import axios from 'axios';
import {
  ChatMessage,
  ChatResponse,
  CompareFormData,
  TestResult,
  IntegrationStatus,
} from '../types';

const api = axios.create({
  baseURL: '/api',
  timeout: 120000,
});

export async function compareScreenshots(
  data: CompareFormData,
  runId: string
): Promise<TestResult> {
  const form = new FormData();
  if (data.before) form.append('before', data.before);
  if (data.after) form.append('after', data.after);
  form.append('run_id', runId);
  form.append('page_name', data.page_name || 'Unknown Page');
  form.append('auto_file_bugs', String(data.auto_file_bugs));
  if (data.jira_project_key) form.append('jira_project_key', data.jira_project_key);
  if (data.github_owner) form.append('github_owner', data.github_owner);
  if (data.github_repo) form.append('github_repo', data.github_repo);
  // FR-55/FR-60. Appended AFTER the files like every other text field — see
  // CLAUDE.md gotcha #2 for why multipart field ordering matters here.
  if (data.expectations) form.append('expectations', JSON.stringify(data.expectations));

  const response = await api.post('/compare', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

  return response.data.result;
}

/**
 * FR-52/FR-53: send the conversation, get structured rules back for
 * confirmation. Reuses the shared axios instance; its 120 s timeout is generous
 * for chat but harmless.
 */
export async function chat(messages: ChatMessage[]): Promise<ChatResponse> {
  const response = await api.post('/chat', { messages });
  return response.data;
}

export async function getIntegrationStatus(
  githubOwner?: string,
  githubRepo?: string
): Promise<IntegrationStatus> {
  const params = new URLSearchParams();
  if (githubOwner) params.set('github_owner', githubOwner);
  if (githubRepo) params.set('github_repo', githubRepo);
  const response = await api.get(`/integrations/status?${params}`);
  return response.data.integrations;
}

export async function getRunResults(runId: string): Promise<TestResult[]> {
  const response = await api.get(`/compare/results/${runId}`);
  return response.data.results;
}
