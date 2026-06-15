import type { FastifyPluginAsync } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import crypto from "crypto";
import {
  createOrUpdateExistingComment as createOrUpdateExistingIssueComment,
  createIssueComment,
  getPRDiff,
} from "./gitea";
import { generatePRSummary, suggestPRTitle } from "./ai";
import {
  getPromptOrTemplate,
  DEFAULT_PR_SUMMARY_PROMPT,
  DEFAULT_PR_TITLE_SUGGESTION_PROMPT,
  DEFAULT_PR_SUMMARY_TEMPLATE,
  DEFAULT_PR_TITLE_SUGGESTION_TEMPLATE,
} from "./templates";
import { giteaApi } from "gitea-js";
import { GoogleGenAI } from "@google/genai";
import { filterGitDiff } from "./utils";

export interface ApiOptions {
  gitea: ReturnType<typeof giteaApi>;
  gemini: GoogleGenAI;
  geminiModel?: string;
  enablePrSummary?: boolean;
  enablePrTitleSuggestion?: boolean;
  prSummaryCommentUpdateExisting?: boolean;
  prSummaryCommentPrefix?: string;
  prTitleSuggestionCommentPrefix?: string;
  botCommandPrefix?: string;
  maxDiffLengthPerFile?: number;
  retryInterval?: number;
  maxRetryCount?: number;
}

export const ApiOptionsDefaults = {
  geminiModel: "gemma-4-31b-it",
  enablePrSummary: true,
  enablePrTitleSuggestion: true,
  prSummaryCommentUpdateExisting: true,
  prSummaryCommentPrefix: "AI_PR_SUMMARY",
  prTitleSuggestionCommentPrefix: "AI_PR_TITLE_SUGGESTION",
  botCommandPrefix: "@ai-bot",
  maxDiffLengthPerFile: 150000,
  retryInterval: 60 * 1000,
  maxRetryCount: 5,
};

export const apiRoutes: FastifyPluginAsync<ApiOptions> = async (
  fastify,
  options
) => {
  const {
    gitea,
    gemini,
    geminiModel = ApiOptionsDefaults.geminiModel,
    enablePrSummary = ApiOptionsDefaults.enablePrSummary,
    enablePrTitleSuggestion = ApiOptionsDefaults.enablePrTitleSuggestion,
    prSummaryCommentUpdateExisting = ApiOptionsDefaults.prSummaryCommentUpdateExisting,
    prSummaryCommentPrefix = ApiOptionsDefaults.prSummaryCommentPrefix,
    prTitleSuggestionCommentPrefix = ApiOptionsDefaults.prTitleSuggestionCommentPrefix,
    botCommandPrefix = ApiOptionsDefaults.botCommandPrefix,
    maxDiffLengthPerFile = ApiOptionsDefaults.maxDiffLengthPerFile,
    retryInterval = ApiOptionsDefaults.retryInterval,
    maxRetryCount = ApiOptionsDefaults.maxRetryCount,
  } = options;

  const typedFastify = fastify.withTypeProvider<TypeBoxTypeProvider>();

  type TaskAction = "pr_summary" | "pr_title_suggestion";

  interface PRTask {
    taskId: string;
    action: TaskAction;
    triggerSource: string; // e.g., "pull_request_sync_event"
    prIndex: number;
    repoOwner: string;
    repoName: string;
    prTitle?: string;
    excludeFiles?: string[];
    retryCount?: number;
    commentPrefix?: string;
    retryAt?: number;
  }

  const taskQueue: PRTask[] = [];
  const delayedTasks: PRTask[] = [];

  let currentProcessingTask: PRTask | null = null;
  let isProcessingQueue = false;

  async function processQueue() {
    if (isProcessingQueue) return;
    isProcessingQueue = true;

    while (taskQueue.length > 0) {
      const task = taskQueue.shift();
      if (!task) continue;

      currentProcessingTask = task;
      const { taskId, action, prIndex, repoOwner, repoName } = task;
      typedFastify.log.info(
        { taskId, action, prIndex, repoOwner, repoName },
        `Processing task: ${action}`
      );

      try {
        if (action === "pr_summary") {
          typedFastify.log.info(
            { taskId },
            "Starting PR summary generation task"
          );

          let prefix = task.commentPrefix;
          if (!prefix) {
            let basePrefix = prSummaryCommentPrefix;
            if (!prSummaryCommentUpdateExisting) {
              basePrefix += `_${crypto.randomUUID()}`;
            }
            prefix = `<!-- ${basePrefix} -->`; // HTML comment to hide the prefix in the comment body
            task.commentPrefix = prefix;
          }

          const currentRetryCount = task.retryCount || 0;
          const attemptMsg = currentRetryCount > 0 ? ` (Attempt ${currentRetryCount + 1}/${maxRetryCount + 1})` : "";

          // Create or update a comment in Gitea to indicate that the summary is being generated
          await createOrUpdateExistingIssueComment(
            gitea,
            repoOwner,
            repoName,
            prIndex,
            prefix,
            `> Generating PR summary${attemptMsg}... (This may take a moment)`
          );

          const rawDiff = await getPRDiff(gitea, repoOwner, repoName, prIndex);
          const { filteredDiff: diff, autoExcludedFiles } = filterGitDiff(
            rawDiff,
            task.excludeFiles,
            maxDiffLengthPerFile
          );
          typedFastify.log.debug(
            { taskId, diffSize: diff.length },
            "Fetched PR diff"
          );

          // Load prompt and template dynamically
          const summaryPrompt = await getPromptOrTemplate(
            "pr-summary.prompt.txt",
            DEFAULT_PR_SUMMARY_PROMPT
          );
          const summaryTemplate = await getPromptOrTemplate(
            "pr-summary.template.md",
            DEFAULT_PR_SUMMARY_TEMPLATE
          );

          const prSummary = await generatePRSummary(gemini, diff, {
            model: geminiModel,
            prompt: summaryPrompt,
          });

          if (!prSummary) {
            throw new Error("PR summary generation returned empty result");
          }

          let finalComment = summaryTemplate
            .replace("{{summary}}", prSummary)
            .replace("{{date}}", new Date().toISOString())
            .replace("{{triggerSource}}", task.triggerSource);

          if (autoExcludedFiles.length > 0) {
            finalComment += "\n\n---\n";
            finalComment +=
              "> **⚠️ Note:** The following large files were ignored by AI to preserve context boundaries:\n";
            autoExcludedFiles.forEach((file) => {
              finalComment += `> - \`${file}\`\n`;
            });
          }

          // Create or update the PR summary comment in Gitea
          await createOrUpdateExistingIssueComment(
            gitea,
            repoOwner,
            repoName,
            prIndex,
            prefix,
            finalComment
          );

          typedFastify.log.info(
            { taskId },
            "PR Summary task completed successfully (Comment posted)"
          );
        } else if (action === "pr_title_suggestion") {
          typedFastify.log.info(
            { taskId },
            "Starting PR title suggestion task"
          );

          if (!task.prTitle) {
            typedFastify.log.warn(
              { taskId },
              "Missing PR title in task, skipping suggestion"
            );
            continue;
          }

          const rawDiff = await getPRDiff(gitea, repoOwner, repoName, prIndex);
          const { filteredDiff: diff, autoExcludedFiles } = filterGitDiff(
            rawDiff,
            task.excludeFiles,
            maxDiffLengthPerFile
          );
          typedFastify.log.debug(
            { taskId, prTitle: task.prTitle, diffSize: diff.length },
            "Fetched diff for title suggestion"
          );

          // Load prompt and template dynamically
          const suggestionPrompt = await getPromptOrTemplate(
            "pr-title-suggestion.prompt.txt",
            DEFAULT_PR_TITLE_SUGGESTION_PROMPT
          );
          const suggestionTemplate = await getPromptOrTemplate(
            "pr-title-suggestion.template.md",
            DEFAULT_PR_TITLE_SUGGESTION_TEMPLATE
          );

          let suggestion;
          try {
            suggestion = await suggestPRTitle(gemini, task.prTitle, diff, {
              model: geminiModel,
              prompt: suggestionPrompt,
            });
          } catch (error) {
            typedFastify.log.error(
              { taskId, error },
              "Failed to generate PR title suggestion"
            );
          }

          if (suggestion?.suggestModification) {
            let suggestionComment =
              `<!-- ${prTitleSuggestionCommentPrefix} -->\n\n` +
              suggestionTemplate
                .replace("{{suggestedTitle}}", suggestion.suggestedTitle)
                .replace("{{reason}}", suggestion.reason)
                .replace("{{date}}", new Date().toISOString())
                .replace("{{triggerSource}}", task.triggerSource);

            if (autoExcludedFiles.length > 0) {
              suggestionComment += "\n\n---\n";
              suggestionComment +=
                "> **⚠️ Note:** The following large files were ignored by AI to preserve context boundaries:\n";
              autoExcludedFiles.forEach((file) => {
                suggestionComment += `> - \`${file}\`\n`;
              });
            }

            await createIssueComment(
              gitea,
              repoOwner,
              repoName,
              prIndex,
              suggestionComment
            );

            typedFastify.log.info(
              { taskId, suggestedTitle: suggestion.suggestedTitle },
              "PR Title Suggestion task completed successfully (Comment posted)"
            );
          } else {
            typedFastify.log.info(
              { taskId },
              "PR Title Suggestion task completed (No suggestion needed)"
            );
          }
        }
      } catch (error) {
        typedFastify.log.error({ taskId, action, error }, "Task failed");
        
        if (action === "pr_summary") {
          const currentRetryCount = task.retryCount || 0;
          if (currentRetryCount < maxRetryCount) {
            const nextRetryCount = currentRetryCount + 1;
            const nextTask: PRTask = { ...task, retryCount: nextRetryCount, retryAt: Date.now() + retryInterval };
            const prefix = task.commentPrefix || `<!-- ${prSummaryCommentPrefix} -->`;
            
            const retryMessage = `> ⚠️ Failed to generate PR summary. Retrying in ${Math.round(retryInterval / 1000)} seconds (Attempt ${nextRetryCount}/${maxRetryCount})...`;
            
            try {
              await createOrUpdateExistingIssueComment(
                gitea,
                repoOwner,
                repoName,
                prIndex,
                prefix,
                retryMessage
              );
            } catch (commentError) {
              typedFastify.log.error({ taskId, commentError }, "Failed to update retry comment");
            }
            
            delayedTasks.push(nextTask);
            setTimeout(() => {
              const index = delayedTasks.findIndex((t) => t.taskId === nextTask.taskId);
              if (index !== -1) {
                delayedTasks.splice(index, 1);
              }
              taskQueue.push(nextTask);
              processQueue().catch((err) => {
                typedFastify.log.error({ err }, "Error in processQueue loop");
              });
            }, retryInterval);
            
            currentProcessingTask = null;
            continue;
          } else {
            const prefix = task.commentPrefix || `<!-- ${prSummaryCommentPrefix} -->`;
            try {
              await createOrUpdateExistingIssueComment(
                gitea,
                repoOwner,
                repoName,
                prIndex,
                prefix,
                "> ⚠️ Failed to generate PR summary after multiple attempts. Please check the logs for details."
              );
            } catch (e) {
              typedFastify.log.error({ taskId, error: e }, "Failed to update final failure comment");
            }
          }
        }
      }

      currentProcessingTask = null;
    }

    isProcessingQueue = false;
  }

  // Define the schema for the webhook request body
  const WebhookBodySchema = Type.Object({
    action: Type.Optional(Type.String()),
    pull_request: Type.Optional(
      Type.Object({
        number: Type.Number(),
        title: Type.Optional(Type.String()),
        body: Type.Optional(Type.String()),
      })
    ),
    issue: Type.Optional(
      Type.Object({
        number: Type.Number(),
        title: Type.Optional(Type.String()),
        body: Type.Optional(Type.String()),
        pull_request: Type.Optional(Type.Any()),
      })
    ),
    comment: Type.Optional(
      Type.Object({
        body: Type.Optional(Type.String()),
      })
    ),
    repository: Type.Optional(
      Type.Object({
        name: Type.String(),
        owner: Type.Optional(
          Type.Object({
            username: Type.String(),
          })
        ),
      })
    ),
  });

  // Define the route for handling Gitea webhooks
  typedFastify.post(
    "/",
    { schema: { body: WebhookBodySchema } },
    async function handler(request, reply) {
      typedFastify.log.debug(request.body, "Received request");

      // Handle different Gitea event types based on the "X-Gitea-Event-Type" header
      const eventType = request.headers["x-gitea-event-type"];
      const isPrSyncOrOpened =
        eventType === "pull_request_sync" ||
        (eventType === "pull_request" && request.body?.action === "opened");
      const isPrCommentCreated =
        (eventType === "pull_request_comment" ||
          eventType === "issue_comment") &&
        request.body?.action === "created" &&
        request.body?.issue?.pull_request;

      if (isPrSyncOrOpened || isPrCommentCreated) {
        let prIndex = request.body?.pull_request?.number;
        let prTitle = request.body?.pull_request?.title;
        let prBody = request.body?.pull_request?.body;
        const repoOwner = request.body?.repository?.owner?.username;
        const repoName = request.body?.repository?.name;

        if (isPrCommentCreated) {
          prIndex = request.body?.issue?.number;
          prTitle = request.body?.issue?.title;
          prBody = request.body?.issue?.body;
        }

        if (!prIndex || !repoOwner || !repoName) {
          typedFastify.log.error(
            { prIndex, repoOwner, repoName, eventType },
            "Missing required fields in event"
          );
          reply.status(400).send({ error: "Missing required fields" });
          return;
        }

        let triggerSummary = isPrSyncOrOpened ? enablePrSummary : false;
        let triggerSuggestion = isPrSyncOrOpened
          ? enablePrTitleSuggestion
          : false;

        let baseExcludeFiles: string[] = [];
        if (prBody) {
          const bodyExcludeMatch = prBody.match(
            /AI[- ]Exclude[\s*:]*`?([^`\n\r]+)`?/i
          );
          if (bodyExcludeMatch && bodyExcludeMatch[1]) {
            baseExcludeFiles = bodyExcludeMatch[1]
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
          }
        }

        let excludeFiles: string[] | undefined =
          baseExcludeFiles.length > 0 ? [...baseExcludeFiles] : undefined;

        if (isPrCommentCreated) {
          const commentBody = request.body?.comment?.body || "";
          let commanded = false;

          const escapedPrefix = botCommandPrefix.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
          );
          const summaryRegex = new RegExp(
            `${escapedPrefix}\\s+\\/summary(?:\\s+(.*))?`,
            "i"
          );
          const suggestRegex = new RegExp(
            `${escapedPrefix}\\s+\\/suggest-title(?:\\s+(.*))?`,
            "i"
          );

          // Extract the parts after the command specifically looking for --exclude
          // E.g., @ai-bot /summary --exclude `test.lua, *.txt, data/`
          const summaryMatch = commentBody.match(summaryRegex);
          if (summaryMatch) {
            triggerSummary = true;
            commanded = true;
            const extraArgs = summaryMatch[1]?.trim();
            if (extraArgs && extraArgs.startsWith("--exclude ")) {
              const commandExcludes = extraArgs
                .slice(10)
                .trim()
                .replace(/^`|`$/g, "")
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
              if (commandExcludes.length > 0) {
                excludeFiles = Array.from(
                  new Set([...(excludeFiles || []), ...commandExcludes])
                );
              }
            }
          }

          const suggestMatch = commentBody.match(suggestRegex);
          if (suggestMatch) {
            triggerSuggestion = true;
            commanded = true;
            const extraArgs = suggestMatch[1]?.trim();
            // If both commands are present (unlikely), excludeFiles might be overwritten by the second match
            if (extraArgs && extraArgs.startsWith("--exclude ")) {
              const commandExcludes = extraArgs
                .slice(10)
                .trim()
                .replace(/^`|`$/g, "")
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
              if (commandExcludes.length > 0) {
                excludeFiles = Array.from(
                  new Set([...(excludeFiles || []), ...commandExcludes])
                );
              }
            }
          }

          if (!commanded) {
            return request.body; // Not a bot command, do nothing
          }
        }

        typedFastify.log.info(
          { prIndex, prTitle, repoOwner, repoName, eventType },
          `Received ${eventType} event`
        );

        // Enqueue tasks for processing this PR asynchronously
        const taskIds: string[] = [];
        const enqueuedTasks: string[] = [];

        if (triggerSummary) {
          const summaryTaskId = crypto.randomUUID();
          taskQueue.push({
            taskId: summaryTaskId,
            action: "pr_summary",
            triggerSource: eventType as string,
            prIndex,
            repoOwner,
            repoName,
            excludeFiles,
          });
          taskIds.push(summaryTaskId);
          enqueuedTasks.push("AI PR Summary");
        }

        if (triggerSuggestion) {
          const suggestionTaskId = crypto.randomUUID();
          taskQueue.push({
            taskId: suggestionTaskId,
            action: "pr_title_suggestion",
            triggerSource: eventType as string,
            prIndex,
            repoOwner,
            repoName,
            prTitle,
            excludeFiles,
          });
          taskIds.push(suggestionTaskId);
          enqueuedTasks.push("PR Title Suggestion");
        }

        if (taskIds.length === 0) {
          reply.status(200).send({ message: "No AI tasks enabled" });
          return;
        }

        // Start processing queue asynchronously
        // kick-start the queue processing without awaiting it, so we can send an immediate response
        processQueue().catch((err) => {
          typedFastify.log.error({ err }, "Error in processQueue loop");
        });

        // Send immediate acknowledgment back
        reply.status(202).send({
          taskIds,
          status: "queued",
          message: `Tasks registered for: ${enqueuedTasks.join(", ")}`,
        });
        return;
      }

      return request.body;
    }
  );

  // Define the route for checking the task queue
  typedFastify.get("/tasks", async function handler(request, reply) {
    return {
      isProcessing: isProcessingQueue,
      currentTask: currentProcessingTask,
      queueLength: taskQueue.length,
      queuedTasks: taskQueue,
      delayedTasksLength: delayedTasks.length,
      delayedTasks: delayedTasks,
    };
  });
};
