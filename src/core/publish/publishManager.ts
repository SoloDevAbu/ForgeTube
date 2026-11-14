import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { ProjectManager } from "../projects/projectManager.js";
import { AssetManager } from "../assets/assetManager.js";
import { TimelineCompiler } from "../timeline/timelineCompiler.js";
import { StageGraph, fingerprint } from "../pipeline/stageGraph.js";
import { runRenderWorker } from "../render/renderWorker.js";
import { computeCropParameters } from "../calibration/cropMath.js";
import { computeFileChecksum } from "../assets/mediaInspector.js";
import { readVoiceTake } from "../audio/tts/voiceTake.js";
import { spokenText, splitWords } from "../script/scriptFormat.js";
import { getLanguage } from "../language/languages.js";
import { ScriptManifestSchema, type ScriptManifest } from "../schemas/script.js";
import { ResearchDossierSchema, type ResearchDossier } from "../schemas/research.js";
import {
  PublishManifestSchema,
  type PublishManifest,
  type PublishMetadata,
  type ThumbnailRenderProps,
  type ThumbnailVariant,
} from "../schemas/publish.js";
import type { RenderManifest } from "../schemas/renderManifest.js";
import type { SceneRecord } from "../schemas/storyboard.js";
import type { FitMode } from "../../shared/types.js";
import { atomicWriteFile, atomicWriteJson, readJsonFile } from "../../shared/atomic.js";
import { AssetError, ValidationError } from "../../shared/errors.js";
import { projectFileName } from "../../shared/paths.js";
import { buildCues, chapterTime, formatSrt, timeSegmentWords, type TimedWord } from "./captions.js";
import {
  DESCRIPTION_MAX,
  DESCRIPTION_SHOWN,
  HASHTAGS_MAX,
  TAGS_MAX,
  TITLE_MAX,
  TITLE_SHOWN,
  assembleDescription,
  parseMetadata,
  validateMetadata,
  type MetadataReport,
} from "./metadataFormat.js";
import {
  ACCENTS,
  FOCUS_ZOOM,
  THUMBNAIL_HEIGHT,
  THUMBNAIL_MAX_BYTES,
  THUMBNAIL_WIDTH,
  layoutText,
  parseThumbnailPlan,
  placeSubject,
  textStyleFor,
  textWords,
  type ParsedVariant,
} from "./thumbnailFormat.js";

/** Headings the CLI adds to the description, in the film's language. */
const LABELS: Record<string, { chapters: string; sources: string }> = {
  en: { chapters: "Chapters", sources: "Sources" },
  hi: { chapters: "अध्याय", sources: "स्रोत" },
};

/** YouTube turns timestamps into chapters only with three or more, each at least 10 s long. */
const MIN_CHAPTERS = 3;
const MIN_CHAPTER_SECONDS = 10;

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { shell: false, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk.toString("utf-8")));
    child.on("close", (code) => (code === 0 ? resolve() : reject(new AssetError(`FFmpeg failed: ${stderr.slice(-800)}`))));
    child.on("error", (err) => reject(new AssetError(`Failed to spawn ffmpeg: ${err.message}`)));
  });
}

export interface ThumbnailResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  files: string[];
  sheet: string | null;
}

export interface PackResult {
  folder: string;
  video: string;
  files: string[];
  cues: number;
  durationSeconds: number;
  warnings: string[];
}

export class PublishManager {
  private pm: ProjectManager;
  private tc: TimelineCompiler;
  private assets: AssetManager;
  private stages: StageGraph;

  constructor(pm?: ProjectManager, tc?: TimelineCompiler) {
    this.pm = pm ?? new ProjectManager();
    this.tc = tc ?? new TimelineCompiler(this.pm);
    this.assets = new AssetManager(this.pm);
    this.stages = new StageGraph(this.pm);
  }

  getPublishDir(projectId: string): string {
    return path.join(this.pm.getProjectRoot(projectId), "publish");
  }

  private manifestPath(projectId: string): string {
    return path.join(this.getPublishDir(projectId), "publish.json");
  }

  async getManifest(projectId: string): Promise<PublishManifest> {
    const p = this.manifestPath(projectId);
    if (!existsSync(p)) return PublishManifestSchema.parse({ updatedAt: new Date().toISOString() });
    return PublishManifestSchema.parse(await readJsonFile(p));
  }

  private async saveManifest(projectId: string, manifest: PublishManifest): Promise<void> {
    manifest.updatedAt = new Date().toISOString();
    await atomicWriteJson(this.manifestPath(projectId), manifest);
  }

  private thumbnailPath(projectId: string, variantId: string): string {
    return path.join(this.getPublishDir(projectId), "thumbnails", `thumbnail_${variantId.toLowerCase()}.jpg`);
  }

  private finalVideoPath(projectId: string): string {
    const name = projectFileName(this.pm.resolveId(projectId));
    return path.join(this.pm.getProjectRoot(projectId), "render", "final", `${name}.mp4`);
  }

  private async loadScript(projectId: string): Promise<ScriptManifest> {
    const p = path.join(this.pm.getProjectRoot(projectId), "script", "narration.json");
    if (!existsSync(p)) throw new ValidationError("This film has no script yet.");
    return ScriptManifestSchema.parse(await readJsonFile(p));
  }

  private async loadResearch(projectId: string): Promise<ResearchDossier | null> {
    const p = path.join(this.pm.getTopicRoot(projectId), "research", "research.json");
    return existsSync(p) ? ResearchDossierSchema.parse(await readJsonFile(p)) : null;
  }

  /** Chapter titles from the script, at the times the render gives them. */
  private chapterList(script: ScriptManifest, render: RenderManifest): { seconds: number; title: string }[] {
    const list = render.chapters.flatMap((c) => {
      const title = script.chapters.find((s) => s.chapter_id === c.chapterId)?.title;
      return title ? [{ seconds: c.startFrame / render.fps, title }] : [];
    });
    // YouTube needs the first chapter at 0:00.
    if (list[0]) list[0].seconds = 0;
    return list;
  }

  async buildMetadataBrief(projectId: string): Promise<string> {
    const project = await this.pm.loadProject(projectId);
    const language = getLanguage(project.language);
    const script = await this.loadScript(projectId);
    const render = await this.tc.getRenderManifest(projectId);
    const research = await this.loadResearch(projectId);
    const { thumbnails } = await this.getManifest(projectId);
    const opening = splitWords(script.chapters[0]?.segments[0]?.text ?? "").slice(0, 60).join(" ");

    const chapters = this.chapterList(script, render).map((c, i) => {
      const id = script.chapters[i]?.chapter_id;
      const summary = research?.chapters.find((r) => r.chapter_id === id)?.summary;
      return `  ${chapterTime(c.seconds)} ${c.title}${summary ? ` — ${summary}` : ""}`;
    });

    return [
      `# Publish brief: ${project.name} (${language.name})`,
      `Topic: ${project.topic}`,
      `Length: ${chapterTime(render.totalDurationSeconds)}, measured`,
      ...(research ? [`Scope: ${research.scope_statement}`] : []),
      "",
      "Chapters. The CLI adds these to the description with their times:",
      ...chapters,
      "",
      `The film opens: "${opening}…"`,
      ...(thumbnails.length > 0
        ? ["", "Thumbnail texts. A title must not repeat one:", ...thumbnails.map((t) => `  ${t.id}: ${textWords(t.text).join(" ") || "(no text)"}`)]
        : []),
      "",
      `Write everything in ${language.name}. Tags may mix in English search terms. Format:`,
      "",
      "# titles",
      "First title",
      "Second title",
      "Third title",
      "# description",
      "Two or three short paragraphs. The first line is what search shows.",
      "# hashtags",
      "#One #Two #Three",
      "# tags",
      "first tag, second tag, third tag",
      "",
      `Limits: 3 titles, each at most ${TITLE_MAX} characters and best under ${TITLE_SHOWN}. First description line`,
      `under ${DESCRIPTION_SHOWN}. Whole description ${DESCRIPTION_MAX}. Hashtags 3 to 5, never over ${HASHTAGS_MAX}. Tags ${TAGS_MAX} characters in all.`,
      "Leave out timestamps, chapter lists, sources and hashtags in the description: the CLI adds them.",
      "",
      `Then: video-studio publish import -p ${this.pm.resolveId(projectId)} -i <file>`,
    ].join("\n");
  }

  async buildThumbnailBrief(projectId: string): Promise<string> {
    const project = await this.pm.loadProject(projectId);
    const language = getLanguage(project.language);
    const root = this.pm.getProjectRoot(projectId);
    const script = await this.loadScript(projectId);
    const contactDir = path.join(root, "render", "preview", "contact");
    const sheets = existsSync(contactDir)
      ? (await fs.readdir(contactDir)).filter((f) => /^sheet_\d+\.jpg$/.test(f)).sort()
      : [];
    const id = this.pm.resolveId(projectId);

    return [
      `# Thumbnail brief: ${project.name} (${language.name})`,
      `Topic: ${project.topic}`,
      `Chapters: ${script.chapters.map((c) => c.title).join(" · ")}`,
      "",
      sheets.length > 0
        ? `Images: every shot is on the contact sheets, labelled with its scene ID:\n${sheets.map((s) => `  ${path.join(contactDir, s)}`).join("\n")}`
        : `Images: run "video-studio calibration contact-sheet -p ${id}" and look at the sheets. Each tile shows its scene ID.`,
      "",
      "Write three variants, one per line:",
      "",
      "A | img=scene_012 | THE *LAST* EMPEROR | layout=left | accent=yellow | focus=0.7,0.4",
      "B | img=scene_040 | WHY IT *FELL* | layout=right | accent=red | focus=0.3,0.5 | zoom=1.4",
      "C | file=<path to a new image> | - | layout=center",
      "",
      "Cells: the variant, the image, the text, then options.",
      "- img=<scene> uses that shot with its crop. file=<path> brings in a new image; it is copied, never moved.",
      `- Text is ${language.name}, 2 to 4 words, 5 at most. "*word*" takes the accent colour. "/" forces a line break. "-" means no text.`,
      "- layout: left, right, bottom or center. It is where the text goes. The subject is moved to the other side.",
      "- focus=x,y: where the subject is in the image, 0 to 1 from the top left. zoom=1 to 3 moves closer.",
      `- accent: ${Object.keys(ACCENTS).join(", ")}, or a hex colour. look: dark, warm, cold or none.`,
      "",
      `Then: video-studio thumbnail make -p ${id} -i <file>`,
    ].join("\n");
  }

  /** Copies an outside image into the project. An existing file is never replaced. */
  private async bringInImage(root: string, file: string): Promise<string> {
    const source = path.resolve(file);
    if (!existsSync(source)) throw new ValidationError(`Image not found: ${file}`);
    const dir = path.join(root, "assets", "thumbnails");
    await fs.mkdir(dir, { recursive: true });
    const ext = path.extname(source).toLowerCase();
    const base = path.basename(source, path.extname(source)).replace(/[^a-zA-Z0-9_-]/g, "_");
    const checksum = await computeFileChecksum(source);

    for (let version = 1; ; version++) {
      const name = version === 1 ? `${base}${ext}` : `${base}_v${version}${ext}`;
      const target = path.join(dir, name);
      if (!existsSync(target)) {
        await fs.copyFile(source, target);
        return `assets/thumbnails/${name}`;
      }
      if ((await computeFileChecksum(target)) === checksum) return `assets/thumbnails/${name}`;
    }
  }

  private async resolveVariant(
    projectId: string,
    parsed: ParsedVariant,
    scenes: SceneRecord[],
    errors: string[]
  ): Promise<{ record: ThumbnailVariant; crop: ThumbnailRenderProps["variants"][number]["crop"] } | null> {
    const root = this.pm.getProjectRoot(projectId);
    let image: string;
    let crop: ThumbnailRenderProps["variants"][number]["crop"] = null;

    if (parsed.sceneId) {
      const scene = scenes.find((s) => s.sceneId === parsed.sceneId);
      if (!scene) {
        errors.push(`Variant ${parsed.id}: scene "${parsed.sceneId}" is not in the storyboard.`);
        return null;
      }
      image = scene.visual.image;
      if (!existsSync(path.join(root, image))) {
        errors.push(`Variant ${parsed.id}: scene "${parsed.sceneId}" has no image yet.`);
        return null;
      }
      const fit = (scene.visual.fit as FitMode) ?? "cover";
      if (fit !== "contain") {
        const { width, height } = await this.assets.getImageSize(projectId, image);
        crop = computeCropParameters({
          sourceWidth: width,
          sourceHeight: height,
          targetWidth: THUMBNAIL_WIDTH,
          targetHeight: THUMBNAIL_HEIGHT,
          fit,
          manualCrop: scene.visual.crop,
          position: scene.visual.position,
          zoom: scene.visual.zoom,
        }).normalizedCrop;
      }
    } else {
      try {
        image = await this.bringInImage(root, parsed.file!);
      } catch (err: any) {
        errors.push(`Variant ${parsed.id}: ${err.message}`);
        return null;
      }
    }

    if (!image.startsWith("assets/")) {
      errors.push(`Variant ${parsed.id}: the image is outside the project's assets folder.`);
      return null;
    }
    return {
      crop,
      record: {
        id: parsed.id,
        sceneId: parsed.sceneId,
        image,
        text: parsed.text,
        layout: parsed.layout,
        accent: parsed.accent,
        look: parsed.look,
        focus: parsed.focus,
        zoom: parsed.zoom ?? (parsed.focus ? FOCUS_ZOOM : 1),
      },
    };
  }

  /** Three thumbnails at full size, and under them the size a phone shows in a list. */
  private async buildReviewSheet(files: string[], sheet: string): Promise<void> {
    const filters = [
      ...files.map((_, i) => `[${i}:v]split[l${i}][s${i}]`),
      ...files.map((_, i) => `[l${i}]scale=640:360,setsar=1[big${i}]`),
      ...files.map((_, i) => `[s${i}]scale=168:94,pad=640:134:236:20:color=0x0f0f0f,setsar=1[small${i}]`),
      `${files.map((_, i) => `[big${i}]`).join("")}hstack=inputs=${files.length}[top]`,
      `${files.map((_, i) => `[small${i}]`).join("")}hstack=inputs=${files.length}[low]`,
      "[top][low]vstack=inputs=2[out]",
    ];
    await runFfmpeg([
      "-y",
      ...files.flatMap((f) => ["-i", f]),
      "-filter_complex",
      filters.join(";"),
      "-map",
      "[out]",
      "-frames:v",
      "1",
      "-update",
      "1",
      "-q:v",
      "3",
      sheet,
    ]);
  }

  /** Reads the plan, renders the three thumbnails and a review sheet. Nothing is written when the plan has errors. */
  async makeThumbnails(projectId: string, inputFile: string): Promise<ThumbnailResult> {
    const root = this.pm.getProjectRoot(projectId);
    if (!existsSync(inputFile)) throw new ValidationError(`File not found: ${inputFile}`);
    const { variants, errors, warnings } = parseThumbnailPlan(await fs.readFile(inputFile, "utf-8"));

    const scenesPath = path.join(root, "storyboard", "scenes.json");
    const scenes = existsSync(scenesPath) ? (await readJsonFile<{ scenes: SceneRecord[] }>(scenesPath)).scenes : [];
    const resolved = errors.length === 0
      ? await Promise.all(variants.map((v) => this.resolveVariant(projectId, v, scenes, errors)))
      : [];
    if (errors.length > 0) return { valid: false, errors, warnings, files: [], sheet: null };

    const publicName = projectFileName(this.pm.resolveId(projectId));
    const props: ThumbnailRenderProps = {
      width: THUMBNAIL_WIDTH,
      height: THUMBNAIL_HEIGHT,
      variants: resolved.map((r) => {
        const { record, crop } = r!;
        const style = textStyleFor(record.text);
        const text = layoutText(record.text, record.layout, style);
        return {
          src: `${publicName}/${record.image}`,
          crop,
          ...placeSubject(record.layout, record.focus, record.zoom),
          look: record.look,
          layout: record.layout,
          lines: text.lines,
          fontSize: text.fontSize,
          lineHeight: style.lineHeight,
          fontFamily: style.fontFamily,
          fontWeight: style.fontWeight,
          uppercase: style.uppercase,
          accent: record.accent,
        };
      }),
    };

    const files = resolved.map((r) => this.thumbnailPath(projectId, r!.record.id));
    await runRenderWorker({
      renderer: "thumbnail",
      projectId: publicName,
      assetsDir: path.join(root, "assets"),
      inputProps: props,
      concurrency: 1,
      workDir: path.join(this.getPublishDir(projectId), ".work"),
      tasks: files.map((output, frame) => ({
        id: `thumbnail_${frame}`,
        type: "still",
        output,
        frame,
        imageFormat: "jpeg",
        jpegQuality: 92,
      })),
    });

    for (const file of files) {
      const size = statSync(file).size;
      if (size > THUMBNAIL_MAX_BYTES) {
        errors.push(`${path.basename(file)} is ${(size / 1048576).toFixed(1)} MB. YouTube takes 2 MB at most.`);
      }
    }

    const sheet = path.join(this.getPublishDir(projectId), "thumbnails", "review.jpg");
    await this.buildReviewSheet(files, sheet);

    const manifest = await this.getManifest(projectId);
    manifest.thumbnails = resolved.map((r) => r!.record);
    await this.saveManifest(projectId, manifest);
    return { valid: errors.length === 0, errors, warnings, files, sheet };
  }

  /** A thumbnail that says what the title says wastes one of them. */
  private repeatWarnings(metadata: PublishMetadata, thumbnails: ThumbnailVariant[]): string[] {
    const flat = (s: string) => textWords(s).join(" ").toLowerCase();
    return thumbnails.flatMap((t) => {
      const text = flat(t.text);
      const title = text ? metadata.titles.find((title) => flat(title).includes(text)) : undefined;
      return title ? [`Thumbnail ${t.id} repeats the title "${title}". Let one name the subject and the other add the hook.`] : [];
    });
  }

  /** Checks the written metadata and stores it. Nothing is stored when it has errors. */
  async importMetadata(projectId: string, inputFile: string): Promise<{ metadata: PublishMetadata; report: MetadataReport }> {
    if (!existsSync(inputFile)) throw new ValidationError(`File not found: ${inputFile}`);
    const metadata = parseMetadata(await fs.readFile(inputFile, "utf-8"));
    const report = validateMetadata(metadata);
    const manifest = await this.getManifest(projectId);
    report.warnings.push(...this.repeatWarnings(metadata, manifest.thumbnails));
    if (report.valid) {
      manifest.metadata = metadata;
      await this.saveManifest(projectId, manifest);
    }
    return { metadata, report };
  }

  /** Every narration word at the time it is heard in the film. */
  private async timedWords(projectId: string, script: ScriptManifest, render: RenderManifest): Promise<TimedWord[]> {
    const root = this.pm.getProjectRoot(projectId);
    const segments = new Map(script.chapters.flatMap((c) => c.segments).map((s) => [s.segment_id, s]));
    const words: TimedWord[] = [];
    for (const track of [...render.audio.voiceTracks].sort((a, b) => a.startFrame - b.startFrame)) {
      const segment = segments.get(track.segmentId);
      if (!segment) continue;
      const take = await readVoiceTake(root, track.file);
      words.push(
        ...timeSegmentWords(segment.text, take?.words ?? null, track.startFrame / render.fps, track.durationFrames / render.fps)
      );
    }
    return words;
  }

  /**
   * Writes everything an upload needs into publish/: titles, description,
   * tags, subtitles and transcript, beside the three thumbnails.
   */
  async pack(projectId: string, options: { force?: boolean; sources?: boolean } = {}): Promise<PackResult> {
    const root = this.pm.getProjectRoot(projectId);
    const dir = this.getPublishDir(projectId);
    const video = this.finalVideoPath(projectId);
    const warnings: string[] = [];

    if (!existsSync(path.join(root, "render", "final", "render.json"))) {
      if (!options.force) {
        throw new ValidationError("There is no final render yet. Run: video-studio render --mode final. Or pass --force.");
      }
      warnings.push("There is no final render. Times come from the current timeline.");
    } else if (!existsSync(video)) {
      warnings.push(`The final video is not at ${video}. It may have been moved.`);
    }

    const manifest = await this.getManifest(projectId);
    const { metadata } = manifest;
    if (!metadata) throw new ValidationError("No titles or description yet. Run: video-studio publish import.");
    const thumbnails = manifest.thumbnails.map((t) => this.thumbnailPath(projectId, t.id));
    if (thumbnails.length !== 3 || thumbnails.some((t) => !existsSync(t))) {
      throw new ValidationError("The three thumbnails are not made yet. Run: video-studio thumbnail make.");
    }
    warnings.push(...this.repeatWarnings(metadata, manifest.thumbnails));

    const project = await this.pm.loadProject(projectId);
    const script = await this.loadScript(projectId);
    const render = await this.tc.getRenderManifest(projectId);
    if (render.metadata.usesEstimatedTiming) {
      throw new ValidationError("The timeline still uses estimated timing. Run audio voice and timeline compile first.");
    }

    const cues = buildCues(await this.timedWords(projectId, script, render));
    if (cues.length === 0) throw new ValidationError("No narration is placed on the timeline, so there is nothing to caption.");

    const chapters = this.chapterList(script, render);
    const lengths = chapters.map((c, i) => (chapters[i + 1]?.seconds ?? render.totalDurationSeconds) - c.seconds);
    const chaptersWork = chapters.length >= MIN_CHAPTERS && lengths.every((l) => l >= MIN_CHAPTER_SECONDS);
    if (!chaptersWork) {
      warnings.push(
        `YouTube shows chapters only with ${MIN_CHAPTERS} or more, each at least ${MIN_CHAPTER_SECONDS} s. They are left out.`
      );
    }

    const research = options.sources === false ? null : await this.loadResearch(projectId);
    const labels = LABELS[project.language] ?? LABELS.en!;
    const description = assembleDescription({
      body: metadata.description,
      chaptersLabel: labels.chapters,
      chapters: chaptersWork ? chapters.map((c) => ({ time: chapterTime(c.seconds), title: c.title })) : [],
      sourcesLabel: labels.sources,
      sources: (research?.sources ?? []).filter((s) => s.opened).map((s) => `${s.title}, ${s.publisher}: ${s.url}`),
      hashtags: metadata.hashtags,
    });
    if (description.droppedSources > 0) warnings.push(`${description.droppedSources} sources did not fit in the description.`);
    if (description.text.length > DESCRIPTION_MAX) {
      throw new ValidationError(
        `The description is ${description.text.length} characters with chapters and hashtags. The limit is ${DESCRIPTION_MAX}.`
      );
    }

    const transcript = script.chapters
      .map((c) => c.segments.map((s) => spokenText(s.text)).join("\n\n"))
      .join("\n\n");
    const outputs: [string, string][] = [
      ["titles.txt", metadata.titles.join("\n") + "\n"],
      ["description.txt", description.text + "\n"],
      ["tags.txt", metadata.tags.join(", ") + "\n"],
      ["subtitles.srt", formatSrt(cues)],
      ["transcript.txt", transcript + "\n"],
    ];
    for (const [name, content] of outputs) await atomicWriteFile(path.join(dir, name), content);

    await atomicWriteJson(path.join(dir, "pack.json"), {
      inputHash: fingerprint({ metadata, thumbnails: manifest.thumbnails, outputs }),
      packedAt: new Date().toISOString(),
    });
    await this.stages.markBuilt(projectId, "publish");

    return {
      folder: dir,
      video,
      files: [...outputs.map(([name]) => path.join(dir, name)), ...thumbnails],
      cues: cues.length,
      durationSeconds: render.totalDurationSeconds,
      warnings,
    };
  }
}
