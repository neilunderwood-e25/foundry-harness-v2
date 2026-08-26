import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WorktreeError } from "./errors.js";

const execFileAsync = promisify(execFile);

export async function git(
  cwd: string,
  args: readonly string[],
  code = "GIT_COMMAND_FAILED",
): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", [...args], {
      cwd,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    throw new WorktreeError({
      code,
      message: `Git command failed: git ${args.join(" ")}`,
      details: { cwd, args },
      cause: error,
    });
  }
}

export async function gitSucceeds(cwd: string, args: readonly string[]): Promise<boolean> {
  try {
    await execFileAsync("git", [...args], { cwd, encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
}
