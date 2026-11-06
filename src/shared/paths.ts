import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

/** Repository root, so the CLI works from any working directory. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export class PathTraversalError extends Error {
  constructor(attemptedPath: string, rootDir: string) {
    super(`Path traversal attempt detected: "${attemptedPath}" escapes root directory "${rootDir}"`);
    this.name = "PathTraversalError";
  }
}

/**
 * Returns the base projects directory path.
 */
export function getProjectsDir(customBase?: string): string {
  if (customBase) return path.resolve(customBase);
  return path.join(REPO_ROOT, "projects");
}

/**
 * Returns the directory for a specific project.
 */
export function getProjectDir(projectId: string, customBase?: string): string {
  const sanitizedId = sanitizeFilename(projectId);
  return path.join(getProjectsDir(customBase), sanitizedId);
}

/**
 * Sanitizes an identifier to prevent directory traversal or invalid characters.
 */
export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
}

/**
 * Safely resolves a path relative to a project root, throwing an error if it escapes.
 */
export function resolveSafeProjectPath(projectRoot: string, relativeOrAbsolutePath: string): string {
  const resolvedRoot = path.resolve(projectRoot);
  const resolvedTarget = path.isAbsolute(relativeOrAbsolutePath)
    ? path.resolve(relativeOrAbsolutePath)
    : path.resolve(resolvedRoot, relativeOrAbsolutePath);

  // Check if resolvedTarget is inside resolvedRoot (or equal)
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PathTraversalError(relativeOrAbsolutePath, projectRoot);
  }

  return resolvedTarget;
}

/**
 * Converts an absolute path inside a project to a relative POSIX-style path for manifests.
 */
export function toProjectRelativePath(projectRoot: string, fullPath: string): string {
  const resolvedRoot = path.resolve(projectRoot);
  const resolvedTarget = path.resolve(fullPath);
  const rel = path.relative(resolvedRoot, resolvedTarget);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new PathTraversalError(fullPath, projectRoot);
  }
  return rel.split(path.sep).join("/");
}

/**
 * Standard project subdirectories
 */
export const PROJECT_SUBDIRS = [
  "research",
  "script",
  "storyboard",
  "assets/references",
  "assets/generated",
  "assets/voice",
  "assets/sound-effects",
  "assets/music",
  "assets/thumbnails",
  "editing",
  "render/preview",
  "render/final",
  "pipeline",
  "logs",
] as const;

/**
 * Ensures all standard project directories exist.
 */
export async function ensureProjectDirectories(projectRoot: string): Promise<void> {
  await fs.mkdir(projectRoot, { recursive: true });
  for (const sub of PROJECT_SUBDIRS) {
    const full = path.join(projectRoot, sub);
    await fs.mkdir(full, { recursive: true });
  }
}

