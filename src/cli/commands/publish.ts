import { Command } from "commander";
import { PublishManager } from "../../core/publish/publishManager.js";
import { bad, guarded, ok, printIssues, printOutput } from "../output.js";

export function registerPublishCommands(program: Command, pub: PublishManager): void {
  const json = () => Boolean(program.opts().json);

  const thumbnail = program.command("thumbnail").description("YouTube thumbnails: planned by Claude Code, rendered here");

  thumbnail
    .command("brief")
    .description("Print the thumbnail brief and the plan format")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(guarded(program, async (o) => console.log(await pub.buildThumbnailBrief(o.project))));

  thumbnail
    .command("make")
    .description("Render the three thumbnail variants and a review sheet")
    .requiredOption("-p, --project <id>", "Project ID")
    .requiredOption("-i, --input <file>", "Thumbnail plan file")
    .action(
      guarded(program, async (o) => {
        const result = await pub.makeThumbnails(o.project, o.input);
        printOutput(result, json(), () => {
          if (result.valid) ok(`Thumbnails rendered. Look at ${result.sheet}`);
          else bad(result.files.length > 0 ? "Thumbnails rendered with errors." : "The thumbnail plan has errors.");
          printIssues(result);
        });
        if (!result.valid) process.exitCode = 1;
      })
    );

  const cmd = program.command("publish").description("Upload package: titles, description, tags and subtitles");

  cmd
    .command("brief")
    .description("Print the brief for titles, description, hashtags and tags")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(guarded(program, async (o) => console.log(await pub.buildMetadataBrief(o.project))));

  cmd
    .command("import")
    .description("Check and store the titles, description, hashtags and tags")
    .requiredOption("-p, --project <id>", "Project ID")
    .requiredOption("-i, --input <file>", "Metadata file")
    .action(
      guarded(program, async (o) => {
        const { report } = await pub.importMetadata(o.project, o.input);
        printOutput(report, json(), () => {
          if (report.valid) ok("Titles, description, hashtags and tags stored.");
          else bad("Nothing stored: the metadata has errors.");
          printIssues(report);
        });
        if (!report.valid) process.exitCode = 1;
      })
    );

  cmd
    .command("pack")
    .description("Write the upload files, with subtitles and chapters timed from the measured voice")
    .requiredOption("-p, --project <id>", "Project ID")
    .option("--no-sources", "Leave the research sources out of the description")
    .option("--force", "Pack without a final render")
    .action(
      guarded(program, async (o) => {
        const result = await pub.pack(o.project, { force: o.force, sources: o.sources });
        printOutput(result, json(), () => {
          ok(`Upload package ready: ${result.cues} subtitle cues.`);
          console.log(`  Video:  ${result.video}`);
          console.log(`  Folder: ${result.folder}`);
          printIssues({ errors: [], warnings: result.warnings });
        });
      })
    );
}
