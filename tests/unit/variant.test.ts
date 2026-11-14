import { describe, it, expect, afterEach } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { createSample, SAMPLE_ID, SAMPLE_TOPIC, type SampleProject } from "../fixtures-sample.js";
import { createTestImage } from "../fixtures.js";
import { hindiScriptMarkdown, hindiStoryboardText, HINDI_NEW_PROMPT, HINDI_SEGMENTS } from "../fixtures-hindi.js";
import { VariantManager } from "../../src/core/projects/variantManager.js";
import { AssetManager } from "../../src/core/assets/assetManager.js";
import { CalibrationManager } from "../../src/core/calibration/calibrationManager.js";
import { StageGraph } from "../../src/core/pipeline/stageGraph.js";
import { endsSentence, normalizeWord, checkSegmentAgainstClaims } from "../../src/core/script/scriptFormat.js";
import { getLanguage } from "../../src/core/language/languages.js";
import { MixSettingsSchema } from "../../src/core/schemas/project.js";
import os from "node:os";
import { ProjectManager } from "../../src/core/projects/projectManager.js";
import { ResearchManager } from "../../src/core/research/researchManager.js";
import { ScriptManager } from "../../src/core/script/scriptManager.js";
import { StoryboardManager } from "../../src/core/storyboard/storyboardManager.js";
import { sampleDossier, sampleScriptMarkdown } from "../fixtures-sample.js";

const stages = (s: SampleProject) => new StageGraph(s.pm);

const HINDI_ID = `${SAMPLE_TOPIC}/hindi`;

describe("Language versions", () => {
  let sample: SampleProject;
  afterEach(() => sample?.cleanup());

  const writeTemp = async (name: string, content: string) => {
    const p = path.join(sample.tmpDir, name);
    await fs.writeFile(p, content, "utf-8");
    return p;
  };

  /** The English film with images and crops, then its Hindi version up to the script. */
  const hindiThroughScript = async () => {
    sample = await createSample("storyboard");
    const base = await sample.stm.getStoryboard(SAMPLE_ID);
    const flow = path.join(sample.tmpDir, "flow");
    for (const [i] of base.scenes.entries()) {
      await createTestImage(path.join(flow, `Flow_${String(i).padStart(3, "0")}.png`), 1920, 1080, "teal");
    }
    await new AssetManager(sample.pm).importImages(SAMPLE_ID, { inputPath: flow, order: true });
    await new CalibrationManager(sample.pm).applyPreset(SAMPLE_ID, "gemini-watermark");

    const variants = new VariantManager(sample.pm);
    const created = await variants.addVersion(SAMPLE_TOPIC, "hindi");
    await sample.sm.importScript(HINDI_ID, await writeTemp("hi.md", hindiScriptMarkdown()));
    await sample.sm.approveScript(HINDI_ID);
    return { variants, created, base: await sample.stm.getStoryboard(SAMPLE_ID) };
  };

  it("reads Hindi words and sentence ends", () => {
    expect(normalizeWord("की,")).toBe("की");
    expect(normalizeWord("था।")).toBe("था");
    expect(normalizeWord("का")).not.toBe(normalizeWord("की"));
    expect(endsSentence("था।")).toBe(true);
    expect(endsSentence("रोम")).toBe(false);
  });

  it("asks Hindi narration to attribute a tradition, and reads Devanagari digits", () => {
    const claims = new Map([
      ["t", { claim: "Tradition dates the founding to 753 BC.", kind: "tradition" }],
    ]);
    const { attribution } = getLanguage("hi");
    expect(checkSegmentAgainstClaims("s", "रोम की नींव 753 में रखी गई।", ["t"], claims, attribution).join(" ")).toContain("tradition");
    expect(checkSegmentAgainstClaims("s", "परंपरा के अनुसार रोम की नींव ७५३ में रखी गई।", ["t"], claims, attribution)).toEqual([]);
    expect(checkSegmentAgainstClaims("s", "कहा जाता है कि नींव 754 में रखी गई।", ["t"], claims, attribution).join(" ")).toContain("754");

    const century = new Map([["c", { claim: "Around the eighth century BC, farmers lived in huts.", kind: "fact" }]]);
    expect(checkSegmentAgainstClaims("s", "8वीं सदी में यहाँ किसान रहते थे।", ["c"], century, attribution)).toEqual([]);
    expect(checkSegmentAgainstClaims("s", "9वीं सदी में यहाँ किसान रहते थे।", ["c"], century, attribution).length).toBe(1);
  });

  it("adds a Hindi version beside the English one, sharing one research folder", async () => {
    sample = await createSample("research");
    const variants = new VariantManager(sample.pm);
    const { project, created } = await variants.addVersion(SAMPLE_TOPIC, "hindi");
    const topicRoot = sample.pm.getTopicRoot(SAMPLE_TOPIC);

    expect(project.id).toBe(HINDI_ID);
    expect(created).toBe(true);
    expect(project.language).toBe("hi");
    expect(project.settings.voice.voice).toStartWith("hi-IN-");
    expect(project.checkpoints.researchApproved).toBe(true);
    expect((await sample.pm.getProjectStatus(HINDI_ID)).nextCommand).toContain("script brief");

    // One research folder for the topic, none inside a version.
    expect((await fs.readdir(topicRoot)).sort()).toEqual(["english", "hindi", "research"]);
    expect(existsSync(path.join(topicRoot, "hindi", "research"))).toBe(false);
    expect((await sample.rm.getResearch(HINDI_ID)).claims.length).toBe((await sample.rm.getResearch(SAMPLE_ID)).claims.length);

    // Running it again changes nothing. With two versions, a bare topic is ambiguous.
    expect((await variants.addVersion(HINDI_ID, "hi")).created).toBe(false);
    expect(() => sample.pm.getProjectRoot(SAMPLE_TOPIC)).toThrow("more than one version");
    expect(sample.pm.resolveId(`${SAMPLE_TOPIC}/hi`)).toBe(HINDI_ID);
  });

  it("works Hindi first: research once, then English reuses it and the Hindi telling", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "forgetube-hi-first-"));
    const pm = new ProjectManager(path.join(tmpDir, "projects"));
    const rm = new ResearchManager(pm);
    const sm = new ScriptManager(pm, rm);
    sample = { tmpDir, pm, rm, sm, stm: new StoryboardManager(pm, sm, rm), cleanup: () => fs.rm(tmpDir, { recursive: true, force: true }) };

    const hindi = await pm.createProject({ name: "The Pharos", topic: "The Pharos of Alexandria", targetMinutes: 1.4, language: "hindi" });
    expect(hindi.id).toBe(HINDI_ID);
    expect(pm.resolveId(SAMPLE_TOPIC)).toBe(HINDI_ID);
    await expect(new VariantManager(pm).addVersion("no_such_topic", "english")).rejects.toThrow();

    await rm.importResearch(HINDI_ID, await writeTemp("r.json", JSON.stringify(sampleDossier())));
    await rm.approveResearch(HINDI_ID);
    await sm.importScript(HINDI_ID, await writeTemp("hi.md", hindiScriptMarkdown()));

    // English is added only when wanted, and needs no second research pass.
    const english = await new VariantManager(pm).addVersion(SAMPLE_TOPIC, "english");
    expect(english.project.id).toBe(SAMPLE_ID);
    expect(english.project.checkpoints.researchApproved).toBe(true);
    const brief = await sm.buildBrief(SAMPLE_ID, "chapter_01");
    expect(brief).toContain("plain spoken English");
    expect(brief).toContain(HINDI_SEGMENTS.narration_002!.slice(0, 20));
    await sm.importScript(SAMPLE_ID, await writeTemp("en.md", sampleScriptMarkdown()));
  });

  it("approves or changes the shared research for both versions at once", async () => {
    sample = await createSample("research");
    await new VariantManager(sample.pm).addVersion(SAMPLE_TOPIC, "hindi");
    const stages = new StageGraph(sample.pm);

    const dossier = sampleDossier();
    dossier.claims[0]!.claim += " It stood for centuries.";
    await sample.rm.importResearch(SAMPLE_ID, await writeTemp("r2.json", JSON.stringify(dossier)));
    await expect(stages.requireApproved(HINDI_ID, "research")).rejects.toThrow();

    await sample.rm.approveResearch(SAMPLE_ID);
    await stages.requireApproved(HINDI_ID, "research");
    await stages.requireApproved(SAMPLE_ID, "research");
  });

  it("migrates the old one-folder layout without losing anything", async () => {
    sample = await createSample("storyboard");
    const base = sample.pm.getProjectsRoot();
    const variants = new VariantManager(sample.pm);
    await variants.addVersion(SAMPLE_TOPIC, "hindi");

    // Rebuild the old layout: projects/the_pharos and projects/the_pharos_hi, each with research.
    const old = path.join(sample.tmpDir, "old");
    await fs.rename(path.join(base, SAMPLE_TOPIC), old);
    const setId = async (dir: string, patch: object) => {
      const file = path.join(dir, "project.json");
      await fs.writeFile(file, JSON.stringify({ ...JSON.parse(await fs.readFile(file, "utf-8")), ...patch }));
    };
    await fs.rename(path.join(old, "english"), path.join(base, "the_pharos"));
    await fs.cp(path.join(old, "research"), path.join(base, "the_pharos", "research"), { recursive: true });
    await setId(path.join(base, "the_pharos"), { id: "the_pharos" });
    await fs.rename(path.join(old, "hindi"), path.join(base, "the_pharos_hi"));
    await fs.cp(path.join(old, "research"), path.join(base, "the_pharos_hi", "research"), { recursive: true });
    await setId(path.join(base, "the_pharos_hi"), { id: "the_pharos_hi", variantOf: "the_pharos" });
    await fs.mkdir(path.join(base, "the_pharos", "render", "final"), { recursive: true });
    await fs.writeFile(path.join(base, "the_pharos", "render", "final", "the_pharos.mp4"), "x");
    expect(() => sample.pm.getProjectRoot("the_pharos")).toThrow("project migrate");

    const rows = await variants.migrate();
    expect(rows.map((r) => r.to).sort()).toEqual([SAMPLE_ID, HINDI_ID]);
    expect((await fs.readdir(path.join(base, SAMPLE_TOPIC))).sort()).toEqual(["english", "hindi", "research"]);
    expect(existsSync(path.join(base, "the_pharos_hi"))).toBe(false);
    expect(existsSync(path.join(base, SAMPLE_TOPIC, "english", "render", "final", "the_pharos_english.mp4"))).toBe(true);
    expect(existsSync(path.join(base, SAMPLE_TOPIC, "hindi", "research.duplicate", "research.json"))).toBe(true);
    expect((await sample.pm.loadProject(HINDI_ID)).id).toBe(HINDI_ID);
    expect((await sample.stm.getStoryboard(SAMPLE_ID)).scenes.length).toBeGreaterThan(0);
    await stages(sample).requireApproved(HINDI_ID, "research");
    expect(await variants.migrate()).toEqual([]);
  });

  it("briefs the Hindi script with the base film's telling and takes a different segment count", async () => {
    const { base } = await hindiThroughScript();
    const brief = await sample.sm.buildBrief(HINDI_ID, "chapter_01");
    expect(brief).toContain("Devanagari");
    expect(brief).toContain("According to tradition, its light");

    const hindi = await sample.sm.getScriptManifest(HINDI_ID);
    const english = await sample.sm.getScriptManifest(SAMPLE_ID);
    expect(hindi.chapters.flatMap((c) => c.segments).length).toBe(5);
    expect(english.chapters.flatMap((c) => c.segments).length).toBe(4);
    expect(hindi.chapters[0]!.title).toBe("मीनार");
    expect(base.scenes.length).toBeGreaterThan(0);
  }, 60_000);

  it("gives Hindi its own shots, reusing base images and crops", async () => {
    const { base } = await hindiThroughScript();
    const brief = await sample.stm.buildBrief(HINDI_ID, "chapter_01");
    expect(brief).toContain("img=scene_012");
    expect(brief).toContain(`${base.scenes[0]!.sceneId}: `);

    const text = hindiStoryboardText(base.scenes.map((s) => s.sceneId));
    const result = await sample.stm.importStoryboard(HINDI_ID, await writeTemp("hi-board.txt", text));
    const scenes = result.storyboard.scenes;
    const root = sample.pm.getProjectRoot(HINDI_ID);

    expect(scenes.length).not.toBe(base.scenes.length);
    const fresh = scenes.filter((s) => !s.reusesImageOf);
    expect(fresh.map((s) => s.shortPrompt)).toEqual([HINDI_NEW_PROMPT]);
    expect(result.warnings.join(" ")).toContain("1 need a new one");

    for (const scene of scenes.filter((s) => s.reusesImageOf)) {
      const source = base.scenes.find((s) => s.sceneId === scene.reusesImageOf)!;
      expect(existsSync(path.join(root, scene.visual.image))).toBe(true);
      expect(scene.visual.zoom).toBe(source.visual.zoom);
      expect(scene.shortPrompt).toBe(source.shortPrompt);
      expect(scene.status.image).toBe("imported");
    }
    // The base film is untouched.
    expect((await sample.stm.getStoryboard(SAMPLE_ID)).scenes.length).toBe(base.scenes.length);

    // Only the new picture needs a prompt.
    await sample.stm.approveStoryboard(HINDI_ID);
    const exported = await sample.stm.exportPrompts(HINDI_ID);
    expect(exported.promptCount).toBe(1);
    expect(exported.exportContent).toContain(HINDI_NEW_PROMPT);
    expect((await sample.pm.loadProject(HINDI_ID)).status).toBe("WAITING_FOR_MANUAL_IMAGES");

    // Importing again keeps every shot and adds no image files.
    const again = await sample.stm.importStoryboard(HINDI_ID, await writeTemp("hi-board2.txt", text + "\n"));
    expect(again.added).toBe(0);
    expect(again.storyboard.scenes.map((s) => s.visual.image)).toEqual(scenes.map((s) => s.visual.image));
    const images = (await new StageGraph(sample.pm).getStatus(HINDI_ID)).find((s) => s.stage === "images")!;
    expect(images.built).toBe(true);
  }, 60_000);

  it("rejects img= outside a language version, and a bare = prompt", async () => {
    sample = await createSample("script");
    const line = (rest: string) =>
      ["# chapter chapter_01", `narration_001 | * | ${rest}`].join("\n");
    await expect(
      sample.stm.importStoryboard(SAMPLE_ID, await writeTemp("a.txt", line("= | img=scene_001")))
    ).rejects.toThrow();
    await expect(sample.stm.importStoryboard(SAMPLE_ID, await writeTemp("b.txt", line("=")))).rejects.toThrow();
    expect(Object.keys(HINDI_SEGMENTS).length).toBe(5);
  });

  it("keeps music and effects far under the voice by default", () => {
    const mix = MixSettingsSchema.parse({});
    expect(mix.voiceLufs - mix.musicLufs).toBeGreaterThanOrEqual(16);
    expect(mix.sfxGainDb).toBeLessThanOrEqual(-18);
  });
});
