import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ProjectCommand } from "@foundry/contracts";

const execFileAsync = promisify(execFile);

export interface CommandResult {
  readonly ok: boolean;
  readonly detail?: string;
}

export interface CommandRunner {
  run(cwd: string, command: ProjectCommand, timeoutMs: number): Promise<CommandResult>;
}

function commandLabel(command: ProjectCommand): string {
  return [command.executable, ...command.args].join(" ");
}

function outputDetail(error: unknown, label: string): string {
  if (!error || typeof error !== "object") return `${label} failed: ${String(error)}`;
  const value = error as { message?: unknown; stdout?: unknown; stderr?: unknown };
  const output = [value.stderr, value.stdout]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join("\n")
    .trim();
  const message = typeof value.message === "string" ? value.message : `${label} failed`;
  return `${message}${output ? `\n${output.slice(-8_000)}` : ""}`;
}

export class ProcessCommandRunner implements CommandRunner {
  async run(cwd: string, command: ProjectCommand, timeoutMs: number): Promise<CommandResult> {
    const label = commandLabel(command);
    try {
      await execFileAsync(command.executable, [...command.args], {
        cwd,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
        timeout: timeoutMs,
      });
      return { ok: true, detail: `${label} completed` };
    } catch (error) {
      return { ok: false, detail: outputDetail(error, label) };
    }
  }
}
