import { Command } from "commander";
import { StageGraph } from "../../core/pipeline/stageGraph.js";
import { guarded, printOutput } from "../output.js";

export function registerPipelineCommands(program: Command, stages: StageGraph): void {
  const cmd = program.command("pipeline").description("Stage progress");

  cmd
    .command("status")
    .description("Show which stages are built, approved or out of date")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(
      guarded(program, async (o) => {
        const statuses = await stages.getStatus(o.project);
        printOutput(statuses, program.opts().json, () => {
          for (const s of statuses) {
            const state = s.stale
              ? `stale (changed: ${s.staleBecause.join(", ")})`
              : s.approved
                ? "approved"
                : s.built
                  ? "built"
                  : "not started";
            console.log(`  ${s.stage.padEnd(11)} ${state}`);
          }
        });
      })
    );
}
