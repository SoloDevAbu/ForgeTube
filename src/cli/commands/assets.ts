import { Command } from "commander";
import { AssetManager } from "../../core/assets/assetManager.js";
import { CalibrationManager } from "../../core/calibration/calibrationManager.js";
import { printOutput, printError } from "../output.js";

export function registerAssetCommands(program: Command, am: AssetManager): void {
  const assetsCmd = program.command("assets").description("Asset ingestion and validation");

  assetsCmd
    .command("import")
    .description("Import image files and map them to scene IDs")
    .requiredOption("-p, --project <id>", "Project ID")
    .requiredOption("-i, --input <path>", "File path or directory to import")
    .option("-s, --scene <sceneId>", "Explicit scene ID to map to")
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        const res = await am.importImages(options.project, {
          inputPath: options.input,
          sceneId: options.scene,
        });

        printOutput(res, globalOpts.json, () => {
          console.log(`\x1b[32m✔\x1b[0m Successfully imported ${res.importedCount} image asset(s):`);
          for (const a of res.importedAssets) {
            console.log(`  • ${a.originalFilename} -> ${a.relativePath} (${a.width}x${a.height}, ${(a.fileSizeBytes / 1024).toFixed(1)} KB)`);
          }
          console.log(`  Next step: video-studio assets validate --project ${options.project}`);
        });
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });

  assetsCmd
    .command("validate")
    .description("Check that every scene has a readable, valid image file")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        const report = await am.validateAssets(options.project);

        printOutput(report, globalOpts.json, () => {
          if (report.valid) {
            console.log(`\x1b[32m✔\x1b[0m Asset validation passed! All ${report.totalScenes} scene images are present and verified.`);
            console.log(`  Next step: video-studio calibration preview --project ${options.project} --scene scene_001`);
          } else {
            console.log(`\x1b[31m✖\x1b[0m Missing image assets for ${report.missingScenes.length} scene(s):`);
            for (const s of report.missingScenes) console.log(`  - Scene: ${s}`);
          }
        });
        if (!report.valid) process.exitCode = 1;
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });

  assetsCmd
    .command("status")
    .description("Display asset ingestion summary")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        const report = await am.validateAssets(options.project);
        printOutput(report, globalOpts.json, () => {
          console.log(`\nAssets Status:`);
          console.log(`  Total Imported: ${report.totalImportedAssets}`);
          console.log(`  Total Scenes:   ${report.totalScenes}`);
          console.log(`  Missing Scenes: ${report.missingScenes.length}`);
          console.log(`  Unused Assets:  ${report.unusedAssets.length}`);
        });
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });
}

export function registerCalibrationCommands(program: Command, cm: CalibrationManager): void {
  const calibCmd = program.command("calibration").description("Image framing and crop calibration");

  calibCmd
    .command("set")
    .description("Set normalized crop coordinates and fit mode for a scene")
    .requiredOption("-p, --project <id>", "Project ID")
    .requiredOption("-s, --scene <sceneId>", "Scene ID (e.g. scene_001)")
    .option("-f, --fit <mode>", "Fit mode: 'cover', 'contain', or 'manual'", "manual")
    .option("-x, --x <x>", "Normalized X coordinate (0.0 to 1.0)", (v) => parseFloat(v))
    .option("-y, --y <y>", "Normalized Y coordinate (0.0 to 1.0)", (v) => parseFloat(v))
    .option("-w, --width <width>", "Normalized crop width (0.01 to 1.0)", (v) => parseFloat(v))
    .option("-h, --height <height>", "Normalized crop height (0.01 to 1.0)", (v) => parseFloat(v))
    .option("--scale <scale>", "Scale multiplier (default 1.0)", (v) => parseFloat(v), 1.0)
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        const calib = await cm.setCalibration(options.project, options.scene, {
          fit: options.fit as any,
          x: options.x,
          y: options.y,
          width: options.width,
          height: options.height,
          scale: options.scale,
        });

        printOutput(calib, globalOpts.json, () => {
          console.log(`\x1b[32m✔\x1b[0m Calibration saved for scene "${options.scene}":`);
          console.log(`  Fit: ${calib.fit}`);
          if (calib.crop) {
            console.log(`  Crop: x=${calib.crop.x}, y=${calib.crop.y}, width=${calib.crop.width}, height=${calib.crop.height}`);
          }
          console.log(`  Run to inspect: video-studio calibration preview --project ${options.project} --scene ${options.scene}`);
        });
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });

  calibCmd
    .command("preview")
    .description("Generate a 16:9 preview still using identical crop math to the Remotion renderer")
    .requiredOption("-p, --project <id>", "Project ID")
    .requiredOption("-s, --scene <sceneId>", "Scene ID")
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        const res = await cm.generateCalibrationPreview(options.project, options.scene);

        printOutput(res, globalOpts.json, () => {
          console.log(`\x1b[32m✔\x1b[0m Preview still generated successfully!`);
          console.log(`  Output Path: \x1b[36m${res.previewPath}\x1b[0m`);
          console.log(`  Pixel Crop:  x=${res.cropParams.pixelCrop.x}, y=${res.cropParams.pixelCrop.y}, ${res.cropParams.pixelCrop.width}x${res.cropParams.pixelCrop.height}`);
          console.log(`  You can open this image in any local image viewer to inspect framing.`);
        });
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });

  calibCmd
    .command("reset")
    .description("Reset a scene's framing to default cover mode")
    .requiredOption("-p, --project <id>", "Project ID")
    .requiredOption("-s, --scene <sceneId>", "Scene ID")
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        const calib = await cm.resetCalibration(options.project, options.scene);
        printOutput(calib, globalOpts.json, () => {
          console.log(`\x1b[32m✔\x1b[0m Reset scene "${options.scene}" calibration to default 'cover' fit.`);
        });
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });

  calibCmd
    .command("validate")
    .description("Validate calibration bounds and framing")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        const res = await cm.validateCalibration(options.project);
        printOutput(res, globalOpts.json, () => {
          if (res.valid) {
            console.log(`\x1b[32m✔\x1b[0m Calibration validation passed! All crops are within valid normalized bounds.`);
            console.log(`  Next step: video-studio calibration approve --project ${options.project}`);
          } else {
            console.log(`\x1b[31m✖\x1b[0m Calibration validation failed:`);
            for (const e of res.errors) console.log(`  - ${e}`);
          }
        });
        if (!res.valid) process.exitCode = 1;
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });

  calibCmd
    .command("approve")
    .description("Approve calibration framing for all scenes")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        await cm.approveCalibration(options.project);
        printOutput({ approved: true }, globalOpts.json, () => {
          console.log(`\x1b[32m✔\x1b[0m Calibration framing approved for project "${options.project}"!`);
          console.log(`  Next step: video-studio audio import --project ${options.project} --input ./voice/`);
        });
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });
}

