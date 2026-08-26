import { resolve } from "node:path";
import { AxeBuilder } from "@axe-core/playwright";
import { chromium } from "playwright";
import { QualityError } from "./errors.js";
import type {
  AccessibilityViolation,
  BrowserCapture,
  BrowserInspectionResult,
  BrowserInspector,
} from "./types.js";

export class PlaywrightBrowserInspector implements BrowserInspector {
  async inspect(
    input: Parameters<BrowserInspector["inspect"]>[0],
  ): Promise<BrowserInspectionResult> {
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
    } catch (error) {
      throw new QualityError({
        code: "BROWSER_LAUNCH_FAILED",
        message: "Chromium is unavailable. Run `pnpm quality:install-browser`.",
        cause: error,
      });
    }
    const captures: BrowserCapture[] = [];
    let accessibility: AccessibilityViolation[] = [];
    try {
      for (const reference of input.references) {
        const page = await browser.newPage({
          viewport: { width: reference.width, height: Math.max(900, reference.height) },
          deviceScaleFactor: 1,
        });
        page.setDefaultTimeout(input.navigationTimeoutMs);
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.addInitScript(() => {
          const documentValue = (
            globalThis as unknown as {
              document: { documentElement: { setAttribute(name: string, value: string): void } };
            }
          ).document;
          documentValue.documentElement.setAttribute("data-foundry-qa", "1");
        });
        const response = await page.goto(input.url, {
          waitUntil: "domcontentloaded",
          timeout: input.navigationTimeoutMs,
        });
        if (response && response.status() >= 400) {
          throw new QualityError({
            code: "PREVIEW_ROUTE_FAILED",
            message: `Preview route returned HTTP ${response.status()}`,
          });
        }
        const target = page.locator(input.selector).first();
        await target.waitFor({ state: "visible", timeout: input.navigationTimeoutMs });
        await target.scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
        const path = resolve(input.outputDirectory, `${reference.label}-actual.png`);
        await target.screenshot({ path, animations: "disabled" });
        const box = await target.boundingBox();
        if (!box) {
          throw new QualityError({
            code: "PREVIEW_TARGET_MISSING",
            message: `Preview selector is not measurable: ${input.selector}`,
            repairable: true,
          });
        }
        captures.push({
          label: reference.label,
          path,
          width: Math.round(box.width),
          height: Math.round(box.height),
        });
        if (reference.label === "desktop" && input.runAccessibility) {
          const analysis = await new AxeBuilder({ page }).include(input.selector).analyze();
          accessibility = analysis.violations.map((violation) => ({
            id: violation.id,
            impact: violation.impact ?? null,
            help: violation.help,
            nodes: violation.nodes.map((node) => ({
              target: node.target.map(String),
              ...(node.failureSummary ? { failureSummary: node.failureSummary } : {}),
            })),
          }));
        }
        await page.close();
      }

      const widths = input.references.map(({ width }) => width).sort((a, b) => a - b);
      const minimum = widths[0] ?? 390;
      const maximum = widths.at(-1) ?? 1440;
      const middle = Math.round(minimum + (maximum - minimum) / 2);
      const page = await browser.newPage({
        viewport: { width: middle, height: 900 },
        deviceScaleFactor: 1,
      });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(input.url, {
        waitUntil: "domcontentloaded",
        timeout: input.navigationTimeoutMs,
      });
      await page.locator(input.selector).first().waitFor({
        state: "visible",
        timeout: input.navigationTimeoutMs,
      });
      const metrics = await page.evaluate((selector) => {
        const documentValue = (
          globalThis as unknown as {
            document: {
              querySelector(value: string): {
                getBoundingClientRect(): { left: number; right: number };
              } | null;
              documentElement: { scrollWidth: number; clientWidth: number };
            };
          }
        ).document;
        const target = documentValue.querySelector(selector);
        const box = target?.getBoundingClientRect();
        return {
          found: Boolean(target && box),
          pageOverflow:
            documentValue.documentElement.scrollWidth - documentValue.documentElement.clientWidth,
          left: box?.left ?? 0,
          right: box?.right ?? 0,
          viewport: documentValue.documentElement.clientWidth,
        };
      }, input.selector);
      await page.close();
      const sectionOverflow =
        Math.max(0, metrics.right - metrics.viewport) + Math.max(0, -metrics.left);
      const reflowOk = metrics.found && metrics.pageOverflow <= 2 && sectionOverflow <= 2;
      return {
        captures,
        accessibility,
        reflow: {
          ok: reflowOk,
          width: middle,
          detail: reflowOk
            ? `No horizontal overflow at ${middle}px`
            : `At ${middle}px, page overflow is ${Math.round(metrics.pageOverflow)}px and section overflow is ${Math.round(sectionOverflow)}px`,
        },
      };
    } catch (error) {
      if (error instanceof QualityError) throw error;
      throw new QualityError({
        code: "BROWSER_INSPECTION_FAILED",
        message: error instanceof Error ? error.message : String(error),
        repairable: true,
        cause: error,
      });
    } finally {
      await browser.close();
    }
  }
}
