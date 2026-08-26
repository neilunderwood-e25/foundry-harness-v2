import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@foundry/contracts": fromRoot("./packages/contracts/src/index.ts"),
      "@foundry/agent-runtime": fromRoot("./packages/agent-runtime/src/index.ts"),
      "@foundry/domain": fromRoot("./packages/domain/src/index.ts"),
      "@foundry/foundation": fromRoot("./packages/foundation/src/index.ts"),
      "@foundry/orchestrator": fromRoot("./packages/orchestrator/src/index.ts"),
      "@foundry/project-inspector": fromRoot("./packages/project-inspector/src/index.ts"),
      "@foundry/provider-claude": fromRoot("./packages/provider-claude/src/index.ts"),
      "@foundry/provider-codex": fromRoot("./packages/provider-codex/src/index.ts"),
      "@foundry/worktrees": fromRoot("./packages/worktrees/src/index.ts"),
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
