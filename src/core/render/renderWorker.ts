import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { existsSync, lstatSync, readdirSync, rmdirSync } from "node:fs";
import { atomicWriteJson } from "../../shared/atomic.js";
import { RenderError } from "../../shared/errors.js";
import { REPO_ROOT } from "../../shared/paths.js";
import { getLocalBrowserExecutable } from "./browserLocator.js";

const WORKER_PATH = path.join(REPO_ROOT, "src", "render-worker", "render.mjs");
const ENTRY_POINT = path.join(REPO_ROOT, "src", "renderer", "index.ts");
const BUNDLE_ROOT = path.join(REPO_ROOT, ".cache", "remotion-bundle");

export type WorkerTask =
  | {
      id: string;
      type: "video";
      output: string;
      frameRange: [number, number];
      scale: number;
      crf: number;
      x264Preset: string;
      jpegQuality: number;
    }
  | { id: string; type: "still"; output: string; frame: number };

export interface WorkerRequest {
  projectId: string;
  assetsDir: string;
  inputProps: unknown;
  concurrency: number;
  tasks: WorkerTask[];
  /** Folder for the job and props files. */
  workDir: string;
  onProgress?: (taskId: string, renderedFrames: number) => void;
  onTaskDone?: (taskId: string) => void;
}

async function hashDirectory(dir: string, hash: crypto.Hash): Promise<void> {
  const entries = (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await hashDirectory(full, hash);
    else hash.update(entry.name).update(await fs.readFile(full));
  }
}

/** Identifies the renderer code, so its bundle and chunks rebuild only when it changes. */
export async function getRendererHash(): Promise<string> {
  const hash = crypto.createHash("sha256");
  await hashDirectory(path.join(REPO_ROOT, "src", "renderer"), hash);
  return hash.digest("hex").slice(0, 16);
}

/** Removes old bundles. Asset links are unlinked first, so originals are never followed. */
function removeOldBundles(keep: string): void {
  if (!existsSync(BUNDLE_ROOT)) return;
  for (const name of readdirSync(BUNDLE_ROOT)) {
    if (name === keep) continue;
    const dir = path.join(BUNDLE_ROOT, name);
    const publicDir = path.join(dir, "public");
    if (existsSync(publicDir)) {
      for (const project of readdirSync(publicDir)) {
        const assets = path.join(publicDir, project, "assets");
        try {
          if (lstatSync(assets).isSymbolicLink()) rmdirSync(assets);
        } catch {
          // Nothing linked for this project.
        }
      }
    }
    void fs.rm(dir, { recursive: true, force: true });
  }
}

export function findNode(): string {
  const node = process.env.FORGETUBE_NODE ?? Bun.which("node");
  if (!node) throw new RenderError("Node.js was not found. The render step needs it. Install Node, then retry.");
  return node;
}

export async function runRenderWorker(request: WorkerRequest): Promise<void> {
  const rendererHash = await getRendererHash();
  const bundleDir = path.join(BUNDLE_ROOT, rendererHash);
  removeOldBundles(rendererHash);

  await fs.mkdir(request.workDir, { recursive: true });
  const id = crypto.randomBytes(6).toString("hex");
  const jobPath = path.join(request.workDir, `job_${id}.json`);
  const propsPath = path.join(request.workDir, `props_${id}.json`);

  await atomicWriteJson(propsPath, request.inputProps);
  await atomicWriteJson(jobPath, {
    projectId: request.projectId,
    assetsDir: request.assetsDir,
    bundleDir,
    entryPoint: ENTRY_POINT,
    inputPropsPath: propsPath,
    compositionId: "Documentary",
    browserExecutable: getLocalBrowserExecutable() ?? null,
    concurrency: request.concurrency,
    tasks: request.tasks,
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(findNode(), [WORKER_PATH, jobPath], { cwd: REPO_ROOT, stdio: ["pipe", "pipe", "pipe"] });
      let buffered = "";
      let stderr = "";
      let failure: string | null = null;

      child.stdout.on("data", (chunk) => {
        buffered += chunk.toString("utf-8");
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const line of lines) {
          let event: any;
          try {
            event = JSON.parse(line);
          } catch {
            continue; // Remotion's own log line.
          }
          if (event.type === "progress") request.onProgress?.(event.taskId, event.renderedFrames);
          else if (event.type === "taskDone") request.onTaskDone?.(event.taskId);
          else if (event.type === "error") failure = event.message;
        }
      });
      child.stderr.on("data", (chunk) => (stderr += chunk.toString("utf-8")));
      child.on("error", (err) => reject(new RenderError(`Failed to start the render worker: ${err.message}`)));
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new RenderError(failure ?? `Render worker exited with code ${code}: ${stderr.slice(-800)}`));
      });
    });
  } finally {
    await fs.rm(jobPath, { force: true });
    await fs.rm(propsPath, { force: true });
  }
}
