import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PICKER_SCRIPT = `
try
  set selectedFolder to choose folder with prompt "Select a Next.js project folder"
  return POSIX path of selectedFolder
on error number -128
  return ""
end try
`;

/** Opens the host operating system's native directory chooser. */
export async function selectProjectDirectory(): Promise<string | undefined> {
  if (process.platform !== "darwin") {
    throw new Error("The native project folder picker is currently available on macOS only.");
  }

  const { stdout } = await execFileAsync("osascript", ["-e", PICKER_SCRIPT], {
    encoding: "utf8",
  });
  const selectedPath = stdout.trim();

  if (!selectedPath) return undefined;
  return selectedPath === "/" ? selectedPath : selectedPath.replace(/\/$/, "");
}
