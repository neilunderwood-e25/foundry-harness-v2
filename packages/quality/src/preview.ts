import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { QualityError } from "./errors.js";
import type { PreviewHandle, PreviewServer } from "./types.js";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a preview port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function stopProcess(child: ChildProcess): void {
  if (child.exitCode !== null || child.killed) return;
  try {
    if (child.pid) process.kill(-child.pid, "SIGTERM");
    else child.kill("SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

export class ProjectPreviewServer implements PreviewServer {
  async start(input: Parameters<PreviewServer["start"]>[0]): Promise<PreviewHandle> {
    const port = await freePort();
    const args = [...input.command.args, "--", "--port", String(port)];
    const child = spawn(input.command.executable, args, {
      cwd: input.workingDirectory,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PORT: String(port),
        NEXT_TELEMETRY_DISABLED: "1",
      },
    });
    let output = "";
    const append = (chunk: unknown) => {
      output = `${output}${String(chunk)}`.slice(-20_000);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    let spawnError: Error | undefined;
    child.once("error", (error) => {
      spawnError = error;
    });
    const abort = () => stopProcess(child);
    input.signal?.addEventListener("abort", abort, { once: true });
    const baseUrl = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + input.timeoutMs;
    try {
      while (Date.now() < deadline) {
        if (input.signal?.aborted) {
          throw new QualityError({
            code: "PREVIEW_CANCELLED",
            message: "Preview startup was cancelled",
          });
        }
        if (spawnError) {
          throw new QualityError({
            code: "PREVIEW_START_FAILED",
            message: spawnError.message,
            cause: spawnError,
          });
        }
        if (child.exitCode !== null) {
          throw new QualityError({
            code: "PREVIEW_START_FAILED",
            message: `Preview process exited with code ${child.exitCode}: ${output}`,
            repairable: true,
          });
        }
        try {
          const response = await fetch(baseUrl, { signal: AbortSignal.timeout(2_000) });
          if (response.status < 500) {
            return {
              baseUrl,
              logs: () => output,
              async stop() {
                stopProcess(child);
                input.signal?.removeEventListener("abort", abort);
              },
            };
          }
        } catch {
          // The server is still compiling or has not bound the port yet.
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 250));
      }
      throw new QualityError({
        code: "PREVIEW_START_TIMEOUT",
        message: `Preview did not start within ${input.timeoutMs}ms: ${output}`,
        repairable: true,
      });
    } catch (error) {
      stopProcess(child);
      input.signal?.removeEventListener("abort", abort);
      throw error;
    }
  }
}
