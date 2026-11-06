import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ProjectManager } from "../src/core/projects/projectManager.js";
import { ResearchManager } from "../src/core/research/researchManager.js";
import { ScriptManager } from "../src/core/script/scriptManager.js";
import { StoryboardManager } from "../src/core/storyboard/storyboardManager.js";
import { splitWords } from "../src/core/script/scriptFormat.js";

export const SAMPLE_ID = "the_pharos";

const NOW = "2026-11-07T00:00:00.000Z";

/** A small non-Rome film, so nothing can lean on the Rome fixture. */
export function sampleDossier() {
  return {
    schemaVersion: 1,
    topic: "The Pharos of Alexandria",
    scope_statement: "How the lighthouse rose, stood and fell.",
    sources: [
      {
        source_id: "src_a",
        title: "Sample reference on the Pharos",
        publisher: "Sample Press",
        url: "https://example.org/pharos",
        accessed_at: NOW,
        opened: true,
      },
    ],
    claims: [
      {
        claim_id: "clm_built",
        claim: "The Pharos was built on an island at the harbour of Alexandria under the Ptolemies.",
        time_period: "third century BC",
        evidence_source_ids: ["src_a"],
      },
      {
        claim_id: "clm_guide",
        claim: "Tradition holds that its light could be seen far out at sea.",
        kind: "tradition",
        time_period: "antiquity",
        confidence: "contested",
        evidence_source_ids: ["src_a"],
      },
      {
        claim_id: "clm_fell",
        claim: "Earthquakes damaged the tower over centuries until it fell.",
        time_period: "medieval period",
        evidence_source_ids: ["src_a"],
      },
    ],
    chronology: [],
    chapters: [
      {
        chapter_id: "chapter_01",
        chapter_number: 1,
        title: "The Tower",
        time_period: "third century BC",
        summary: "The tower is built.",
        estimated_duration_seconds: 30,
        claim_ids: ["clm_built", "clm_guide"],
      },
      {
        chapter_id: "chapter_02",
        chapter_number: 2,
        title: "The Fall",
        time_period: "medieval period",
        summary: "The tower falls.",
        estimated_duration_seconds: 30,
        claim_ids: ["clm_fell"],
      },
    ],
    updatedAt: NOW,
  };
}

export const SAMPLE_SEGMENTS: Record<string, string> = {
  narration_001:
    "Long before the great harbours of the modern world, sailors crossing toward Egypt faced a coast so low and so flat that it almost vanished into the sea. Under the Ptolemies, the rulers of Alexandria answered that danger with a tower raised on an island at the mouth of the harbour.",
  narration_002:
    "According to tradition, its light could be seen far out at sea. [pause] Night after night, ships found their way home by a single point of fire above the dark water, and the name of the island became the word for a lighthouse.",
  narration_003:
    "But stone cannot argue with the earth. Over the centuries, earthquakes shook the tower again and again, cracking the walls that had guided so many sailors through the night. Each repair was smaller than the last, and each generation saw a little less of it standing above the bay.",
  narration_004:
    "In the end, it fell. The stones slid beneath the waves, and the harbour it had guarded forgot how tall it once stood. Yet the idea survived, and every lighthouse since has carried that same promise across the dark water.",
};

export function sampleScriptMarkdown(): string {
  return [
    "# Chapter chapter_01: The Tower | third century BC",
    "## narration_001 [clm_built]",
    SAMPLE_SEGMENTS.narration_001,
    "## narration_002 [clm_guide]",
    SAMPLE_SEGMENTS.narration_002,
    "# Chapter chapter_02: The Fall | medieval period",
    "## narration_003 [clm_fell]",
    SAMPLE_SEGMENTS.narration_003,
    "## narration_004 [clm_fell]",
    SAMPLE_SEGMENTS.narration_004,
  ].join("\n");
}

/** One line per shot, cut about every nine words so each stays under five seconds. */
function shotLines(segmentId: string, text: string, label: string): string[] {
  const words = splitWords(text);
  const lines: string[] = [];
  for (let at = 9; at < words.length - 3; at += 9) {
    lines.push(`${segmentId} | ${words.slice(at - 3, at).join(" ")} | ${label} view ${at} of the old harbour`);
  }
  lines.push(`${segmentId} | * | ${label} final view of the old harbour`);
  return lines;
}

export function sampleStoryboardText(): string {
  return [
    "# style",
    "direction: restrained oil painting of the ancient Mediterranean",
    "wardrobe: plain linen tunics, Hellenistic Egyptian dress",
    "environment: pale limestone, low sandy coast, working harbour",
    "palette: amber firelight against deep blue night",
    "composition: wide shots, low horizon, room for the sky",
    "negative: text, watermark, logo",
    "continuity: the tower keeps three tiers; the harbour faces north",
    "character Keeper: an old man with a grey beard and a linen cap",
    "location Harbour: a curved bay with a causeway to the island",
    "",
    "# chapter chapter_01 | mood: slow, reverent strings",
    ...shotLines("narration_001", SAMPLE_SEGMENTS.narration_001!, "dawn"),
    ...shotLines("narration_002", SAMPLE_SEGMENTS.narration_002!, "night"),
    "",
    "# chapter chapter_02 | mood: dark, sorrowful drones",
    ...shotLines("narration_003", SAMPLE_SEGMENTS.narration_003!, "storm"),
    ...shotLines("narration_004", SAMPLE_SEGMENTS.narration_004!, "dusk"),
  ].join("\n");
}

export interface SampleProject {
  tmpDir: string;
  pm: ProjectManager;
  rm: ResearchManager;
  sm: ScriptManager;
  stm: StoryboardManager;
  cleanup: () => Promise<void>;
}

/** Runs authoring up to the given stage. Each stage approves the one before. */
export async function createSample(through: "project" | "research" | "script" | "storyboard"): Promise<SampleProject> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "forgetube-sample-"));
  const pm = new ProjectManager(path.join(tmpDir, "projects"));
  const rm = new ResearchManager(pm);
  const sm = new ScriptManager(pm, rm);
  const stm = new StoryboardManager(pm, sm, rm);
  const cleanup = () => fs.rm(tmpDir, { recursive: true, force: true });
  const result = { tmpDir, pm, rm, sm, stm, cleanup };

  await pm.createProject({ name: "The Pharos", topic: "The Pharos of Alexandria", targetMinutes: 1.4 });
  if (through === "project") return result;

  const dossier = path.join(tmpDir, "research.json");
  await fs.writeFile(dossier, JSON.stringify(sampleDossier()), "utf-8");
  await rm.importResearch(SAMPLE_ID, dossier);
  await rm.approveResearch(SAMPLE_ID);
  if (through === "research") return result;

  const script = path.join(tmpDir, "script.md");
  await fs.writeFile(script, sampleScriptMarkdown(), "utf-8");
  await sm.importScript(SAMPLE_ID, script);
  await sm.approveScript(SAMPLE_ID);
  if (through === "script") return result;

  const storyboard = path.join(tmpDir, "storyboard.txt");
  await fs.writeFile(storyboard, sampleStoryboardText(), "utf-8");
  await stm.importStoryboard(SAMPLE_ID, storyboard);
  await stm.approveStoryboard(SAMPLE_ID);
  return result;
}
