import { GoogleGenAI } from "@google/genai";

export async function generatePRSummary(
  ai: GoogleGenAI,
  gitDiff: string,
  params: {
    model: string;
    prompt: string;
  }
) {
  const response = await ai.models.generateContent({
    model: params.model,
    contents: gitDiff,
    config: {
      systemInstruction: params.prompt,
    },
  });
  return response.text;
}

export async function suggestPRTitle(
  ai: GoogleGenAI,
  originalTitle: string,
  gitDiff: string,
  params: {
    model: string;
    prompt: string;
  }
) {
  const response = await ai.models.generateContent({
    model: params.model,
    contents: `Original Title: ${originalTitle}\n\nGit Diff:\n\`\`\`${gitDiff}\`\`\``,
    config: {
      systemInstruction: params.prompt,
      responseMimeType: "application/json",
    },
  });

  if (!response.text) {
    throw new Error("Failed to generate PR title suggestion");
  }

  try {
    return JSON.parse(response.text) as {
      suggestModification: boolean;
      suggestedTitle: string;
      reason: string;
    };
  } catch (err) {
    throw new Error(`Failed to parse AI JSON response: ${response.text}`);
  }
}
