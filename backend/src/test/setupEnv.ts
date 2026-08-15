// Runs before every test file. Keeps the suite hermetic: no real API keys, no
// real network calls to Gemini/Jira/GitHub, no reliance on a dev .env file.
process.env.VISION_PROVIDER = 'mock';
process.env.GEMINI_API_KEY = '';
process.env.JIRA_API_TOKEN = '';
process.env.GITHUB_TOKEN = '';
process.env.UPLOADS_DIR = require('path').join(__dirname, '.tmp-uploads');
process.env.RESULTS_DIR = require('path').join(__dirname, '.tmp-results');
