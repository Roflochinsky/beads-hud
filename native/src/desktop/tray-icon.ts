import { nativeImage, type NativeImage } from 'electron';
import type { ReadinessState } from './readiness.js';

/** Draw the three monochrome beads from the current authoritative snapshot. */
export function trayImage(state: ReadinessState, macos: boolean): NativeImage {
  const size = 2;
  const width = 32 * size;
  const height = 16 * size;
  const bitmap = Buffer.alloc(width * height * 4);
  const ready = state.kind === 'ready' && state.readiness.hasIssues ? state.readiness : undefined;
  const illuminated = [Boolean(ready?.done), Boolean(ready?.active), Boolean(ready && ready.ready > 0)];
  const centers = [5, 16, 27];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let bead = 0; bead < centers.length; bead += 1) {
        const radius = Math.hypot((x + 0.5) / size - centers[bead], (y + 0.5) / size - 8);
        const inkDistance = bead === 0 ? radius - 3.4
          : bead === 1 ? Math.min(Math.abs(radius - 3.0) - 0.75, radius - 0.9)
            : Math.abs(radius - 3.0) - 0.75;
        // A light outline keeps the black mark visible on dark Linux bars. macOS
        // receives a black template so the system can adapt it to its menu bar.
        if (inkDistance > (macos ? 0 : 0.65)) continue;
        const alpha = Math.round((illuminated[bead] ? 1 : 0.35) * 255);
        const light = !macos && inkDistance > 0;
        const offset = (y * width + x) * 4;
        bitmap[offset] = light ? alpha : 0;
        bitmap[offset + 1] = light ? alpha : 0;
        bitmap[offset + 2] = light ? alpha : 0;
        bitmap[offset + 3] = alpha;
        break;
      }
    }
  }
  const image = nativeImage.createFromBitmap(bitmap, { width, height, scaleFactor: size });
  if (macos) image.setTemplateImage(true);
  return image;
}
