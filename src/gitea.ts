import type { Api } from "gitea-js";

export async function getGiteaVersion(api: Api<unknown>) {
  const version = (await api.version.getVersion()).data.version;
  if (!version) {
    throw new Error("Failed to get Gitea version");
  }
  return version;
}

export async function getPRDiff(
  api: Api<unknown>,
  owner: string,
  repo: string,
  index: number
) {
  const diff = (
    await api.repos.repoDownloadPullDiffOrPatch(
      owner,
      repo,
      index,
      "diff",
      {
        binary: false,
      },
      {
        format: "text",
      }
    )
  ).data;

  console.debug(diff);
  if (!diff) {
    throw new Error("Failed to get PR diff");
  }
  return diff as string;
}

export async function getPullRequest(
  api: Api<unknown>,
  owner: string,
  repo: string,
  index: number
) {
  const pr = (await api.repos.repoGetPullRequest(owner, repo, index)).data;
  if (!pr) {
    throw new Error("Failed to get Pull Request");
  }
  return pr;
}

export async function getIssueComments(
  api: Api<unknown>,
  owner: string,
  repo: string,
  index: number
) {
  const comments = (await api.repos.issueGetComments(owner, repo, index)).data;
  if (!comments) {
    throw new Error("Failed to get issue comments");
  }
  return comments;
}

export async function createIssueComment(
  api: Api<unknown>,
  owner: string,
  repo: string,
  index: number,
  body: string
) {
  const response = await api.repos.issueCreateComment(owner, repo, index, {
    body,
  });
  if (!response.data) {
    throw new Error("Failed to create issue comment");
  }
  return response.data;
}

export async function updateIssueComment(
  api: Api<unknown>,
  owner: string,
  repo: string,
  commentId: number,
  body: string
) {
  const response = await api.repos.issueEditComment(owner, repo, commentId, {
    body,
  });
  if (!response.data) {
    throw new Error("Failed to update issue comment");
  }
  return response.data;
}

export async function createOrUpdateExistingComment(
  api: Api<unknown>,
  owner: string,
  repo: string,
  index: number,
  prefix: string,
  body: string
) {
  const comments = await getIssueComments(api, owner, repo, index);
  const existingComment = comments.find((comment) =>
    comment.body?.startsWith(prefix)
  );

  if (existingComment && existingComment.id) {
    return await updateIssueComment(
      api,
      owner,
      repo,
      existingComment.id,
      `${prefix}\n\n${body}`
    );
  } else {
    return await createIssueComment(
      api,
      owner,
      repo,
      index,
      `${prefix}\n\n${body}`
    );
  }
}
