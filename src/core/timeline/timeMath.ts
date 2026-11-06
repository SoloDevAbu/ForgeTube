/**
 * Converts seconds to an integer frame count using deterministic rounding.
 */
export function secondsToFrames(seconds: number, fps: number): number {
  if (seconds < 0) throw new Error(`Seconds cannot be negative, got ${seconds}`);
  if (fps <= 0) throw new Error(`FPS must be positive, got ${fps}`);
  return Math.round(seconds * fps);
}

/**
 * Converts integer frame count to seconds.
 */
export function framesToSeconds(frames: number, fps: number): number {
  if (frames < 0) throw new Error(`Frames cannot be negative, got ${frames}`);
  if (fps <= 0) throw new Error(`FPS must be positive, got ${fps}`);
  return Math.round((frames / fps) * 1000) / 1000;
}

