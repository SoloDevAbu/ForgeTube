import { Command } from "commander";
import { AudioManager } from "../../core/audio/audioManager.js";
import { VoiceManager } from "../../core/audio/voiceManager.js";
import { MusicLibrary } from "../../core/audio/musicLibrary.js";
import { AudioMixer } from "../../core/audio/mixer.js";
import { StoryboardManager } from "../../core/storyboard/storyboardManager.js";
import { TimelineCompiler } from "../../core/timeline/timelineCompiler.js";
import { bad, guarded, ok, printIssues, printOutput } from "../output.js";

export interface AudioCommandDeps {
  audio: AudioManager;
  voice: VoiceManager;
  music: MusicLibrary;
  mixer: AudioMixer;
  storyboard: StoryboardManager;
}

export function registerAudioCommands(program: Command, deps: AudioCommandDeps): void {
  const { audio, voice, music, mixer, storyboard } = deps;
  const cmd = program.command("audio").description("Voice, sound effects, music and the final mix");
  const json = () => Boolean(program.opts().json);

  cmd
    .command("voice")
    .description("Voice the narration. Only changed segments are generated")
    .requiredOption("-p, --project <id>", "Project ID")
    .option("-s, --segment <id>", "Only this segment")
    .option("--regenerate", "Make a new take even if the text is unchanged")
    .option("--force", "Run without an approved script")
    .action(
      guarded(program, async (o) => {
        const result = await voice.generate(o.project, {
          segmentId: o.segment,
          regenerate: o.regenerate,
          force: o.force,
          onProgress: (done, total) => {
            if (!json()) process.stdout.write(`\rVoicing ${done}/${total}`);
          },
        });
        if (!json()) console.log();
        printOutput(result, json(), () => {
          const minutes = (result.totalSeconds / 60).toFixed(1);
          ok(`${result.generated.length} voiced, ${result.reused.length} reused, ${minutes} min in total.`);
          for (const f of result.failed) console.log(`  error: ${f.segmentId}: ${f.message}`);
          console.log(`  Next: video-studio timeline compile --project ${o.project}`);
        });
        if (result.failed.length > 0) process.exitCode = 1;
      })
    );

  cmd
    .command("import")
    .description("Use your own recording for a narration segment")
    .requiredOption("-p, --project <id>", "Project ID")
    .requiredOption("-i, --input <file>", "Audio file")
    .requiredOption("-s, --segment <id>", "Segment ID")
    .action(
      guarded(program, async (o) => {
        const result = await voice.importRecording(o.project, o.input, o.segment);
        printOutput(result, json(), () => ok(`${result.segmentId}: ${result.durationSeconds.toFixed(2)} s.`));
      })
    );

  const sfx = cmd.command("sfx").description("Sound effects");
  sfx
    .command("render")
    .alias("plan")
    .description("Render the storyboard's sfx= suggestions with earshot")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(
      guarded(program, async (o) => {
        const result = await audio.renderPlannedSfx(o.project);
        printOutput(result, json(), () => {
          ok(`${result.planned} placed: ${result.rendered.length} sounds rendered, ${result.reused.length} reused.`);
          for (const f of result.failed) console.log(`  error: ${f.soundId}: ${f.message}`);
        });
        if (result.failed.length > 0) process.exitCode = 1;
      })
    );
  sfx
    .command("add")
    .description("Add your own sound effect")
    .requiredOption("-p, --project <id>", "Project ID")
    .requiredOption("-i, --input <file>", "Audio file")
    .option("-s, --scene <id>", "Scene ID")
    .option("--offset <seconds>", "Seconds after the scene starts", parseFloat, 0)
    .option("--volume <volume>", "Volume from 0 to 1", parseFloat, 0.5)
    .action(
      guarded(program, async (o) => {
        const event = await audio.addSoundEffect(o.project, {
          inputPath: o.input,
          sceneId: o.scene,
          offsetSeconds: o.offset,
          volume: o.volume,
        });
        printOutput(event, json(), () => ok(`Added ${event.eventId}.`));
      })
    );

  const musicCmd = cmd.command("music").description("Background sound from the music folder");
  musicCmd
    .command("scan")
    .description("Read new files in the music folder")
    .action(
      guarded(program, async () => {
        const result = await music.scan();
        printOutput(result, json(), () => {
          ok(`${result.tracks.length} tracks: ${result.scanned.length} new, ${result.skipped} already scanned.`);
          for (const t of result.tracks) {
            console.log(`  ${t.kind.padEnd(8)} ${t.lufs.toFixed(1)} LUFS  ${t.durationSeconds.toFixed(0)} s  ${t.file}`);
          }
        });
      })
    );
  musicCmd
    .command("plan")
    .description("Pick a track for each chapter from its mood")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(
      guarded(program, async (o) => {
        const plan = await music.plan(o.project, await storyboard.getStoryboard(o.project));
        printOutput(plan, json(), () => {
          ok("Music planned.");
          for (const e of plan.entries) console.log(`  ${e.chapterId}  ${e.kind}  ${e.file}  (${e.mood})`);
        });
      })
    );
  musicCmd
    .command("set")
    .description("Choose a chapter's track yourself")
    .requiredOption("-p, --project <id>", "Project ID")
    .requiredOption("-c, --chapter <id>", "Chapter ID")
    .requiredOption("-t, --track <file>", "Track path inside the music folder")
    .action(
      guarded(program, async (o) => {
        const plan = await music.setTrack(o.project, o.chapter, o.track);
        printOutput(plan, json(), () => ok(`${o.chapter} now uses ${o.track}.`));
      })
    );

  cmd
    .command("mix")
    .description("Mix voice, music and effects into editing/mix.wav")
    .requiredOption("-p, --project <id>", "Project ID")
    .option("--force", "Mix again even if nothing changed")
    .action(
      guarded(program, async (o) => {
        const r = await mixer.mix(o.project, { force: o.force });
        printOutput(r, json(), () => {
          const state = r.reused ? "Mix is up to date" : "Mixed";
          const music = r.hasMusic ? "with" : "no";
          ok(`${state}: ${r.lufs.toFixed(1)} LUFS, ${r.truePeakDb.toFixed(1)} dBTP, ${music} music, ${r.soundEffects} effects.`);
          console.log(`  Next: video-studio audio approve --project ${o.project}`);
        });
      })
    );

  cmd
    .command("approve")
    .description("Approve the mix")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(
      guarded(program, async (o) => {
        const record = await mixer.approve(o.project);
        printOutput(record, json(), () => {
          ok("Audio approved.");
          console.log(`  Next: video-studio render --project ${o.project} --mode draft`);
        });
      })
    );

  cmd
    .command("inspect")
    .description("Summarize audio tracks")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(
      guarded(program, async (o) => {
        const mix = await audio.getAudioMix(o.project);
        const plan = await music.getPlan(o.project);
        const record = await mixer.getRecord(o.project);
        const seconds = mix.voiceTracks.reduce((sum, t) => sum + t.durationSeconds, 0);
        printOutput({ mix, plan, record }, json(), () => {
          console.log(`  Voice:   ${mix.voiceTracks.length} segments, ${(seconds / 60).toFixed(1)} min`);
          console.log(`  Effects: ${mix.soundEffects.length}`);
          console.log(`  Music:   ${plan.entries.length} chapter tracks`);
          console.log(`  Mix:     ${record ? `${record.lufs.toFixed(1)} LUFS` : "not made"}`);
        });
      })
    );
}

export function registerTimelineCommands(program: Command, tc: TimelineCompiler): void {
  const cmd = program.command("timeline").description("Frame-accurate timeline");
  const json = () => Boolean(program.opts().json);

  cmd
    .command("compile")
    .description("Build the timeline from real voice durations")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(
      guarded(program, async (o) => {
        const manifest = await tc.compileTimeline(o.project);
        const report = await tc.validateTimeline(o.project);
        printOutput({ report }, json(), () => {
          const minutes = (manifest.totalDurationSeconds / 60).toFixed(1);
          ok(`${manifest.scenes.length} shots, ${manifest.totalDurationFrames} frames, ${minutes} min.`);
          printIssues(report);
        });
      })
    );

  cmd
    .command("validate")
    .description("Check the timeline before rendering")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(
      guarded(program, async (o) => {
        const report = await tc.validateTimeline(o.project);
        printOutput(report, json(), () => {
          if (report.valid) ok("Timeline is valid.");
          else bad(`Timeline has ${report.errors.length} error(s).`);
          printIssues(report);
        });
        if (!report.valid) process.exitCode = 1;
      })
    );

  cmd
    .command("inspect")
    .description("List shots with frame ranges")
    .requiredOption("-p, --project <id>", "Project ID")
    .action(
      guarded(program, async (o) => {
        const manifest = await tc.getRenderManifest(o.project);
        printOutput(manifest, json(), () => {
          for (const s of manifest.scenes) {
            const seconds = (s.durationFrames / manifest.fps).toFixed(2);
            console.log(`  ${s.sceneId}  [${s.startFrame}..${s.endFrame}]  ${seconds} s  ${s.camera.effect}  ${s.transition.type}`);
          }
        });
      })
    );
}
