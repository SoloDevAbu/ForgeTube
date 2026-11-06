import { Command } from "commander";
import { ScriptManager } from "../../core/script/scriptManager.js";
import { printOutput, printError } from "../output.js";

export function registerScriptCommands(program: Command, sm: ScriptManager): void {
  const scriptCmd = program.command("script").description("Documentary narration script workflow");

  scriptCmd
    .command("generate")
    .description("Generate structured narration script and markdown from approved research")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        const manifest = await sm.generateScript(options.project);

        printOutput(manifest, globalOpts.json, () => {
          console.log(`\x1b[32m✔\x1b[0m Script generated successfully for project "${options.project}"`);
          console.log(`  Chapters: ${manifest.chapters.length}`);
          console.log(`  Total Words: ${manifest.totalWordCount}`);
          console.log(`  Estimated Narration Duration: ${manifest.estimatedTotalDurationSeconds}s (~${Math.round(manifest.estimatedTotalDurationSeconds / 60)} minutes)`);
          console.log(`  Target Runtime: ${manifest.targetMinutes} minutes`);
          console.log(`  Files saved: script/script.md and script/narration.json`);
          console.log(`  Next step: video-studio script validate --project ${options.project}`);
        });
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });

  scriptCmd
    .command("validate")
    .description("Validate script integrity and claim references")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        const report = await sm.validateScript(options.project);

        printOutput(report, globalOpts.json, () => {
          if (report.valid) {
            console.log(`\x1b[32m✔\x1b[0m Script validation passed!`);
            console.log(`  Chapters: ${report.chapterCount} | Segments: ${report.segmentCount}`);
            console.log(`  Word Count: ${report.totalWords} words (~${report.estimatedDurationSeconds}s)`);
            if (report.warnings.length > 0) {
              for (const w of report.warnings) console.log(`  ⚠ ${w}`);
            }
            console.log(`  Next step: video-studio script approve --project ${options.project}`);
          } else {
            console.log(`\x1b[31m✖\x1b[0m Script validation failed:`);
            for (const e of report.errors) console.log(`  - ${e}`);
          }
        });
        if (!report.valid) process.exitCode = 1;
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });

  scriptCmd
    .command("approve")
    .description("Approve script and advance to storyboard stage")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        const manifest = await sm.approveScript(options.project);

        printOutput(manifest, globalOpts.json, () => {
          console.log(`\x1b[32m✔\x1b[0m Script approved for project "${options.project}"`);
          console.log(`  Next step: video-studio storyboard generate --project ${options.project}`);
        });
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });

  scriptCmd
    .command("show")
    .description("Display script text and chapter breakdowns")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        const md = await sm.getScriptMarkdown(options.project);
        printOutput(md, globalOpts.json, () => console.log(md));
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });

  scriptCmd
    .command("export")
    .description("Export script markdown file path for external editing")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        const mdPath = sm.getMarkdownPath(options.project);
        printOutput({ path: mdPath }, globalOpts.json, () => {
          console.log(`Script Markdown path: ${mdPath}`);
          console.log(`Edit in your preferred editor, then run: video-studio script validate --project ${options.project}`);
        });
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });
}

