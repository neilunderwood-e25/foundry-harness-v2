import { InputPreparationError } from "./errors.js";

export interface JsonRequestOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly errorCode: string;
  readonly description: string;
}

function requestSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function fetchJson<T>(url: URL | string, options: JsonRequestOptions): Promise<T> {
  const fetcher = options.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await fetcher(url, {
      ...(options.headers ? { headers: options.headers } : {}),
      signal: requestSignal(options.timeoutMs, options.signal),
    });
  } catch (error) {
    throw new InputPreparationError({
      code: options.errorCode,
      message: `${options.description} request failed: ${error instanceof Error ? error.message : String(error)}`,
      retryable: true,
      cause: error,
    });
  }
  if (!response.ok) {
    throw new InputPreparationError({
      code: options.errorCode,
      message: `${options.description} failed with HTTP ${response.status}`,
      retryable: response.status === 429 || response.status >= 500,
      details: { status: response.status },
    });
  }
  return (await response.json()) as T;
}

export async function fetchBytes(
  url: URL | string,
  options: Omit<JsonRequestOptions, "headers"> & { headers?: Readonly<Record<string, string>> },
): Promise<{ bytes: Uint8Array; mediaType: string }> {
  const fetcher = options.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await fetcher(url, {
      ...(options.headers ? { headers: options.headers } : {}),
      signal: requestSignal(options.timeoutMs, options.signal),
    });
  } catch (error) {
    throw new InputPreparationError({
      code: options.errorCode,
      message: `${options.description} request failed: ${error instanceof Error ? error.message : String(error)}`,
      retryable: true,
      cause: error,
    });
  }
  if (!response.ok) {
    throw new InputPreparationError({
      code: options.errorCode,
      message: `${options.description} failed with HTTP ${response.status}`,
      retryable: response.status === 429 || response.status >= 500,
    });
  }
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    mediaType: response.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream",
  };
}
