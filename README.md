# Gitea AI PR Assistant

A lightweight, robust Fastify webhook server that integrates Google Gemini AI with your Gitea instance to automatically generate Pull Request summaries and evaluate PR titles.

## Features

- **🤖 AI PR Summary**: Automatically generates a concise summary of the Pull Request based on the git diff, helping reviewers understand the changes quickly.
- **🏷️ PR Title Suggestion**: Evaluates the original PR title against the [Conventional Commits](https://www.conventionalcommits.org/) specification and the actual code changes. Suggests a better title if the original one is inadequate.
- **🚥 Built-in Task Queue**: Uses an in-memory task queue to process AI requests sequentially, preventing you from hitting API rate limits if multiple PRs are updated simultaneously.
- **🛠️ Fully Customizable Prompts**: Automatically generates editable prompt and template files upon first run, allowing you to tweak the AI's behavior and formatting without changing the source code.
- **🔍 Queue Monitoring**: Provides a dedicated endpoint to inspect currently processing and queued tasks.
- **⚙️ Feature Toggles**: Easily enable or disable specific AI functions via environment variables.

## Prerequisites

- [Bun](https://bun.sh/) installed on your machine.
- A Google Gemini API Key.
- A Gitea server and a Personal Access Token with access to read repositories and write issue/PR comments.

## Installation

1. Clone the repository:

   ```bash
   git clone <https://github.com/your-username/gitea-ai-pr-summary.git>
   cd gitea-ai-pr-summary
   ```

2. Install dependencies using Bun:

   ```bash
   bun install
   ```

## Configuration

Create a `.env` file in the root directory and configure the following environment variables:

```env
# Gitea Settings

GITEA_URL="<https://your-gitea-instance.com>"
GITEA_TOKEN="your_gitea_personal_access_token"

# Google Gemini Settings

GEMINI_API_KEY="your_google_gemini_api_key"
GEMINI_MODEL="gemma-4-31b-it" # Optional

# Feature Flags (Optional, both default to true)

ENABLE_PR_SUMMARY=true
ENABLE_PR_TITLE_SUGGESTION=true
```

## Usage

### Running the Server

Start the development server with live reload:

```bash
bun run dev
```

Or start the production server:

```bash
bun run start
```

The server runs on port `3000` by default. Make sure this port is accessible to your Gitea instance.

### Setting up the Gitea Webhook

1. Go to your Gitea repository (or organization) settings.
2. Navigate to **Webhooks** -> **Add Webhook** -> **Gitea**.
3. Set the **Target URL** to `<http://your-server-ip:3000/`>.
4. Under **Trigger On**, choose **Custom Events...** and select:
   - **Pull Request** (Triggers when a PR is opened)
   - **Pull Request Synchronized** (Triggers when new commits are pushed to the PR branch)
5. Save and test the webhook.

## Customizing Prompts & Templates

When the server runs and processes its first AI task, it creates a `prompts/` directory in the root folder containing the following files:

- `pr-summary.prompt.txt`
- `pr-summary.template.md`
- `pr-title-suggestion.prompt.txt`
- `pr-title-suggestion.template.md`

You can edit these files to modify the AI's instruction prompt (e.g., change the output language, enforce a specific formatting style) or the resulting Markdown template posted to Gitea. Changes to these files apply to the next generated task automatically without restarting the server.

## Monitoring Tasks

You can check the status of the internal task queue by visiting:

```
GET <http://your-server-ip:3000/tasks>
```

**Response Example:**

```json
{
  "isProcessing": true,
  "currentTask": {
    "taskId": "a1b2c3d4-...",
    "action": "pr_summary",
    "triggerSource": "pull_request_sync",
    "prIndex": 42,
    "repoOwner": "gitea",
    "repoName": "awesome-repo"
  },
  "queueLength": 1,
  "queuedTasks": [
    {
      "taskId": "e5f6g7h8-...",
      "action": "pr_title_suggestion",
      "triggerSource": "pull_request_sync",
      "prIndex": 42,
      "repoOwner": "gitea",
      "repoName": "awesome-repo",
      "prTitle": "update readme"
    }
  ]
}
```
