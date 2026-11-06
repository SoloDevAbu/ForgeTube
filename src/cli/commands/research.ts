import { Command } from "commander";
import { ResearchManager } from "../../core/research/researchManager.js";
import { bad, guarded, ok, printIssues, printOutput } from "../output.js";

export function registerResearchCommands(program: Command, rm: ResearchManager): void {
  const cmd = program.command("research").description("Research dossier: written by Claude Code, checked here");
  const json = () => Boolean(program.opts().json);

  cmd
    .command("brief")
    .description("Print the research brief for the author")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(guarded(program, async (o) => console.log(await rm.buildBrief(o.project))));

  cmd
    .command("import")
    .description("Import a research dossier JSON file")
    .requiredOption("-p, --project <id>", "Project ID")
    .requiredOption("-i, --input <file>", "Dossier JSON file")
    .action(
      guarded(program, async (o) => {
        const dossier = await rm.importResearch(o.project, o.input);
        const report = await rm.validateResearch(o.project);
        printOutput({ report }, json(), () => {
          ok(`Imported ${dossier.sources.length} sources and ${dossier.claims.length} claims.`);
          printIssues(report);
        });
        if (!report.valid) process.exitCode = 1;
      })
    );

  cmd
    .command("validate")
    .description("Check claims against their sources")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(
      guarded(program, async (o) => {
        const report = await rm.validateResearch(o.project);
        printOutput(report, json(), () => {
          if (report.valid) ok(`Research is valid: ${report.totalSources} sources, ${report.totalClaims} claims.`);
          else bad("Research failed validation.");
          printIssues(report);
        });
        if (!report.valid) process.exitCode = 1;
      })
    );

  cmd
    .command("approve")
    .description("Approve research")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(
      guarded(program, async (o) => {
        await rm.approveResearch(o.project);
        printOutput({ approved: true }, json(), () => {
          ok("Research approved.");
          console.log(`  Next: video-studio script brief --project ${o.project}`);
        });
      })
    );

  cmd
    .command("show")
    .description("Show claims and sources")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(
      guarded(program, async (o) => {
        const dossier = await rm.getResearch(o.project);
        printOutput(dossier, json(), () => {
          console.log(`Topic: ${dossier.topic}`);
          for (const s of dossier.sources) console.log(`  ${s.source_id}  ${s.title}`);
          for (const c of dossier.claims) console.log(`  ${c.claim_id}  [${c.confidence}] ${c.claim}`);
        });
      })
    );
}
