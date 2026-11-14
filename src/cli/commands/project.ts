import { Command } from "commander";
import { ProjectManager } from "../../core/projects/projectManager.js";
import { VariantManager } from "../../core/projects/variantManager.js";
import { LANGUAGE_FOLDERS } from "../../core/language/languages.js";
import { guarded, ok, printOutput, printError } from "../output.js";

export function registerProjectCommands(program: Command, pm: ProjectManager): void {
  const projectCmd = program.command("project").description("Manage video projects");
  const variants = new VariantManager(pm);
  const languageCodes = LANGUAGE_FOLDERS.join(", ");

  projectCmd
    .command("add-version")
    .alias("localize")
    .description("Add another language version to a topic. It shares the research and can reuse the images")
    .requiredOption("-p, --project <topic>", "The topic, for example ancient_rome")
    .requiredOption("-l, --lang <language>", `Language of the new version (${languageCodes})`)
    .action(
      guarded(program, async (o) => {
        const result = await variants.addVersion(o.project, o.lang);
        printOutput(result, program.opts().json, () => {
          const { project } = result;
          if (!result.created) {
            ok(`${project.id} already exists.`);
            return;
          }
          ok(`Created ${project.id}, starting from the settings of ${result.from}.`);
          console.log(`  Voice: ${project.settings.voice.voice} at ${project.settings.voice.rate}`);
          console.log(`  Research is shared by the topic${project.checkpoints.researchApproved ? " and already approved" : ""}.`);
          if (result.musicPlanCopied) console.log(`  Music plan copied from ${result.from}.`);
          const next = project.checkpoints.researchApproved ? "script brief" : "research brief";
          console.log(`  Next: video-studio ${next} --project ${project.id}`);
        });
      })
    );

  projectCmd
    .command("migrate")
    .description("Move projects from the old layout into projects/<topic>/<language>")
    .action(
      guarded(program, async () => {
        const rows = await variants.migrate();
        printOutput(rows, program.opts().json, () => {
          if (rows.length === 0) ok("Nothing to migrate.");
          for (const r of rows) console.log(`  ${r.from} -> ${r.to}${r.note ? `  (${r.note})` : ""}`);
        });
      })
    );

  projectCmd
    .command("set-voice")
    .description("Change the narration voice, speed or pitch")
    .requiredOption("-p, --project <id>", "Project ID")
    .option("-v, --voice <name>", "Edge TTS voice, for example hi-IN-SwaraNeural")
    .option("-r, --rate <rate>", "Speed, for example -8% or +5%")
    .option("--pitch <pitch>", "Pitch, for example -2Hz")
    .action(
      guarded(program, async (o) => {
        const project = await pm.loadProject(o.project);
        const { voice } = project.settings;
        if (o.voice) voice.voice = o.voice;
        if (o.rate) voice.rate = /^[+-]/.test(o.rate) ? o.rate : `+${o.rate}`;
        if (o.pitch) voice.pitch = /^[+-]/.test(o.pitch) ? o.pitch : `+${o.pitch}`;
        await pm.saveProject(project);
        printOutput(voice, program.opts().json, () => {
          ok(`${o.project} voice: ${voice.voice}, rate ${voice.rate}, pitch ${voice.pitch}.`);
          console.log(`  Next: video-studio audio voice --project ${o.project}`);
        });
      })
    );

  projectCmd
    .command("create")
    .description("Create a new documentary project")
    .requiredOption("-n, --name <name>", "Project name (e.g. 'History of Rome')")
    .requiredOption("-t, --topic <topic>", "Documentary historical topic")
    .option("-m, --target-minutes <minutes>", "Target runtime in minutes", (val) => parseFloat(val), 12)
    .option("-w, --width <width>", "Video frame width", (val) => parseInt(val, 10), 1920)
    .option("-h, --height <height>", "Video frame height", (val) => parseInt(val, 10), 1080)
    .option("-f, --fps <fps>", "Video frame rate", (val) => parseInt(val, 10), 30)
    .option("-l, --lang <language>", `Narration language (${languageCodes})`, "english")
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        const project = await pm.createProject({
          name: options.name,
          topic: options.topic,
          targetMinutes: options.targetMinutes,
          width: options.width,
          height: options.height,
          fps: options.fps,
          language: options.lang,
        });

        printOutput(project, globalOpts.json, () => {
          console.log(`\x1b[32m✔\x1b[0m Project created successfully: \x1b[1m${project.id}\x1b[0m`);
          console.log(`  Topic: ${project.topic}`);
          console.log(`  Target: ${project.targetMinutes} minutes @ ${project.settings.width}x${project.settings.height} (${project.settings.fps} FPS)`);
          console.log(`  Next step: video-studio research brief --project ${project.id}`);
        });
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });

  projectCmd
    .command("list")
    .description("List all local documentary projects")
    .action(async () => {
      try {
        const globalOpts = program.opts();
        const projects = await pm.listProjects();

        printOutput(projects, globalOpts.json, () => {
          if (projects.length === 0) {
            console.log("No projects found in ./projects. Run 'video-studio project create' to start.");
            return;
          }
          console.log(`\nFound ${projects.length} project(s):\n`);
          for (const p of projects) {
            console.log(`  • \x1b[1m${p.id}\x1b[0m (${p.name})`);
            console.log(`    Status: [${p.status}] | Target: ${p.targetMinutes}m | Updated: ${p.updatedAt.slice(0, 10)}`);
          }
          console.log();
        });
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });

  projectCmd
    .command("show")
    .description("Show details of a specific project")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        const project = await pm.loadProject(options.project);

        printOutput(project, globalOpts.json, () => {
          console.log(`\n\x1b[1m${project.name}\x1b[0m [${project.id}]`);
          console.log(`Topic: ${project.topic}`);
          console.log(`Status: ${project.status}`);
          console.log(`Target: ${project.targetMinutes} minutes @ ${project.settings.fps} fps`);
          console.log(`Resolution: ${project.settings.width}x${project.settings.height}`);
          console.log(`Checkpoints:`);
          for (const [k, v] of Object.entries(project.checkpoints)) {
            console.log(`  ${v ? "✔" : "○"} ${k}`);
          }
          console.log();
        });
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });

  projectCmd
    .command("status")
    .description("Display project status, asset counts, and recommended next command")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        const status = await pm.getProjectStatus(options.project);

        printOutput(status, globalOpts.json, () => {
          console.log(`\n======================================================`);
          console.log(` Project Status: \x1b[1m${status.name}\x1b[0m (${status.projectId})`);
          console.log(`======================================================`);
          console.log(` Topic:            ${status.topic}`);
          console.log(` Target Runtime:   ${status.targetMinutes} minutes (${status.resolution})`);
          console.log(` Workflow State:   \x1b[36m${status.status}\x1b[0m`);
          console.log(` Chapters:         ${status.chapterCount}`);
          console.log(` Scenes Planned:   ${status.sceneCount}`);
          console.log(` Images Imported:  ${status.imagesImported} / ${status.sceneCount} (${status.imagesMissing} missing)`);
          console.log(` Calibrated:       ${status.scenesCalibrated} (${status.scenesUnreviewed} unreviewed)`);
          console.log(` Voice Audio:      ${status.audioReady}`);
          console.log(` Last Output:      ${status.lastRenderOutput || "None"}`);
          console.log(`------------------------------------------------------`);
          console.log(` Next Recommended Command:`);
          console.log(`   \x1b[32m${status.nextCommand}\x1b[0m`);
          console.log(`======================================================\n`);
        });
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });

  projectCmd
    .command("export")
    .description("Export complete project folder to a target destination")
    .requiredOption("-p, --project <id>", "Project ID")
    .requiredOption("-d, --dest <destination>", "Destination directory")
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        const exportedPath = await pm.exportProject(options.project, options.dest);
        printOutput({ exportedPath }, globalOpts.json, () => {
          console.log(`\x1b[32m✔\x1b[0m Project exported to: ${exportedPath}`);
        });
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });

  projectCmd
    .command("backup")
    .description("Create a timestamped local backup of the project")
    .requiredOption("-p, --project <id>", "Project ID")
    .option("-d, --dest <destination>", "Destination directory")
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        const backupPath = await pm.backupProject(options.project, options.dest);
        printOutput({ backupPath }, globalOpts.json, () => {
          console.log(`\x1b[32m✔\x1b[0m Project backed up to: ${backupPath}`);
        });
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });
}

