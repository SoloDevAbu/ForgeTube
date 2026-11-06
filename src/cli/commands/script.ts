import { Command } from "commander";
import fs from "node:fs/promises";
import { ScriptManager } from "../../core/script/scriptManager.js";
import { bad, guarded, ok, printIssues, printOutput } from "../output.js";

export function registerScriptCommands(program: Command, sm: ScriptManager): void {
  const cmd = program.command("script").description("Narration script: written by Claude Code, checked here");
  const json = () => Boolean(program.opts().json);

  cmd
    .command("brief")
    .description("Print the writing brief, for the whole film or one chapter")
    .requiredOption("-p, --project <id>", "Project ID")
    .option("-c, --chapter <id>", "Chapter ID")
    .action(guarded(program, async (o) => console.log(await sm.buildBrief(o.project, o.chapter))));

  cmd
    .command("import")
    .description("Import the script Markdown")
    .requiredOption("-p, --project <id>", "Project ID")
    .requiredOption("-i, --input <file>", "Script Markdown file")
    .option("--force", "Import without approved research")
    .action(
      guarded(program, async (o) => {
        const { manifest, validation } = await sm.importScript(o.project, o.input, { force: o.force });
        printOutput(validation, json(), () => {
          if (validation.valid) ok(`Script imported: ${manifest.totalWordCount} words, ${validation.segmentCount} segments.`);
          else bad("Script imported with errors.");
          printIssues(validation);
        });
        if (!validation.valid) process.exitCode = 1;
      })
    );

  cmd
    .command("set-segment")
    .description("Change one narration segment without touching the rest")
    .requiredOption("-p, --project <id>", "Project ID")
    .requiredOption("-s, --segment <id>", "Segment ID")
    .option("-t, --text <text>", "New narration text")
    .option("--claims <ids>", "Comma-separated claim IDs")
    .action(
      guarded(program, async (o) => {
        const segment = await sm.setSegment(o.project, o.segment, {
          text: o.text,
          claimIds: o.claims?.split(",").map((c: string) => c.trim()),
        });
        printOutput(segment, json(), () => ok(`Updated ${segment.segment_id}.`));
      })
    );

  cmd
    .command("validate")
    .description("Check word count and claim support")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(
      guarded(program, async (o) => {
        const report = await sm.validateScript(o.project);
        printOutput(report, json(), () => {
          if (report.valid) {
            ok(`Script is valid: ${report.totalWords} words, about ${Math.round(report.estimatedDurationSeconds / 60)} min.`);
          } else {
            bad("Script failed validation.");
          }
          printIssues(report);
        });
        if (!report.valid) process.exitCode = 1;
      })
    );

  cmd
    .command("approve")
    .description("Approve the script")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(
      guarded(program, async (o) => {
        await sm.approveScript(o.project);
        printOutput({ approved: true }, json(), () => {
          ok("Script approved.");
          console.log(`  Next: video-studio storyboard brief --project ${o.project}`);
        });
      })
    );

  cmd
    .command("show")
    .description("Print the script, or one segment with its claims")
    .requiredOption("-p, --project <id>", "Project ID")
    .option("-s, --segment <id>", "Segment ID")
    .action(
      guarded(program, async (o) => {
        if (o.segment) {
          console.log(JSON.stringify(await sm.inspectSegment(o.project, o.segment), null, 2));
          return;
        }
        console.log(await sm.getScriptMarkdown(o.project));
      })
    );

  cmd
    .command("export")
    .description("Write the script Markdown to a file")
    .requiredOption("-p, --project <id>", "Project ID")
    .requiredOption("-o, --output <file>", "Output file")
    .action(
      guarded(program, async (o) => {
        await fs.writeFile(o.output, await sm.getScriptMarkdown(o.project), "utf-8");
        printOutput({ output: o.output }, json(), () => ok(`Wrote ${o.output}.`));
      })
    );
}
