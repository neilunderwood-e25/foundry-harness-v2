import type {
  BatchDeliveryRequest,
  ComponentBuildSpec,
  ProjectCommand,
  VerificationGate,
  WorktreeHandle,
} from "@foundry/contracts";

export type QualityBreakpoint = "desktop" | "mobile";

export interface DesignReference {
  readonly label: QualityBreakpoint;
  readonly sourceUrl: string;
  readonly path: string;
  readonly width: number;
  readonly height: number;
}

export interface DesignReferenceProvider {
  exportReferences(input: {
    specification: ComponentBuildSpec;
    outputDirectory: string;
    tokenEnvironmentVariable: string;
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<DesignReference[]>;
}

export interface PreviewHandle {
  readonly baseUrl: string;
  readonly logs: () => string;
  stop(): Promise<void>;
}

export interface PreviewServer {
  start(input: {
    workingDirectory: string;
    command: ProjectCommand;
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<PreviewHandle>;
}

export interface BrowserCapture {
  readonly label: QualityBreakpoint;
  readonly path: string;
  readonly width: number;
  readonly height: number;
}

export interface AccessibilityViolation {
  readonly id: string;
  readonly impact: "minor" | "moderate" | "serious" | "critical" | null;
  readonly help: string;
  readonly nodes: ReadonlyArray<{
    readonly target: readonly string[];
    readonly failureSummary?: string;
  }>;
}

export interface BrowserInspectionResult {
  readonly captures: BrowserCapture[];
  readonly reflow: { ok: boolean; width: number; detail: string };
  readonly accessibility: AccessibilityViolation[];
}

export interface BrowserInspector {
  inspect(input: {
    url: string;
    selector: string;
    references: readonly DesignReference[];
    outputDirectory: string;
    navigationTimeoutMs: number;
    runAccessibility: boolean;
    signal?: AbortSignal;
  }): Promise<BrowserInspectionResult>;
}

export interface ImageComparison {
  readonly ratio: number;
  readonly differingPixels: number;
  readonly comparedPixels: number;
  readonly referenceSize: { width: number; height: number };
  readonly actualSize: { width: number; height: number };
  readonly diffPath: string;
}

export interface ImageComparator {
  compare(input: {
    referencePath: string;
    actualPath: string;
    diffPath: string;
    pixelThreshold: number;
  }): Promise<ImageComparison>;
}

export interface QualityVerificationInput {
  readonly request: BatchDeliveryRequest;
  readonly specification: ComponentBuildSpec;
  readonly worktree: WorktreeHandle;
  readonly attempt: number;
  readonly signal?: AbortSignal;
}

export interface QualityGateProvider {
  verify(input: QualityVerificationInput): Promise<VerificationGate[]>;
}
