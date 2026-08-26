import type { AgentProvider, AgentExecutionRequest } from "./types.js";
import { AgentProviderError } from "./errors.js";

export class AgentProviderRegistry {
  readonly #providers = new Map<string, AgentProvider>();

  constructor(providers: readonly AgentProvider[] = []) {
    for (const provider of providers) this.register(provider);
  }

  register(provider: AgentProvider): void {
    if (this.#providers.has(provider.name)) {
      throw new AgentProviderError({
        provider: provider.name,
        code: "PROVIDER_ALREADY_REGISTERED",
        message: `Agent provider is already registered: ${provider.name}`,
      });
    }
    this.#providers.set(provider.name, provider);
  }

  resolve(name: AgentExecutionRequest["specification"]["agent"]["provider"]): AgentProvider {
    const provider = this.#providers.get(name);
    if (!provider) {
      throw new AgentProviderError({
        provider: name,
        code: "PROVIDER_NOT_CONFIGURED",
        message: `Agent provider is not configured: ${name}`,
      });
    }
    return provider;
  }

  list(): AgentProvider[] {
    return [...this.#providers.values()];
  }
}
