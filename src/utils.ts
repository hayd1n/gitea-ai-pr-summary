export function filterGitDiff(diff: string, excludeFiles?: string[]): string {
  if (!excludeFiles || excludeFiles.length === 0) return diff;

  const chunks = diff.split(/^diff --git /m);
  let filteredDiff = chunks[0]; // preamble

  for (let i = 1; i < chunks.length; i++) {
    const chunk = "diff --git " + chunks[i];
    const match = chunk.match(/^diff --git a\/(.*?)\s+b\//);
    const filename = match ? match[1] : "";

    let excluded = false;
    for (const pattern of excludeFiles) {
      if (pattern.startsWith("*.")) {
        const ext = pattern.slice(2);
        if (filename.endsWith("." + ext)) {
          excluded = true;
          break;
        }
      } else if (filename === pattern || filename.startsWith(pattern)) {
        excluded = true;
        break;
      }
    }

    if (!excluded) {
      filteredDiff += chunk;
    }
  }
  return filteredDiff;
}
