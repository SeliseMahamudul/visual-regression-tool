import { Router, Request, Response } from 'express';
import { testJiraConnection } from '../services/jiraService';
import { testGitHubConnection } from '../services/githubService';

const router = Router();

router.get('/status', async (req: Request, res: Response) => {
  const { github_owner, github_repo } = req.query;

  const status: Record<string, boolean | string> = {
    gemini: !!process.env.GEMINI_API_KEY,
    jira: false,
    github: false,
  };

  if (process.env.JIRA_API_TOKEN && process.env.JIRA_BASE_URL) {
    status.jira = await testJiraConnection().catch(() => false);
  }

  if (process.env.GITHUB_TOKEN && github_owner && github_repo) {
    status.github = await testGitHubConnection(
      github_owner as string,
      github_repo as string
    ).catch(() => false);
  }

  return res.json({ integrations: status });
});

export default router;
