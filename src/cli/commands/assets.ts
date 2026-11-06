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
    .option("--order", "Match files to scenes in file-time order, for Google Flow's default names")
    .option("--first-scene <sceneId>", "First scene when using --order")
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        const res = await am.importImages(options.project, {
          inputPath: options.input,
          sceneId: options.scene,
          order: options.order,
          firstScene: options.firstScene,
        });

        printOutput(res, globalOpts.json, () => {
          console.log(`\x1b[32m✔\x1b[0m Imported ${res.importedCount} image(s).`);
          for (const row of res.rows.filter((r) => r.result !== "imported" || r.note)) {
            console.log(`  ${row.result}: ${row.file} ${row.sceneId ?? ""} ${row.note}`);
          }
          console.log(`  Scenes still missing an image: ${res.missingScenes.length}`);
          console.log(`  Next step: video-studio calibration apply-preset --project ${options.project} --preset gemini-watermark`);
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
            console.log(`  Next step: video-studio calibration apply-preset --project ${options.project} --preset gemini-watermark`);
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
    .option("-f, --fit <mode>", "Fit mode: 'cover', 'contain', or 'manual'", "cover")
    .option("-x, --x <x>", "Horizontal focus, 0 = left, 1 = right", (v) => parseFloat(v))
    .option("-y, --y <y>", "Vertical focus, 0 = top, 1 = bottom", (v) => parseFloat(v))
    .option("-z, --zoom <zoom>", "Zoom, 1 or more", (v) => parseFloat(v))
    .option("--crop <x,y,w,h>", "Exact normalized crop, which must be 16:9")
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        const crop = options.crop?.split(",").map(Number) as number[] | undefined;
        const calib = await cm.setCalibration(options.project, options.scene, {
          fit: crop ? "manual" : (options.fit as any),
          x: crop?.[0],
          y: crop?.[1],
          width: crop?.[2],
          height: crop?.[3],
          posX: options.x,
          posY: options.y,
          scale: options.zoom,
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
    .command("apply-preset")
    .description("Crop every image the same way. Hand-set crops are kept")
    .requiredOption("-p, --project <id>", "Project ID")
    .requiredOption("--preset <name>", "Preset: gemini-watermark")
    .option("-z, --zoom <zoom>", "Zoom, default 1.1", (v) => parseFloat(v))
    .option("-x, --x <x>", "Horizontal focus", (v) => parseFloat(v))
    .option("-y, --y <y>", "Vertical focus", (v) => parseFloat(v))
    .option("--include-manual", "Also replace hand-set crops")
    .action(async (options) => {
      try {
        const res = await cm.applyPreset(options.project, options.preset, {
          zoom: options.zoom,
          x: options.x,
          y: options.y,
          includeManual: options.includeManual,
        });
        printOutput(res, program.opts().json, () => {
          console.log(`\x1b[32m✔\x1b[0m Applied to ${res.applied} scenes, skipped ${res.skipped.length}.`);
          console.log(`  Next step: video-studio calibration contact-sheet --project ${options.project}`);
        });
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });

  calibCmd
    .command("contact-sheet")
    .description("Make overview sheets of every crop for quick review")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(async (options) => {
      try {
        const res = await cm.generateContactSheets(options.project);
        printOutput(res, program.opts().json, () => {
          for (const s of res.sheets) console.log(`  ${s}`);
          if (res.missing.length > 0) console.log(`  Missing images: ${res.missing.length}`);
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
          console.log(`  Next step: video-studio audio voice --project ${options.project}`);
        });
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });
}

