import { readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

const IGNORED_DIRECTORIES = new Set([".git", ".next", "coverage", "dist", "node_modules"]);

export function projectPath(rootDir: string, absolutePath: string): string {
  return relative(rootDir, absolutePath).split(sep).join("/");
}

export function absoluteProjectPath(rootDir: string, path: string): string {
  const absolute = resolve(rootDir, path);
  const rel = relative(rootDir, absolute);
  if (rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error(`Path escapes project: ${path}`);
  }
  return absolute;
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

export async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function collectFiles(
  rootDir: string,
  directories: readonly string[],
  extensions: ReadonlySet<string>,
  limit = 200,
): Promise<string[]> {
  const files: string[] = [];

  const walk = async (absoluteDir: string): Promise<void> => {
    if (files.length >= limit || !(await directoryExists(absoluteDir))) return;
    for (const entry of await readdir(absoluteDir, { withFileTypes: true })) {
      if (files.length >= limit) return;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await walk(resolve(absoluteDir, entry.name));
      } else if (entry.isFile()) {
        const extension = entry.name.includes(".") ? `.${entry.name.split(".").at(-1)}` : "";
        if (extensions.has(extension))
          files.push(projectPath(rootDir, resolve(absoluteDir, entry.name)));
      }
    }
  };

  for (const directory of directories) await walk(absoluteProjectPath(rootDir, directory));
  return [...new Set(files)].sort();
}

export async function readProjectFile(rootDir: string, path: string): Promise<string> {
  return readFile(absoluteProjectPath(rootDir, path), "utf8");
}
