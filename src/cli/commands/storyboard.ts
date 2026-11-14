import { Command } from "commander";
import { StoryboardManager } from "../../core/storyboard/storyboardManager.js";
import { TimelineCompiler } from "../../core/timeline/timelineCompiler.js";
import { bad, guarded, ok, printIssues, printOutput } from "../output.js";

export function registerStoryboardCommands(program: Command, stm: StoryboardManager, tc: TimelineCompiler): void {
  const cmd = program.command("storyboard").description("Shot list: written by Claude Code, checked here");
  const json = () => Boolean(program.opts().json);

  cmd
    .command("brief")
    .description("Print the storyboard brief, for the whole film or one chapter")
    .requiredOption("-p, --project <id>", "Project ID")
    .option("-c, --chapter <id>", "Chapter ID")
    .action(guarded(program, async (o) => console.log(await stm.buildBrief(o.project, o.chapter))));

  cmd
    .command("import")
    .description("Import the shot list. Existing shots keep their images and crops")
    .requiredOption("-p, --project <id>", "Project ID")
    .requiredOption("-i, --input <file>", "Storyboard file")
    .option("--force", "Import without an approved script")
    .action(
      guarded(program, async (o) => {
        const result = await stm.importStoryboard(o.project, o.input, { force: o.force });
        printOutput(result, json(), () => {
          ok(`${result.storyboard.scenes.length} shots: ${result.added} new, ${result.kept} kept, ${result.removed} removed.`);
          for (const w of result.warnings) console.log(`  warn:  ${w}`);
        });
      })
    );

  cmd
    .command("rebalance")
    .description("Move word boundaries so shots fit the time limits, using real voice timing")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(
      guarded(program, async (o) => {
        const result = await stm.rebalance(o.project, tc);
        printOutput(result, json(), () => {
          ok(`Moved ${result.moves.length} shot boundaries.`);
          for (const u of result.unresolved) {
            console.log(`  needs image: ${u.sceneId} (${u.seconds.toFixed(1)} s). ${u.suggestion}`);
          }
        });
        if (result.unresolved.length > 0) process.exitCode = 1;
      })
    );

  cmd
    .command("validate")
    .description("Check shots, prompts and time limits")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(
      guarded(program, async (o) => {
        const report = await stm.validateStoryboard(o.project);
        printOutput(report, json(), () => {
          if (report.valid) ok(`Storyboard is valid: ${report.sceneCount} shots.`);
          else bad("Storyboard failed validation.");
          printIssues(report);
        });
        if (!report.valid) process.exitCode = 1;
      })
    );

  cmd
    .command("approve")
    .description("Approve the storyboard")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(
      guarded(program, async (o) => {
        await stm.approveStoryboard(o.project);
        printOutput({ approved: true }, json(), () => {
          ok("Storyboard approved.");
          console.log(`  Next: video-studio prompts export --project ${o.project}`);
        });
      })
    );

  cmd
    .command("show")
    .description("List shots, or show one in full")
    .requiredOption("-p, --project <id>", "Project ID")
    .option("-s, --scene <id>", "Scene ID")
    .action(
      guarded(program, async (o) => {
        const storyboard = await stm.getStoryboard(o.project);
        if (o.scene) {
          console.log(JSON.stringify(storyboard.scenes.find((s) => s.sceneId === o.scene) ?? null, null, 2));
          return;
        }
        printOutput(storyboard, json(), () => {
          for (const s of storyboard.scenes) {
            console.log(`  ${s.sceneId}  ${s.camera.effect}  ${s.shortPrompt}`);
          }
        });
      })
    );
}

export function registerPromptsCommands(program: Command, stm: StoryboardManager): void {
  const cmd = program.command("prompts").description("Google Flow image prompts");

  cmd
    .command("export")
    .description("Write prompt batches of 10 for Google Flow")
    .requiredOption("-p, --project <id>", "Project ID")
    .option("-c, --chapter <id>", "Only this chapter, in a separate file")
    .option("-s, --scene <id>", "Only this scene, in a separate file")
    .option("-f, --format <format>", "markdown or json", "markdown")
    .option("--force", "Export without an approved storyboard")
    .action(
      guarded(program, async (o) => {
        const result = await stm.exportPrompts(o.project, {
          format: o.format,
          chapterId: o.chapter,
          sceneId: o.scene,
          force: o.force,
        });
        printOutput(result, program.opts().json, () => {
          if (result.promptCount === 0) {
            ok("Every shot already has an image. No prompts to export.");
            console.log(`  Next: video-studio calibration contact-sheet --project ${o.project}`);
            return;
          }
          ok(`${result.promptCount} prompts in ${Math.max(result.batchPaths.length, 1)} file(s): ${result.exportPath}`);
          console.log(`  Next: generate images in Google Flow, then`);
          console.log(`  video-studio assets import --project ${o.project} --input <dir> --order`);
        });
      })
    );
}
