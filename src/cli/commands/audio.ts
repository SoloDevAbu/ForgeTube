import { Command } from "commander";
import { AudioManager } from "../../core/audio/audioManager.js";
import { TimelineCompiler } from "../../core/timeline/timelineCompiler.js";
import { printOutput, printError } from "../output.js";

export function registerAudioCommands(program: Command, audioMgr: AudioManager): void {
  const audioCmd = program.command("audio").description("Audio asset import and mixing");

  audioCmd
    .command("import")
    .description("Import narration voiceover audio files and measure durations with ffprobe")
    .requiredOption("-p, --project <id>", "Project ID")
    .requiredOption("-i, --input <path>", "File path or directory containing voice files")
    .option("-s, --scene <sceneId>", "Scene ID (if importing a single file)")
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        const res = await audioMgr.importVoiceAudio(options.project, {
          inputPath: options.input,
          sceneId: options.scene,
        });

        printOutput(res, globalOpts.json, () => {
          console.log(`\x1b[32m✔\x1b[0m Successfully imported ${res.importedCount} voice track(s):`);
          for (const t of res.importedTracks) {
            console.log(`  • ${t.sceneId}: ${t.file} (measured duration: ${t.durationSeconds.toFixed(2)}s)`);
          }
          console.log(`  Next step: video-studio timeline compile --project ${options.project}`);
        });
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });

  audioCmd
    .command("sfx")
    .description("Import and configure a sound effect")
    .requiredOption("-p, --project <id>", "Project ID")
    .requiredOption("-i, --input <file>", "Path to sound effect audio file")
    .option("-s, --scene <sceneId>", "Scene association")
    .option("-o, --offset <seconds>", "Time offset in seconds", (v) => parseFloat(v), 0)
    .option("-v, --volume <volume>", "Volume level 0.0 to 1.0", (v) => parseFloat(v), 0.5)
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        const sfx = await audioMgr.importSoundEffect(options.project, {
          inputPath: options.input,
          sceneId: options.scene,
          offsetSeconds: options.offset,
          volume: options.volume,
        });

        printOutput(sfx, globalOpts.json, () => {
          console.log(`\x1b[32m✔\x1b[0m Sound effect added: ${sfx.file} (vol: ${sfx.volume}, offset: ${sfx.startSeconds}s)`);
        });
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });

  audioCmd
    .command("music")
    .description("Import and configure background music bed with ducking")
    .requiredOption("-p, --project <id>", "Project ID")
    .requiredOption("-i, --input <file>", "Path to music audio file")
    .option("-v, --volume <volume>", "Base volume level 0.0 to 1.0", (v) => parseFloat(v), 0.2)
    .option("--no-ducking", "Disable automatic ducking under narration")
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        const bed = await audioMgr.importMusicBed(options.project, {
          inputPath: options.input,
          volume: options.volume,
          ducking: options.ducking !== false,
        });

        printOutput(bed, globalOpts.json, () => {
          console.log(`\x1b[32m✔\x1b[0m Background music bed added: ${bed.file} (vol: ${bed.volume}, ducking: ${bed.ducking.enabled})`);
        });
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });

  audioCmd
    .command("inspect")
    .description("Inspect configured audio tracks and mix events")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        const mix = await audioMgr.getAudioMix(options.project);

        printOutput(mix, globalOpts.json, () => {
          console.log(`\n======================================================`);
          console.log(` Audio Mix: ${options.project} (Master Volume: ${mix.masterVolume})`);
          console.log(`======================================================\n`);
          console.log(`VOICE TRACKS (${mix.voiceTracks.length}):`);
          for (const vt of mix.voiceTracks) {
            console.log(`  • ${vt.sceneId}: ${vt.file} (~${vt.durationSeconds.toFixed(2)}s, vol: ${vt.volume})`);
          }
          console.log(`\nSOUND EFFECTS (${mix.soundEffects.length}):`);
          for (const sfx of mix.soundEffects) {
            console.log(`  • ${sfx.eventId}: ${sfx.file} (offset: ${sfx.startSeconds}s, vol: ${sfx.volume})`);
          }
          console.log(`\nMUSIC BEDS (${mix.musicBeds.length}):`);
          for (const mb of mix.musicBeds) {
            console.log(`  • ${mb.trackId}: ${mb.file} (vol: ${mb.volume}, ducking: ${mb.ducking.enabled ? "on" : "off"})`);
          }
          console.log();
        });
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });
}

export function registerTimelineCommands(program: Command, tc: TimelineCompiler): void {
  const timelineCmd = program.command("timeline").description("Deterministic frame-accurate timeline compilation");

  timelineCmd
    .command("compile")
    .description("Compile editorial scenes and audio into a deterministic render manifest")
    .requiredOption("-p, --project <id>", "Project ID")
    .option("-m, --mode <mode>", "Render mode ('draft' or 'final')", "final")
    .option("-b, --breathing-room <seconds>", "Hold padding after narration in seconds", (v) => parseFloat(v), 0.5)
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        const manifest = await tc.compileTimeline(options.project, {
          mode: options.mode as any,
          breathingRoomSeconds: options.breathingRoom,
        });

        printOutput(manifest, globalOpts.json, () => {
          console.log(`\x1b[32m✔\x1b[0m Timeline compiled successfully!`);
          console.log(`  Scenes:               ${manifest.scenes.length}`);
          console.log(`  Total Frames:         ${manifest.totalDurationFrames} frames`);
          console.log(`  Total Duration:       ${manifest.totalDurationSeconds.toFixed(2)}s (~${(manifest.totalDurationSeconds / 60).toFixed(1)} mins)`);
          console.log(`  Output Resolution:    ${manifest.width}x${manifest.height} @ ${manifest.fps} FPS`);
          console.log(`  Saved Manifest:       render/render-manifest.json`);
          console.log(`  Next step: video-studio render --project ${options.project} --mode draft`);
        });
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });

  timelineCmd
    .command("validate")
    .description("Perform strict pre-render validation on compiled timeline and assets")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        const report = await tc.validateTimeline(options.project);

        printOutput(report, globalOpts.json, () => {
          if (report.valid) {
            console.log(`\x1b[32m✔\x1b[0m Timeline validation passed! All assets, frames, and audio tracks are consistent.`);
            console.log(`  Ready to render: video-studio render --project ${options.project} --mode final`);
          } else {
            console.log(`\x1b[31m✖\x1b[0m Timeline validation failed with ${report.errors.length} error(s):`);
            for (const e of report.errors) console.log(`  - ${e}`);
          }
        });
        if (!report.valid) process.exitCode = 1;
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });

  timelineCmd
    .command("inspect")
    .description("Inspect scene frame bounds and transition overlaps")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(async (options) => {
      try {
        const globalOpts = program.opts();
        const manifest = await tc.getRenderManifest(options.project);

        printOutput(manifest, globalOpts.json, () => {
          console.log(`\n======================================================`);
          console.log(` Timeline: ${options.project} (${manifest.totalDurationFrames} frames / ${manifest.totalDurationSeconds}s)`);
          console.log(`======================================================\n`);
          for (const s of manifest.scenes) {
            console.log(`  • [${s.sceneId}] "${s.title}"`);
            console.log(`    Frames: [${s.startFrame} .. ${s.endFrame}] (duration: ${s.durationFrames} frames)`);
            console.log(`    Transition: ${s.transition.type} (overlap: ${s.transition.overlapFrames} frames)`);
            console.log(`    Camera: ${s.camera.effect} (intensity: ${s.camera.intensity})`);
          }
          console.log();
        });
      } catch (err: any) {
        printError(err, program.opts().json);
        process.exitCode = 1;
      }
    });
}

