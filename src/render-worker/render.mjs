// Remotion render worker. Runs on Node because Remotion's browser setup times
// out when it runs inside Bun on this project (tested). Bun launches this file,
// passes a job JSON path, and reads one JSON object per line from stdout.
import fs from "node:fs";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { openBrowser, renderMedia, renderStill, selectComposition } from "@remotion/renderer";

// The CLI holds this pipe open. If the CLI dies, stop rather than render unattended.
process.stdin.on("end", () => process.exit(1));
process.stdin.resume();

const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);

const job = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const inputProps = JSON.parse(fs.readFileSync(job.inputPropsPath, "utf8"));

/** Builds the shared bundle once. Project assets are never copied into it. */
async function ensureBundle() {
  const indexHtml = path.join(job.bundleDir, "index.html");
  if (!fs.existsSync(indexHtml)) {
    emit({ type: "status", message: "bundling renderer" });
    const emptyPublicDir = `${job.bundleDir}.public`;
    fs.mkdirSync(emptyPublicDir, { recursive: true });
    await bundle({ entryPoint: job.entryPoint, outDir: job.bundleDir, publicDir: emptyPublicDir });
    fs.rmSync(emptyPublicDir, { recursive: true, force: true });
  }

  // A junction, so a single render serves the project's assets without copying them.
  const publicDir = path.join(job.bundleDir, "public");
  fs.mkdirSync(publicDir, { recursive: true });
  const link = path.join(publicDir, job.projectId);
  fs.mkdirSync(link, { recursive: true });
  const assets = path.join(link, "assets");
  try {
    fs.lstatSync(assets);
    fs.rmdirSync(assets);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  fs.symlinkSync(job.assetsDir, assets, "junction");
  return job.bundleDir;
}

async function main() {
  const serveUrl = await ensureBundle();
  const browser = await openBrowser("chrome", {
    browserExecutable: job.browserExecutable ?? undefined,
    chromiumOptions: { gl: "angle" },
  });

  try {
    const composition = await selectComposition({
      serveUrl,
      id: job.compositionId,
      inputProps,
      puppeteerInstance: browser,
    });

    for (const task of job.tasks) {
      fs.mkdirSync(path.dirname(task.output), { recursive: true });
      const temp = `${task.output}.part${path.extname(task.output)}`;

      if (task.type === "still") {
        await renderStill({
          composition,
          serveUrl,
          inputProps,
          output: temp,
          frame: task.frame,
          puppeteerInstance: browser,
        });
      } else {
        await renderMedia({
          composition,
          serveUrl,
          inputProps,
          codec: "h264",
          outputLocation: temp,
          frameRange: task.frameRange,
          muted: true,
          puppeteerInstance: browser,
          concurrency: job.concurrency,
          imageFormat: "jpeg",
          jpegQuality: task.jpegQuality,
          scale: task.scale,
          crf: task.crf,
          x264Preset: task.x264Preset,
          pixelFormat: "yuv420p",
          colorSpace: "bt709",
          overwrite: true,
          onProgress: ({ renderedFrames }) => emit({ type: "progress", taskId: task.id, renderedFrames }),
        });
      }

      fs.renameSync(temp, task.output);
      emit({ type: "taskDone", taskId: task.id, output: task.output });
    }
  } finally {
    await browser.close({ silent: true });
  }

  emit({ type: "done" });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    emit({ type: "error", message: err?.stack ?? String(err) });
    process.exit(1);
  });
