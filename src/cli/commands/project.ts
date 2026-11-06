import { Command } from "commander";
import { ProjectManager } from "../../core/projects/projectManager.js";
import { printOutput, printError } from "../output.js";

export function registerProjectCommands(program: Command, pm: ProjectManager): void {
  const projectCmd = program.command("project").description("Manage video projects");

  projectCmd
    .command("create")
    .description("Create a new documentary project")
    .requiredOption("-n, --name <name>", "Project name (e.g. 'History of Rome')")
    .requiredOption("-t, --topic <topic>", "Documentary historical topic")
    .option("-m, --target-minutes <minutes>", "Target runtime in minutes", (val) => parseFloat(val), 12)
    .option("-w, --width <width>", "Video frame width", (val) => parseInt(val, 10), 1920)
    .option("-h, --height <height>", "Video frame height", (val) => parseInt(val, 10), 1080)
    .option("-f, --fps <fps>", "Video frame rate", (val) => parseInt(val, 10), 30)
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
        });

        printOutput(project, globalOpts.json, () => {
          console.log(`\x1b[32m✔\x1b[0m Project created successfully: \x1b[1m${project.id}\x1b[0m`);
          console.log(`  Topic: ${project.topic}`);
          console.log(`  Target: ${project.targetMinutes} minutes @ ${project.settings.width}x${project.settings.height} (${project.settings.fps} FPS)`);
          console.log(`  Next step: video-studio research run --project ${project.id}`);
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

