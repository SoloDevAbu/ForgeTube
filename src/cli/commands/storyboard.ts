import { Command } from "commander";
import { StoryboardManager } from "../../core/storyboard/storyboardManager.js";
import { printOutput, printError } from "../output.js";

export function registerStoryboardCommands(program: Command, stm: StoryboardManager): void {
  const sbCmd = program.command("storyboard").description("Visual storyboard and scene planning");

  sbCmd
    .command("generate")
    .description("Plan visual scenes, camera motions, and Google Flow prompts from approved script")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        const manifest = await stm.generateStoryboard(options.project);

        printOutput(manifest, globalOpts.json, () => {
          console.log(`\x1b[32m✔\x1b[0m Storyboard generated successfully for "${options.project}"`);
          console.log(`  Scenes Planned: ${manifest.scenes.length}`);
          console.log(`  Google Flow Prompts: ${manifest.prompts.length}`);
          console.log(`  Files created: storyboard/scenes.json and storyboard/image-prompts.json`);
          console.log(`  Next step: video-studio storyboard validate --project ${options.project}`);
        });
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });

  sbCmd
    .command("validate")
    .description("Validate storyboard scenes, transitions, and prompts")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        const report = await stm.validateStoryboard(options.project);

        printOutput(report, globalOpts.json, () => {
          if (report.valid) {
            console.log(`\x1b[32m✔\x1b[0m Storyboard validation passed!`);
            console.log(`  Total Scenes: ${report.sceneCount}`);
            console.log(`  Total Prompts: ${report.promptCount}`);
            console.log(`  Estimated Total Visual Duration: ${report.totalSuggestedDurationSeconds}s`);
            console.log(`  Next step: video-studio storyboard approve --project ${options.project}`);
          } else {
            console.log(`\x1b[31m✖\x1b[0m Storyboard validation failed:`);
            for (const e of report.errors) console.log(`  - ${e}`);
          }
        });
        if (!report.valid) process.exitCode = 1;
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });

  sbCmd
    .command("approve")
    .description("Approve storyboard and proceed to prompt export")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        const manifest = await stm.approveStoryboard(options.project);

        printOutput(manifest, globalOpts.json, () => {
          console.log(`\x1b[32m✔\x1b[0m Storyboard approved for project "${options.project}"`);
          console.log(`  Next step: video-studio prompts export --project ${options.project}`);
        });
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });

  sbCmd
    .command("show")
    .description("Display planned scenes and camera effects")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        const manifest = await stm.getStoryboard(options.project);

        printOutput(manifest, globalOpts.json, () => {
          console.log(`\n======================================================`);
          console.log(` Storyboard Scenes: ${options.project} (${manifest.scenes.length} scenes)`);
          console.log(`======================================================\n`);
          for (const s of manifest.scenes) {
            console.log(`  • [${s.sceneId}] "${s.title}" (~${s.suggestedDurationSeconds}s)`);
            console.log(`    Camera: ${s.camera.effect} (intensity: ${s.camera.intensity}) | Transition: ${s.transition.type}`);
            console.log(`    Visual Purpose: ${s.visualPurpose}`);
            console.log(`    Target Image: ${s.visual.image} (Status: ${s.status.image})`);
          }
          console.log();
        });
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });
}

export function registerPromptsCommands(program: Command, stm: StoryboardManager): void {
  const promptsCmd = program.command("prompts").description("Google Flow image-generation prompts");

  promptsCmd
    .command("export")
    .description("Export Google Flow prompts and trigger the WAITING_FOR_MANUAL_IMAGES checkpoint")
    .requiredOption("-p, --project <id>", "Project ID")
    .option("-f, --format <format>", "Export format: 'markdown' or 'json'", "markdown")
    .option("-c, --chapter <chapterId>", "Filter prompts by chapter ID")
    .option("-s, --scene <sceneId>", "Export prompt for a single scene ID")
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        const res = await stm.exportPrompts(options.project, {
          format: options.format as any,
          chapterId: options.chapter,
          sceneId: options.scene,
        });

        printOutput(res, globalOpts.json, () => {
          console.log(`\n\x1b[33m======================================================\x1b[0m`);
          console.log(`  \x1b[1mMANUAL CHECKPOINT: GOOGLE FLOW IMAGE GENERATION\x1b[0m`);
          console.log(`\x1b[33m======================================================\x1b[0m`);
          console.log(` Exported ${res.promptCount} prompt(s) to:`);
          console.log(`   \x1b[36m${res.exportPath}\x1b[0m\n`);
          console.log(` INSTRUCTIONS:`);
          console.log(` 1. Open Google Flow in your browser.`);
          console.log(` 2. Paste each prompt with aspect ratio set to \x1b[1m16:9\x1b[0m.`);
          console.log(` 3. Download the generated images and name them as indicated (e.g. scene_001.png).`);
          console.log(` 4. When ready, import the images into ForgeTube:`);
          console.log(`    \x1b[32mvideo-studio assets import --project ${options.project} --input ./generated-images/\x1b[0m`);
          console.log(`\x1b[33m======================================================\x1b[0m\n`);
        });
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });
}

