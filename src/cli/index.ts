import { Command } from "commander";
import { ProjectManager } from "../core/projects/projectManager.js";
import { ResearchManager } from "../core/research/researchManager.js";
import { ScriptManager } from "../core/script/scriptManager.js";
import { StoryboardManager } from "../core/storyboard/storyboardManager.js";
import { AssetManager } from "../core/assets/assetManager.js";
import { CalibrationManager } from "../core/calibration/calibrationManager.js";
import { AudioManager } from "../core/audio/audioManager.js";
import { TimelineCompiler } from "../core/timeline/timelineCompiler.js";
import { RenderService } from "../core/render/renderService.js";
import { JobManager } from "../core/jobs/jobManager.js";

import { registerProjectCommands } from "./commands/project.js";
import { registerResearchCommands } from "./commands/research.js";
import { registerScriptCommands } from "./commands/script.js";
import { registerStoryboardCommands, registerPromptsCommands } from "./commands/storyboard.js";
import { registerAssetCommands, registerCalibrationCommands } from "./commands/assets.js";
import { registerAudioCommands, registerTimelineCommands } from "./commands/audio.js";
import { registerRenderCommands, registerJobCommands } from "./commands/render.js";

export function createCliProgram(): Command {
  const program = new Command();

  program
    .name("video-studio")
    .description("ForgeTube: Local-First AI-Assisted Documentary Video Production System")
    .version("1.0.0")
    .option("--json", "Output machine-readable JSON for scripting", false);

  // Initialize Core Managers
  const pm = new ProjectManager();
  const rm = new ResearchManager(pm);
  const sm = new ScriptManager(pm, rm);
  const stm = new StoryboardManager(pm, sm, rm);
  const am = new AssetManager(pm);
  const cm = new CalibrationManager(pm);
  const audioMgr = new AudioManager(pm);
  const tc = new TimelineCompiler(pm, audioMgr);
  const jm = new JobManager();
  const rs = new RenderService(pm, tc, jm);

  // Register command suites
  registerProjectCommands(program, pm);
  registerResearchCommands(program, rm);
  registerScriptCommands(program, sm);
  registerStoryboardCommands(program, stm);
  registerPromptsCommands(program, stm);
  registerAssetCommands(program, am);
  registerCalibrationCommands(program, cm);
  registerAudioCommands(program, audioMgr);
  registerTimelineCommands(program, tc);
  registerRenderCommands(program, rs);
  registerJobCommands(program, jm);

  return program;
}

export async function runCli(argv = process.argv): Promise<void> {
  const program = createCliProgram();
  await program.parseAsync(argv);
}

// Execute directly if invoked from command line
if (import.meta.main || process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("video-studio.js")) {
  runCli().catch((err) => {
    console.error(`Unexpected CLI failure:`, err);
    process.exit(1);
  });
}

