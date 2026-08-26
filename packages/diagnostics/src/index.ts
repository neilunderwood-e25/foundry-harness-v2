import type { DurableRunSnapshot } from "@foundry/contracts";
import { redactSecrets } from "@foundry/security";

export interface DiagnosticsBundle {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly system: {
    readonly node: string;
    readonly platform: NodeJS.Platform;
    readonly architecture: string;
  };
  readonly policy: {
    readonly artifactContentsIncluded: false;
    readonly secretsRedacted: true;
  };
  readonly snapshot: DurableRunSnapshot;
}

export function createDiagnosticsBundle(
  snapshot: DurableRunSnapshot,
  clock: () => Date = () => new Date(),
): DiagnosticsBundle {
  return {
    schemaVersion: 1,
    generatedAt: clock().toISOString(),
    system: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
    },
    policy: {
      artifactContentsIncluded: false,
      secretsRedacted: true,
    },
    snapshot: redactSecrets(snapshot),
  };
}
