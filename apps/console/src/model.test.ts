import type { DurableRunSnapshot } from "@foundry/contracts";
import { describe, expect, it } from "vitest";
import { formatDuration, formatRelativeTime, parseDeliveryDocument, runProgress } from "./model.js";

const now = Date.parse("2026-08-26T12:00:00.000Z");

describe("console run model", () => {
  it("derives stable progress from parallel job state", () => {
    const snapshot = {
      run: { status: "running" },
      jobs: [{ status: "passed" }, { status: "running" }],
      steps: [],
    } as unknown as DurableRunSnapshot;
    expect(runProgress(snapshot)).toBe(65);
  });

  it("formats operator-friendly time and validates delivery JSON", () => {
    expect(formatRelativeTime("2026-08-26T11:55:00.000Z", now)).toBe("5m ago");
    expect(formatDuration("2026-08-26T11:58:31.000Z", undefined, now)).toBe("1m 29s");
    expect(parseDeliveryDocument('{"batch":{}}')).toEqual({ batch: {} });
    expect(() => parseDeliveryDocument("{}")).toThrow(/batch property/i);
  });
});
