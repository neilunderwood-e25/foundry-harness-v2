import type { CmsFieldSnapshot, CmsTypeRef } from "@foundry/contracts";
import { InputPreparationError } from "@foundry/input-core";

export interface CmsInspection {
  readonly provider: CmsTypeRef["provider"];
  readonly contentType: string;
  readonly name: string;
  readonly graphqlType: string;
  readonly fields: readonly CmsFieldSnapshot[];
  readonly rawSchema: unknown;
  readonly sampleEntry?: unknown;
}

export interface CmsInspectionOptions {
  readonly fetchSampleEntry: boolean;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export interface CmsAdapter {
  readonly provider: CmsTypeRef["provider"];
  inspect(reference: CmsTypeRef, options: CmsInspectionOptions): Promise<CmsInspection>;
}

export class CmsAdapterRegistry {
  readonly #adapters: ReadonlyMap<CmsTypeRef["provider"], CmsAdapter>;

  constructor(adapters: readonly CmsAdapter[]) {
    this.#adapters = new Map(adapters.map((adapter) => [adapter.provider, adapter]));
  }

  resolve(provider: CmsTypeRef["provider"]): CmsAdapter {
    const adapter = this.#adapters.get(provider);
    if (!adapter) {
      throw new InputPreparationError({
        code: "CMS_ADAPTER_MISSING",
        message: `No CMS adapter is registered for ${provider}`,
      });
    }
    return adapter;
  }
}

export function graphqlName(value: string): string {
  const parts = value.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const candidate = parts
    .map((part, index) =>
      index === 0
        ? `${part.charAt(0).toLowerCase()}${part.slice(1)}`
        : `${part.charAt(0).toUpperCase()}${part.slice(1)}`,
    )
    .join("");
  return /^[_A-Za-z]/.test(candidate) ? candidate : `field${candidate}`;
}

export function pascalCase(value: string): string {
  const camel = graphqlName(value);
  return `${camel.charAt(0).toUpperCase()}${camel.slice(1)}`;
}

export function requiredEnvironment(
  environment: NodeJS.ProcessEnv,
  names: readonly string[],
): Record<string, string> {
  const result: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of names) {
    const value = environment[name];
    if (value) result[name] = value;
    else missing.push(name);
  }
  if (missing.length > 0) {
    throw new InputPreparationError({
      code: "CMS_CREDENTIALS_MISSING",
      message: `Missing CMS environment variables: ${missing.join(", ")}`,
      details: { missing },
    });
  }
  return result;
}
