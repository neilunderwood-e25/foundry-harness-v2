import { readFile, writeFile } from "node:fs/promises";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import type { ImageComparator, ImageComparison } from "./types.js";

function pad(source: PNG, width: number, height: number): PNG {
  if (source.width === width && source.height === height) return source;
  const output = new PNG({ width, height });
  PNG.bitblt(source, output, 0, 0, source.width, source.height, 0, 0);
  return output;
}

function compositeTransparentReference(
  reference: PNG,
  actual: PNG,
  width: number,
  height: number,
  bounds: { width: number; height: number },
) {
  const output = new PNG({ width, height });
  reference.data.copy(output.data);
  for (let y = 0; y < bounds.height; y += 1) {
    for (let x = 0; x < bounds.width; x += 1) {
      const index = (y * width + x) * 4;
      const alpha = reference.data[index + 3]! / 255;
      if (alpha === 1) continue;
      for (let channel = 0; channel < 3; channel += 1) {
        output.data[index + channel] = Math.round(
          reference.data[index + channel]! * alpha + actual.data[index + channel]! * (1 - alpha),
        );
      }
      output.data[index + 3] = actual.data[index + 3]!;
    }
  }
  return output;
}

export class PngImageComparator implements ImageComparator {
  async compare(input: Parameters<ImageComparator["compare"]>[0]): Promise<ImageComparison> {
    const referenceOriginal = PNG.sync.read(await readFile(input.referencePath));
    const actualOriginal = PNG.sync.read(await readFile(input.actualPath));
    const width = Math.max(referenceOriginal.width, actualOriginal.width);
    const height = Math.max(referenceOriginal.height, actualOriginal.height);
    const actual = pad(actualOriginal, width, height);
    const reference = compositeTransparentReference(
      pad(referenceOriginal, width, height),
      actual,
      width,
      height,
      { width: referenceOriginal.width, height: referenceOriginal.height },
    );
    const diff = new PNG({ width, height });
    const differingPixels = pixelmatch(reference.data, actual.data, diff.data, width, height, {
      threshold: input.pixelThreshold,
      includeAA: false,
    });
    await writeFile(input.diffPath, PNG.sync.write(diff));
    const comparedPixels = width * height;
    return {
      ratio: differingPixels / comparedPixels,
      differingPixels,
      comparedPixels,
      referenceSize: { width: referenceOriginal.width, height: referenceOriginal.height },
      actualSize: { width: actualOriginal.width, height: actualOriginal.height },
      diffPath: input.diffPath,
    };
  }
}
