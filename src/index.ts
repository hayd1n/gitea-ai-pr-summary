import Fastify from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { giteaApi } from "gitea-js";
import { getGiteaVersion } from "./gitea";
import { GoogleGenAI } from "@google/genai";
import { apiRoutes } from "./api";

// Load environment variables from .env file
const LISTEN_HOST = process.env.LISTEN_HOST || "0.0.0.0";
const LISTEN_PORT = process.env.LISTEN_PORT
  ? parseInt(process.env.LISTEN_PORT)
  : 3000;

const GITEA_URL = process.env.GITEA_URL;
const GITEA_TOKEN = process.env.GITEA_TOKEN;
if (!GITEA_URL || !GITEA_TOKEN) {
  console.error(
    "GITEA_URL and GITEA_TOKEN must be set in the environment variables."
  );
  process.exit(1);
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY must be set in the environment variables.");
  process.exit(1);
}
const GEMINI_MODEL = process.env.GEMINI_MODEL;

// Feature flags
// ENABLE_PR_SUMMARY defaults to true if not explicitly set to "false"
const ENABLE_PR_SUMMARY = process.env.ENABLE_PR_SUMMARY !== "false";
// ENABLE_PR_TITLE_SUGGESTION defaults to true if not explicitly set to "false"
const ENABLE_PR_TITLE_SUGGESTION =
  process.env.ENABLE_PR_TITLE_SUGGESTION !== "false";

// Bot command prefix defaults to @ai-bot
const BOT_COMMAND_PREFIX = process.env.BOT_COMMAND_PREFIX;
if (!BOT_COMMAND_PREFIX) {
  console.error("BOT_COMMAND_PREFIX must be set in the environment variables.");
  process.exit(1);
}

// Initialize Gitea API client
const gitea = giteaApi(GITEA_URL, { token: GITEA_TOKEN });

// Initialize Google Gemini AI client
const gemini = new GoogleGenAI({
  apiKey: GEMINI_API_KEY,
});

// Create Fastify server with TypeBox type provider
const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || "info",
  },
}).withTypeProvider<TypeBoxTypeProvider>();

// Register API Routes
fastify.register(apiRoutes, {
  gitea,
  gemini,
  geminiModel: GEMINI_MODEL,
  enablePrSummary: ENABLE_PR_SUMMARY,
  enablePrTitleSuggestion: ENABLE_PR_TITLE_SUGGESTION,
  botCommandPrefix: BOT_COMMAND_PREFIX,
});

// Get and log Gitea version on startup
try {
  const giteaVersion = await getGiteaVersion(gitea);
  fastify.log.info({ version: giteaVersion }, "Gitea version info");
} catch (error) {
  fastify.log.error({ error: error }, "Failed to get Gitea version");
  process.exit(1);
}

// Run the server
try {
  await fastify.listen({ host: LISTEN_HOST, port: LISTEN_PORT });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
