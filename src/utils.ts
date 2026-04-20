export function filterGitDiff(diff: string, excludeFiles?: string[]): string {
  if (!excludeFiles || excludeFiles.length === 0) return diff;

  const chunks = diff.split(/^diff --git /m);
  let filteredDiff = chunks[0] ?? ""; // preamble

  for (let i = 1; i < chunks.length; i++) {
    const chunk = "diff --git " + chunks[i];
    const match = chunk.match(/^diff --git a\/(.*?)\s+b\//);
    const filename = match?.[1] ?? "";

    let excluded = false;
    for (const pattern of excludeFiles) {
      if (pattern.includes("*")) {
        const parts = pattern.split("*");
        const first = parts.shift() ?? "";
        const last = parts.pop() ?? "";

        if (!filename.startsWith(first) || !filename.endsWith(last)) {
          continue;
        }

        let pos = first.length;
        let match = true;
        for (const part of parts) {
          if (!part) continue; // handle consecutive '*'
          const idx = filename.indexOf(part, pos);
          if (idx === -1) {
            match = false;
            break;
          }
          pos = idx + part.length;
        }

        if (match && pos <= filename.length - last.length) {
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
