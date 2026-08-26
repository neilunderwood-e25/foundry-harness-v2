const REDACTED = "[REDACTED]";
const SENSITIVE_KEY =
  /^(?:api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|authorization|cookie|private[_-]?key)$/i;
const SENSITIVE_ENVIRONMENT_KEY =
  /(?:^|_)(?:API_KEY|ACCESS_KEY|PRIVATE_KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION|COOKIE)(?:_|$)/i;
const TOKEN_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(?:sk|sk-ant|ghp|gho|github_pat|figd)[-_][A-Za-z0-9._-]{8,}\b/g,
] as const;

export interface RedactionOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly secrets?: readonly string[];
}

function environmentSecrets(environment: Readonly<Record<string, string | undefined>>): string[] {
  return Object.entries(environment)
    .filter(([key, value]) => SENSITIVE_ENVIRONMENT_KEY.test(key) && (value?.length ?? 0) >= 8)
    .map(([, value]) => value!)
    .sort((left, right) => right.length - left.length);
}

export function redactText(value: string, options: RedactionOptions = {}): string {
  let redacted = value;
  const environment = options.environment ?? process.env;
  const secrets = [...environmentSecrets(environment), ...(options.secrets ?? [])]
    .filter((secret) => secret.length >= 8)
    .sort((left, right) => right.length - left.length);

  for (const secret of new Set(secrets)) redacted = redacted.replaceAll(secret, REDACTED);
  for (const pattern of TOKEN_PATTERNS) redacted = redacted.replace(pattern, REDACTED);
  return redacted;
}

export function redactSecrets<T>(value: T, options: RedactionOptions = {}): T {
  const visit = (current: unknown, seen: WeakMap<object, unknown>): unknown => {
    if (typeof current === "string") return redactText(current, options);
    if (current === null || typeof current !== "object") return current;
    const existing = seen.get(current);
    if (existing !== undefined) return existing;
    if (Array.isArray(current)) {
      const copy: unknown[] = [];
      seen.set(current, copy);
      for (const item of current) copy.push(visit(item, seen));
      return copy;
    }
    const copy: Record<string, unknown> = {};
    seen.set(current, copy);
    for (const [key, item] of Object.entries(current)) {
      copy[key] =
        SENSITIVE_KEY.test(key) && item !== undefined && item !== null
          ? REDACTED
          : visit(item, seen);
    }
    return copy;
  };

  return visit(value, new WeakMap()) as T;
}

export { REDACTED };
