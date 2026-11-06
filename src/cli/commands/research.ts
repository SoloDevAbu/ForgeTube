import { Command } from "commander";
import { ResearchManager } from "../../core/research/researchManager.js";
import { printOutput, printError } from "../output.js";

export function registerResearchCommands(program: Command, rm: ResearchManager): void {
  const researchCmd = program.command("research").description("Historical research and claim management");

  researchCmd
    .command("run")
    .description("Execute verifiable historical research for the project topic")
    .requiredOption("-p, --project <id>", "Project ID")
    .option("--template", "Force generation of scholarly template without external CLI tool", false)
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        const dossier = await rm.runResearch(options.project, { forceTemplate: options.template });

        printOutput(dossier, globalOpts.json, () => {
          console.log(`\x1b[32m✔\x1b[0m Research completed for project "${options.project}"`);
          console.log(`  Topic: ${dossier.topic}`);
          console.log(`  Sources: ${dossier.sources.length} cited`);
          console.log(`  Claims: ${dossier.claims.length} verified/referenced`);
          console.log(`  Chronology: ${dossier.chronology.length} chronological events`);
          console.log(`  Chapters Planned: ${dossier.chapters.length}`);
          console.log(`  Next step: video-studio research validate --project ${options.project}`);
        });
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });

  researchCmd
    .command("validate")
    .description("Validate research claims against cited source evidence")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        const report = await rm.validateResearch(options.project);

        printOutput(report, globalOpts.json, () => {
          if (report.valid) {
            console.log(`\x1b[32m✔\x1b[0m Research validation passed!`);
            console.log(`  Verified Sources: ${report.totalSources}`);
            console.log(`  Verified Claims:  ${report.totalClaims}`);
            console.log(`  Verified Events:  ${report.totalEvents}`);
            if (report.warnings.length > 0) {
              console.log(`  Warnings:`);
              for (const w of report.warnings) console.log(`    ⚠ ${w}`);
            }
            console.log(`  Next step: video-studio research approve --project ${options.project}`);
          } else {
            console.log(`\x1b[31m✖\x1b[0m Research validation failed with ${report.errors.length} error(s):`);
            for (const e of report.errors) console.log(`  - ${e}`);
          }
        });
        if (!report.valid) process.exitCode = 1;
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });

  researchCmd
    .command("approve")
    .description("Approve research dossier and advance workflow")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        const dossier = await rm.approveResearch(options.project);

        printOutput(dossier, globalOpts.json, () => {
          console.log(`\x1b[32m✔\x1b[0m Research dossier approved for project "${options.project}"`);
          console.log(`  Next step: video-studio script generate --project ${options.project}`);
        });
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });

  researchCmd
    .command("show")
    .description("Display research claims, sources, and chronology")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        const dossier = await rm.getResearch(options.project);

        printOutput(dossier, globalOpts.json, () => {
          console.log(`\n======================================================`);
          console.log(` Historical Research: ${dossier.topic}`);
          console.log(` Scope: ${dossier.scope_statement}`);
          console.log(`======================================================\n`);
          console.log(`SOURCES (${dossier.sources.length}):`);
          for (const s of dossier.sources) {
            console.log(`  [${s.source_id}] ${s.title}`);
            console.log(`    Publisher: ${s.publisher} | Type: ${s.source_type}`);
            console.log(`    URL: ${s.url}`);
          }
          console.log(`\nKEY CLAIMS (${dossier.claims.length}):`);
          for (const c of dossier.claims) {
            console.log(`  [${c.claim_id}] (${c.confidence} confidence, ${c.status})`);
            console.log(`    "${c.claim}"`);
            console.log(`    Evidence Sources: ${c.evidence_source_ids.join(", ")}`);
            if (c.caveat) console.log(`    Caveat: ${c.caveat}`);
          }
          console.log();
        });
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });

  researchCmd
    .command("import")
    .description("Import an externally prepared research dossier JSON file")
    .requiredOption("-p, --project <id>", "Project ID")
    .requiredOption("-i, --input <file>", "Path to JSON research file")
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        const dossier = await rm.importResearch(options.project, options.input);

        printOutput(dossier, globalOpts.json, () => {
          console.log(`\x1b[32m✔\x1b[0m Research imported successfully: ${dossier.claims.length} claims, ${dossier.sources.length} sources`);
        });
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });
}

