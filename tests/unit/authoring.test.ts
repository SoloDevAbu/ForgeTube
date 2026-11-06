import { describe, it, expect, afterEach } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import { createSample, sampleDossier, sampleScriptMarkdown, sampleStoryboardText, SAMPLE_ID, type SampleProject } from "../fixtures-sample.js";
import { getRomanHistoryResearchDossier } from "../fixtures-rome.js";
import { parseStoryboardFile } from "../../src/core/storyboard/storyboardFormat.js";
import { StageGraph } from "../../src/core/pipeline/stageGraph.js";

describe("Authoring stages", () => {
  let sample: SampleProject;
  afterEach(() => sample.cleanup());

  const writeTemp = async (name: string, content: string) => {
    const p = path.join(sample.tmpDir, name);
    await fs.writeFile(p, content, "utf-8");
    return p;
  };

  it("names the next command for a new project", async () => {
    sample = await createSample("project");
    expect((await sample.pm.getProjectStatus(SAMPLE_ID)).nextCommand).toContain("research brief");
  });

  it("rejects research whose source was never opened", async () => {
    sample = await createSample("project");
    const dossier = sampleDossier();
    dossier.sources[0]!.opened = false;
    await sample.rm.importResearch(SAMPLE_ID, await writeTemp("r.json", JSON.stringify(dossier)));
    const report = await sample.rm.validateResearch(SAMPLE_ID);
    expect(report.valid).toBe(false);
    expect(report.errors.join(" ")).toContain("opened");
  });

  it("validates the Rome dossier through import, with no built-in generator", async () => {
    sample = await createSample("project");
    const dossier = getRomanHistoryResearchDossier();
    for (const s of dossier.sources) s.opened = true;
    await sample.rm.importResearch(SAMPLE_ID, await writeTemp("rome.json", JSON.stringify(dossier)));
    expect((await sample.rm.validateResearch(SAMPLE_ID)).totalClaims).toBeGreaterThan(5);
  });

  it("refuses a script before research is approved", async () => {
    sample = await createSample("project");
    const file = await writeTemp("s.md", sampleScriptMarkdown());
    await expect(sample.sm.importScript(SAMPLE_ID, file)).rejects.toThrow();
  });

  it("rejects narration stating tradition as fact, or a number no claim has", async () => {
    sample = await createSample("research");
    const asFact = sampleScriptMarkdown().replace("According to tradition, its", "Its");
    await expect(sample.sm.importScript(SAMPLE_ID, await writeTemp("a.md", asFact))).rejects.toThrow("tradition");

    const number = sampleScriptMarkdown().replace("a single point", "exactly 40 points");
    await expect(sample.sm.importScript(SAMPLE_ID, await writeTemp("b.md", number))).rejects.toThrow("40");
  });

  it("marks later stages stale when one segment changes, and keeps them", async () => {
    sample = await createSample("storyboard");
    const stages = new StageGraph(sample.pm);
    await sample.sm.setSegment(SAMPLE_ID, "narration_004", {
      text: "In the end, it fell, and the stones slid beneath the waves.",
    });
    const status = await stages.getStatus(SAMPLE_ID);
    expect(status.find((s) => s.stage === "storyboard")?.stale).toBe(true);
    expect((await sample.stm.getStoryboard(SAMPLE_ID)).scenes.length).toBeGreaterThan(0);
  });

  it("derives shots from the compact format with code-made defaults", async () => {
    sample = await createSample("storyboard");
    const { scenes, chapterMoods } = await sample.stm.getStoryboard(SAMPLE_ID);
    expect(scenes.length).toBeGreaterThanOrEqual(14);
    expect(chapterMoods.chapter_02).toContain("sorrowful");

    for (let i = 1; i < scenes.length; i++) {
      const previous = scenes[i - 1]!;
      const scene = scenes[i]!;
      if (previous.chapterId === scene.chapterId) expect(scene.camera.effect).not.toBe(previous.camera.effect);
    }
    expect(scenes[0]!.narrationSegmentIds).toEqual(["narration_001"]);
    expect(scenes[0]!.wordStart).toBe(0);
  });

  it("reports an anchor that is not in the narration", () => {
    const segments = new Map([["narration_001", { chapterId: "chapter_01", text: "One two three." }]]);
    expect(() =>
      parseStoryboardFile("# chapter chapter_01\nnarration_001 | missing words | a prompt", segments)
    ).toThrow();
  });

  it("exports batches of ten with a shared header and short prompts", async () => {
    sample = await createSample("storyboard");
    const result = await sample.stm.exportPrompts(SAMPLE_ID);
    const count = (await sample.stm.getStoryboard(SAMPLE_ID)).scenes.length;
    expect(result.batchPaths.length).toBe(Math.ceil(count / 10));

    const first = await fs.readFile(result.batchPaths[0]!, "utf-8");
    expect(first).toContain("oil painting");
    expect(first.match(/oil painting/g)?.length).toBe(1);
  });

  it("re-importing the storyboard keeps shots that survive", async () => {
    sample = await createSample("storyboard");
    const before = await sample.stm.getStoryboard(SAMPLE_ID);
    const edited = sampleStoryboardText() + "\n";
    const result = await sample.stm.importStoryboard(SAMPLE_ID, await writeTemp("again.txt", edited));
    expect(result.added).toBe(0);
    expect(result.storyboard.scenes.map((s) => s.sceneId)).toEqual(before.scenes.map((s) => s.sceneId));
  });
});
