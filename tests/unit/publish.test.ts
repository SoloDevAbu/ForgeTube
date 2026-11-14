import { describe, it, expect } from "bun:test";
import { buildCues, chapterTime, formatSrt, timeSegmentWords, CAPTION_LINE_CHARS } from "../../src/core/publish/captions.js";
import { assembleDescription, parseMetadata, tagsLength, validateMetadata } from "../../src/core/publish/metadataFormat.js";
import { layoutText, parseThumbnailPlan, placeSubject, textStyleFor } from "../../src/core/publish/thumbnailFormat.js";

const TEXT =
  "Long before the great harbours of the modern world, sailors crossing toward Egypt faced a coast so low that it almost vanished. [pause 1] The Ptolemies answered with a tower.";

describe("Captions", () => {
  const takeWords = TEXT.replace(/\[pause 1\]/, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word, i) => ({ word, start: i * 0.4, end: i * 0.4 + 0.3 }));

  it("places script words at the take's measured times", () => {
    const words = timeSegmentWords(TEXT, takeWords, 10, 20);
    expect(words).toHaveLength(takeWords.length);
    expect(words[0]).toEqual({ text: "Long", start: 10, end: 10.3 });
    expect(words.some((w) => w.text.includes("pause"))).toBe(false);
  });

  it("keeps times in order when the voice split words differently", () => {
    const words = timeSegmentWords("In 509 BC the kings fell.", takeWords.slice(0, 9), 5, 4);
    expect(words).toHaveLength(6);
    expect(words[0]!.start).toBe(5);
    for (const [i, w] of words.entries()) {
      expect(w.end).toBeGreaterThanOrEqual(w.start);
      if (i > 0) expect(w.start).toBeGreaterThanOrEqual(words[i - 1]!.start);
    }
  });

  it("spreads words over the measured length when a take has no word times", () => {
    const words = timeSegmentWords("One two three.", null, 2, 3);
    expect(words[0]!.start).toBe(2);
    expect(words.at(-1)!.end).toBeCloseTo(5);
  });

  it("cuts cues at sentences, within two short lines, never overlapping", () => {
    const cues = buildCues(timeSegmentWords(TEXT, takeWords, 0, 20));
    expect(cues.length).toBeGreaterThan(2);
    expect(cues.at(-1)!.lines.join(" ")).toBe("The Ptolemies answered with a tower.");
    for (const [i, cue] of cues.entries()) {
      expect(cue.lines.length).toBeLessThanOrEqual(2);
      for (const line of cue.lines) expect(line.length).toBeLessThanOrEqual(CAPTION_LINE_CHARS);
      expect(cue.end).toBeGreaterThan(cue.start);
      if (i > 0) expect(cue.start).toBeGreaterThan(cues[i - 1]!.end);
    }
  });

  it("writes SRT and chapter times the way YouTube reads them", () => {
    const srt = formatSrt([{ start: 3661.5, end: 3663, lines: ["रोम गिरा।"] }]);
    expect(srt).toBe("1\n01:01:01,500 --> 01:01:03,000\nरोम गिरा।\n");
    expect(chapterTime(0)).toBe("0:00");
    expect(chapterTime(725.9)).toBe("12:05");
    expect(chapterTime(3725)).toBe("1:02:05");
  });
});

describe("Upload metadata", () => {
  const file = [
    "# titles",
    "A | The Entire History of Rome in 15 Minutes",
    "How a Village of Huts Came to Rule the Known World",
    "- Why Did Rome Fall Twice?",
    "# description",
    "How did a few huts become an empire?",
    "",
    "Second paragraph.",
    "# hashtags",
    "#AncientRome RomanEmpire, #History",
    "# tags",
    "ancient rome, roman empire,",
    "julius caesar",
  ].join("\n");

  it("parses the compact format", () => {
    const meta = parseMetadata(file);
    expect(meta.titles).toEqual([
      "The Entire History of Rome in 15 Minutes",
      "How a Village of Huts Came to Rule the Known World",
      "Why Did Rome Fall Twice?",
    ]);
    expect(meta.description).toBe("How did a few huts become an empire?\n\nSecond paragraph.");
    expect(meta.hashtags).toEqual(["#AncientRome", "#RomanEmpire", "#History"]);
    expect(meta.tags).toEqual(["ancient rome", "roman empire", "julius caesar"]);
    expect(validateMetadata(meta)).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it("accepts Hindi titles and hashtags", () => {
    const meta = parseMetadata(
      "# titles\nरोम का पूरा इतिहास\nरोम कैसे गिरा?\nएक गाँव से साम्राज्य तक\n# description\nरोम की कहानी।\n# hashtags\n#रोम #इतिहास\n# tags\nरोम, rome history"
    );
    expect(meta.titles).toHaveLength(3);
    expect(validateMetadata(meta).errors).toEqual([]);
  });

  it("rejects what YouTube rejects, and what the CLI adds itself", () => {
    const meta = parseMetadata(file);
    meta.titles = ["x".repeat(101), "Rome <b>", "Rome <b>"];
    meta.description = "0:00 Intro\nRead more #Rome";
    meta.hashtags = Array.from({ length: 16 }, (_, i) => `#tag${i}`);
    meta.tags = ["a".repeat(300), "b".repeat(300)];
    const errors = validateMetadata(meta).errors.join(" ");
    for (const part of ["limit is 100", '"<" or ">"', "repeats another title", "timestamps", "has hashtags", "past 15", "limit is 500"]) {
      expect(errors).toContain(part);
    }
  });

  it("counts tags the way YouTube does", () => {
    expect(tagsLength(["rome", "roman empire"])).toBe(4 + 12 + 2 + 1);
  });

  it("drops sources before the description passes the limit", () => {
    const { text, droppedSources } = assembleDescription({
      body: "Body.",
      chaptersLabel: "Chapters",
      chapters: [{ time: "0:00", title: "Start" }],
      sourcesLabel: "Sources",
      sources: Array.from({ length: 40 }, (_, i) => `Source ${i} ${"x".repeat(200)}`),
      hashtags: ["#Rome"],
    });
    expect(text.length).toBeLessThanOrEqual(5000);
    expect(droppedSources).toBeGreaterThan(0);
    expect(text.startsWith("Body.\n\nChapters\n0:00 Start\n\nSources\n• Source 0")).toBe(true);
    expect(text.endsWith("#Rome")).toBe(true);
  });
});

describe("Thumbnail plan", () => {
  it("parses three variants with their options", () => {
    const { variants, errors } = parseThumbnailPlan(
      [
        "# notes are skipped",
        "B | img=scene_040 | WHY IT *FELL* | layout=right | accent=red | focus=0.3,0.5 | zoom=1.4",
        "A | img=scene_012 | THE *LAST* EMPEROR",
        "C | file=C:\\images\\statue.png | - | layout=center | look=warm | accent=#00ff88",
      ].join("\n")
    );
    expect(errors).toEqual([]);
    expect(variants.map((v) => v.id)).toEqual(["A", "B", "C"]);
    expect(variants[1]).toMatchObject({
      sceneId: "scene_040",
      layout: "right",
      accent: "#FF2D2D",
      focus: { x: 0.3, y: 0.5 },
      zoom: 1.4,
    });
    expect(variants[2]).toMatchObject({ file: "C:\\images\\statue.png", text: "", look: "warm", accent: "#00ff88" });
  });

  it("asks for three different variants with short text", () => {
    const { errors } = parseThumbnailPlan(
      ["A | img=scene_001 | ONE TWO THREE FOUR FIVE SIX", "B | img=scene_002 | ROME | layout=up", "B | img=scene_003 | ROME"].join("\n")
    );
    const all = errors.join(" ");
    for (const part of ["6 words", "not a known option", "written twice", "Variant C is missing"]) expect(all).toContain(part);

    const same = parseThumbnailPlan(["A | img=s1 | ROME", "B | img=s1 | ROME", "C | img=s2 | ROME"].join("\n"));
    expect(same.errors.join(" ")).toContain("A and B are the same");
  });

  it("breaks text into the lines that make it largest, and marks the accent", () => {
    const style = textStyleFor("HOW ROME FELL");
    const side = layoutText("HOW ROME *FELL*", "left", style);
    expect(side.lines.map((l) => l.map((w) => w.text).join(" "))).toEqual(["HOW", "ROME", "FELL"]);
    expect(side.lines[2]![0]!.accent).toBe(true);
    expect(side.lines[0]![0]!.accent).toBe(false);

    const forced = layoutText("1,000 YEARS / OF *ROME*", "bottom", style);
    expect(forced.lines.map((l) => l.length)).toEqual([2, 2]);
    expect(layoutText("", "left", style).lines).toEqual([]);

    const longWord = layoutText("THE FORGOTTEN ROMANS", "left", style);
    expect(longWord.fontSize * style.glyphWidth * "FORGOTTEN".length).toBeLessThanOrEqual(600);
  });

  it("uses a Devanagari face for Hindi text, without capitals", () => {
    const style = textStyleFor("रोम कैसे गिरा");
    expect(style.uppercase).toBe(false);
    expect(style.fontFamily).toContain("Nirmala");
    expect(layoutText("रोम कैसे *गिरा*", "right", style).fontSize).toBeGreaterThan(80);
  });

  it("moves the subject away from the text without leaving the image", () => {
    expect(placeSubject("left", null, 1)).toEqual({ scale: 1, translate: { x: 0, y: 0 } });
    // A subject at 0.2 wants to sit at 0.72: the shift is capped at the image edge.
    expect(placeSubject("left", { x: 0.2, y: 0.5 }, 1.5).translate.x).toBe(0);
    const right = placeSubject("right", { x: 0.8, y: 0.5 }, 1.5);
    expect(right.translate.x).toBeCloseTo(-0.5);
    expect(right.translate.y).toBeLessThanOrEqual(0);
    expect(right.translate.y).toBeGreaterThanOrEqual(-0.5);
  });
});
