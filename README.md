# Gitea AI PR Assistant

A lightweight, robust Fastify webhook server that integrates Google Gemini AI with your Gitea instance to automatically generate Pull Request summaries and evaluate PR titles.

## Features

- **🤖 AI PR Summary**: Automatically generates a concise summary of the Pull Request based on the git diff, helping reviewers understand the changes quickly.
- **🏷️ PR Title Suggestion**: Evaluates the original PR title against the [Conventional Commits](https://www.conventionalcommits.org/) specification and the actual code changes. Suggests a better title if the original one is inadequate.
- **🚥 Built-in Task Queue**: Uses an in-memory task queue to process AI requests sequentially, preventing you from hitting API rate limits if multiple PRs are updated simultaneously.
- **🛡 Large File Protection**: Automatically identifies and ignores excessively large diff changes (threshold scalable via config) to prevent crashing the LLM's context limits. Summaries will display an explicit note if files were skipped.
- **⌨ Chat Commands & PR Body Config**: Trigger summaries and title suggestions manually via PR comments with a customizable bot prefix. Automatically ignore specific files from AI logic easily via PR body descriptions (`AI Exclude: ...`).
- **🛠 Fully Customizable Prompts**: Automatically generates editable prompt and template files upon first run, allowing you to tweak the AI's behavior and formatting without changing the source code.
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

# Feature Flags & Settings (Optional)

ENABLE_PR_SUMMARY=true
ENABLE_PR_TITLE_SUGGESTION=true
BOT_COMMAND_PREFIX="@ai-bot"   # Default prefix to trigger bot via comments
MAX_DIFF_LENGTH_PER_FILE=150000 # Max character length per file in git diff before the file is excluded from AI context
RETRY_INTERVAL_SECONDS=60      # Wait time in seconds before retrying a failed task
MAX_RETRY_COUNT=5              # Maximum number of retry attempts for failed tasks
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
   - **Issue Comment** (Triggers when a user leaves a command for the bot on the PR)
5. Save and test the webhook.

### Chat Commands & Manual Triggers

You can explicitly ask the bot to process a PR by adding a comment. The bot uses the prefix defined in the `BOT_COMMAND_PREFIX` environment variable (defaults to `@ai-bot`).

**Available Commands:**

- `@ai-bot /summary`: Triggers the PR summary task.
- `@ai-bot /suggest-title`: Evaluates the current PR title and suggests an improvement.

**Excluding Files from the Diff (`--exclude`)**
You can append `--exclude \`pattern\`` to reduce token usage and omit generated or irrelevant files from the AI's context.

Example:

```markdown
@ai-bot /summary --exclude `*-lock.json, data/*, *test*`
```

*Note: Always use backticks (\`) around your patterns to prevent Gitea's Markdown parser from accidentally interpreting asterisks (`*`) as italics.*

**Default Exclusions in PR Body**
If you want to apply default exclusions to all AI actions on a specific PR, you can add a visible line in the Pull Request description (body). The bot will detect lines containing `AI Exclude:` or `AI-Exclude:`:

```markdown
> **AI Exclude**: `*.lock, tests/*, *.png`
```

The bot will automatically detect this and merge it with any commands you supply via PR comments.

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
  ],
  "delayedTasksLength": 1,
  "delayedTasks": [
    {
      "taskId": "f9g0h1i2-...",
      "action": "pr_summary",
      "triggerSource": "pull_request",
      "prIndex": 42,
      "repoOwner": "gitea",
      "repoName": "awesome-repo",
      "retryCount": 1,
      "retryAt": 1718449511000
    }
  ]
}
```
