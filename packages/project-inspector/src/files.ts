import { access, readFile, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

export function relativePath(rootDir: string, absolutePath: string): string {
  return relative(rootDir, absolutePath).split(sep).join("/");
}

export function absolutePath(rootDir: string, projectPath: string): string {
  return resolve(rootDir, projectPath);
}

export async function firstExisting(
  rootDir: string,
  candidates: readonly string[],
  kind: "file" | "directory" = "file",
): Promise<string | undefined> {
  for (const candidate of candidates) {
    const absolute = absolutePath(rootDir, candidate);
    if (kind === "directory" ? await isDirectory(absolute) : await exists(absolute)) {
      return candidate;
    }
  }
  return undefined;
}
