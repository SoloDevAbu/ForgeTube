import { Command } from "commander";
import { RenderService } from "../../core/render/renderService.js";
import { JobManager } from "../../core/jobs/jobManager.js";
import { printOutput, printError } from "../output.js";

export function registerRenderCommands(program: Command, rs: RenderService): void {
  program
    .command("render")
    .description("Render scene preview, draft video, or final high-quality documentary video")
    .requiredOption("-p, --project <id>", "Project ID")
    .option("-m, --mode <mode>", "Render mode ('scene', 'draft', or 'final')", "final")
    .option("-s, --scene <sceneId>", "Scene ID (required if mode is 'scene')")
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        if (options.mode === "scene" && !options.scene) {
          console.error("Error: --scene <sceneId> is required when rendering in 'scene' mode.");
          process.exitCode = 1;
          return;
        }

        console.log(`\nStarting ${options.mode} render for project "${options.project}"...`);
        let lastReportedPct = -1;

        const res = await rs.renderVideo(options.project, {
          mode: options.mode as any,
          sceneId: options.scene,
          onProgress: (p) => {
            const pct = Math.floor(p * 100);
            if (pct !== lastReportedPct && pct % 10 === 0) {
              lastReportedPct = pct;
              if (!globalOpts.json) {
                process.stdout.write(`\rRender Progress: ${pct}%`);
              }
            }
          },
        });

        if (!globalOpts.json) console.log();

        printOutput(res, globalOpts.json, () => {
          console.log(`\n\x1b[32m✔\x1b[0m Video render completed and verified successfully!`);
          console.log(`  Output File:  \x1b[36m${res.outputPath}\x1b[0m`);
          console.log(`  Resolution:   ${res.validation.width}x${res.validation.height}`);
          console.log(`  Duration:     ${res.validation.durationSeconds.toFixed(2)}s`);
          console.log(`  File Size:    ${(res.validation.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB`);
          console.log(`  Audio Stream: ${res.validation.hasAudio ? "Present" : "None"}`);
          console.log(`  You can open and play this MP4 file in any local media player.\n`);
        });
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });

  program
    .command("preview")
    .description("Generate a quick scene still or draft preview video")
    .requiredOption("-p, --project <id>", "Project ID")
    .option("-s, --scene <sceneId>", "Scene ID to preview")
    .option("-m, --mode <mode>", "Preview mode: 'still' or 'draft'", "still")
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        if (options.mode === "still") {
          if (!options.scene) {
            console.error("Error: --scene <sceneId> is required for still preview.");
            process.exitCode = 1;
            return;
          }
          const stillPath = await rs.renderSceneStill(options.project, options.scene);
          printOutput({ stillPath }, globalOpts.json, () => {
            console.log(`\x1b[32m✔\x1b[0m Scene preview still generated: \x1b[36m${stillPath}\x1b[0m`);
          });
        } else {
          // Draft video render
          const res = await rs.renderVideo(options.project, {
            mode: "draft",
            sceneId: options.scene,
          });
          printOutput(res, globalOpts.json, () => {
            console.log(`\x1b[32m✔\x1b[0m Draft preview video rendered: \x1b[36m${res.outputPath}\x1b[0m`);
          });
        }
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });
}

export function registerJobCommands(program: Command, jm: JobManager): void {
  const jobsCmd = program.command("jobs").description("Job status and logs");

  jobsCmd
    .command("status")
    .description("Show status of recent jobs for a project")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        const jobs = await jm.getJobs(options.project);

        printOutput(jobs, globalOpts.json, () => {
          if (jobs.length === 0) {
            console.log(`No jobs recorded for project "${options.project}".`);
            return;
          }
          console.log(`\nJobs for "${options.project}":\n`);
          for (const j of jobs) {
            console.log(`  • [${j.jobId}] ${j.type} (${j.mode || "default"})`);
            console.log(`    Status: ${j.status} | Progress: ${Math.round(j.progress * 100)}% | Started: ${j.startedAt}`);
            if (j.outputPath) console.log(`    Output: ${j.outputPath}`);
            if (j.error) console.log(`    Error:  ${j.error}`);
          }
          console.log();
        });
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });
}

