import axios from 'axios';
import { CompareFormData, TestResult, IntegrationStatus } from '../types';

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

  const response = await api.post('/compare', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

  return response.data.result;
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
