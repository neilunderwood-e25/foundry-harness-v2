import { createHash } from "node:crypto";
import type { ContainerProfile, StyleGuideProfile } from "@foundry/contracts";
import { readProjectFile } from "./files.js";

export async function foundationFingerprint(
  rootDir: string,
  styleGuide: StyleGuideProfile,
  container: ContainerProfile,
): Promise<string> {
  const hash = createHash("sha256");
  const paths = [...new Set([...styleGuide.files, container.componentPath])].sort();
  for (const path of paths) {
    hash.update(path);
    hash.update("\0");
    hash.update(await readProjectFile(rootDir, path));
    hash.update("\0");
  }
  return hash.digest("hex");
}
