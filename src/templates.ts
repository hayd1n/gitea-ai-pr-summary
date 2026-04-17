import fs from "fs/promises";
import path from "path";

const PROMPTS_DIR =
  process.env.PROMPTS_DIR || path.join(process.cwd(), "prompts");

export async function getPromptOrTemplate(
  filename: string,
  defaultContent: string
): Promise<string> {
  try {
    const filePath = path.join(PROMPTS_DIR, filename);
    return await fs.readFile(filePath, "utf-8");
  } catch (err: any) {
    if (err.code === "ENOENT") {
      return defaultContent;
    }
    console.error(`Failed to load template ${filename}:`, err);
    return defaultContent;
  }
}

export const DEFAULT_PR_SUMMARY_PROMPT = `Your role is to generate a relevant description based on the PR information. Please generate the result based on the PR's Git diff.

## Formatting Instructions

- Provide a concise description of this PR to help other developers quickly understand the main content.
- Always use Markdown syntax.

### Format Example

\`\`\`markdown
## AI Summary

Here's a brief overview of the main content of this PR.

## Key Changes

Provide a detailed description of the changes in this PR.

## Type of Change

- [ ] CI/CD
- [ ] Bug fix
- [ ] New feature
- [ ] Refactor
- [ ] Chore/Docs
\`\`\`

## Additional Requirements

- Always respond in English, regardless of the language used in the Git diff.
- Do not include \`\`\` or \`\`\`markdown at the beginning of your reply; output the content in Markdown format directly.`;

export const DEFAULT_PR_TITLE_SUGGESTION_PROMPT = `Your role is to evaluate whether the original Pull Request title accurately reflects the changes in the provided Git diff.
The PR Title MUST follow these conventions:

---
### PR Title Specification

Format: \`[wip: ]<type>(<scope>): <subject>\`

- **WIP Prefix**: (Optional) Allow \`wip: \` or \`WIP: \` at the very beginning of the title if the PR is a Work In Progress.
- **Type**:
  - \`feat\`: New feature
  - \`fix\`: Bug fix
  - \`docs\`: Documentation only changes
  - \`style\`: Changes that do not affect the meaning of the code (white-space, formatting, etc)
  - \`refactor\`: Code change that neither fixes a bug nor adds a feature
  - \`perf\`: Code change that improves performance
  - \`test\`: Adding missing tests or correcting existing tests
  - \`chore\`: Changes to the build process or auxiliary tools
- **Scope**: (Optional) The module affected, e.g., \`(auth)\`, \`(ui)\`, \`(db)\`.
- **Subject**: Short description, use imperative mood.

**Examples:**
- \`feat(auth): implement jwt token generation\`
- \`wip: feat(ips): implement IPS configuration management\`
- \`fix(ui): adjust button padding on mobile devices\`
- \`docs: update API documentation for v2 endpoint\`
- \`refactor: simplify user data validation logic\`
---

You must output a JSON object with the following structure:
{
  "suggestModification": boolean, // true if the title needs improvement or does not follow the specification, false otherwise
  "suggestedTitle": string, // The new suggested title. It MUST be written in English. (Or the original if no change needed, but it MUST follow the specification above and be in English)
  "reason": string // The reason for the suggestion.
}

Do not include any Markdown tags like \`\`\`json, output ONLY the raw JSON object.`;

export const DEFAULT_PR_SUMMARY_TEMPLATE = `{{summary}}

> Generated at {{date}}, triggered by \`{{triggerSource}}\``;

export const DEFAULT_PR_TITLE_SUGGESTION_TEMPLATE = `### 💡 AI PR Title Suggestion

The original PR title could be improved to better reflect the changes or strictly follow the Conventional Commits specification.

**Suggested Title:**
\`\`\`text
{{suggestedTitle}}
\`\`\`

**Reason:**
> {{reason}}

> Generated at {{date}}, triggered by \`{{triggerSource}}\``;
