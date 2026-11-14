import type { PublishMetadata } from "../schemas/publish.js";

/** YouTube's hard limits. */
export const TITLE_MAX = 100;
export const DESCRIPTION_MAX = 5000;
export const TAGS_MAX = 500;
export const HASHTAGS_MAX = 15;

/** Past these a title is cut off in most feeds, and a description's opening in search. */
export const TITLE_SHOWN = 70;
export const DESCRIPTION_SHOWN = 150;

export interface MetadataReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const SECTIONS = ["titles", "description", "hashtags", "tags"] as const;
type Section = (typeof SECTIONS)[number];

/**
 * Parses the compact metadata format:
 *
 *   # titles
 *   One title per line, three of them.
 *   # description
 *   The written part of the description.
 *   # hashtags
 *   #One #Two #Three
 *   # tags
 *   first tag, second tag
 */
export function parseMetadata(text: string): PublishMetadata {
  const blocks: Record<Section, string[]> = { titles: [], description: [], hashtags: [], tags: [] };
  let section: Section | null = null;

  for (const line of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const heading = line.match(/^#\s+(\w+)\s*$/);
    if (heading && SECTIONS.includes(heading[1]!.toLowerCase() as Section)) {
      section = heading[1]!.toLowerCase() as Section;
      continue;
    }
    if (section) blocks[section].push(line);
  }

  return {
    titles: blocks.titles.map((t) => t.replace(/^\s*(?:[-*]|[A-Ca-c1-3]\s*[.)|])\s+/, "").trim()).filter(Boolean),
    description: blocks.description.join("\n").trim(),
    hashtags: blocks.hashtags
      .join(" ")
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((h) => (h.startsWith("#") ? h : `#${h}`)),
    tags: blocks.tags
      .join(",")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
  };
}

/** Length of the tag list as YouTube counts it: commas count, and a tag with a space is quoted. */
export function tagsLength(tags: string[]): number {
  return tags.reduce((sum, t) => sum + t.length + (t.includes(" ") ? 2 : 0), 0) + Math.max(0, tags.length - 1);
}

export function validateMetadata(meta: PublishMetadata): MetadataReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (meta.titles.length !== 3) errors.push(`Write exactly 3 titles. Found ${meta.titles.length}.`);
  const seen = new Set<string>();
  for (const [i, title] of meta.titles.entries()) {
    const label = `Title ${i + 1}`;
    if (title.length > TITLE_MAX) errors.push(`${label} is ${title.length} characters. The limit is ${TITLE_MAX}.`);
    else if (title.length > TITLE_SHOWN) warnings.push(`${label} is ${title.length} characters. Feeds cut it near ${TITLE_SHOWN}.`);
    if (/[<>]/.test(title)) errors.push(`${label} has "<" or ">", which YouTube rejects.`);
    if (/\p{Lu}/u.test(title) && title === title.toUpperCase() && title.length > 12) {
      warnings.push(`${label} is all capitals.`);
    }
    if (seen.has(title.toLowerCase())) errors.push(`${label} repeats another title.`);
    seen.add(title.toLowerCase());
  }

  if (!meta.description) errors.push("The description is empty.");
  if (/[<>]/.test(meta.description)) errors.push('The description has "<" or ">", which YouTube rejects.');
  if (/^\s*\d{1,2}:\d{2}/m.test(meta.description)) {
    errors.push("The description has timestamps. Leave them out: the CLI adds the chapters from the render.");
  }
  if (/(^|\s)#[\p{L}\p{N}_]+/u.test(meta.description)) {
    errors.push("The description has hashtags. Put them under # hashtags.");
  }
  const opening = meta.description.split(/\r?\n/)[0] ?? "";
  if (opening.length > DESCRIPTION_SHOWN) {
    warnings.push(`The first line is ${opening.length} characters. Search shows about ${DESCRIPTION_SHOWN}.`);
  }

  if (meta.hashtags.length === 0) errors.push("Write at least one hashtag.");
  if (meta.hashtags.length > HASHTAGS_MAX) {
    errors.push(`${meta.hashtags.length} hashtags. YouTube ignores all of them past ${HASHTAGS_MAX}.`);
  } else if (meta.hashtags.length > 5) {
    warnings.push(`${meta.hashtags.length} hashtags. Three to five is enough; only the first three show above the title.`);
  }
  for (const tag of meta.hashtags) {
    if (!/^#[\p{L}\p{M}\p{N}_]+$/u.test(tag)) errors.push(`Hashtag "${tag}" may hold only letters, digits and "_".`);
  }
  if (new Set(meta.hashtags.map((h) => h.toLowerCase())).size !== meta.hashtags.length) {
    errors.push("A hashtag is repeated.");
  }

  if (meta.tags.length === 0) errors.push("Write at least one tag.");
  const length = tagsLength(meta.tags);
  if (length > TAGS_MAX) errors.push(`The tags are ${length} characters. The limit is ${TAGS_MAX}.`);
  if (new Set(meta.tags.map((t) => t.toLowerCase())).size !== meta.tags.length) errors.push("A tag is repeated.");
  for (const tag of meta.tags) {
    if (/[<>#]/.test(tag)) errors.push(`Tag "${tag}" has a character YouTube rejects.`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

export interface DescriptionParts {
  body: string;
  chaptersLabel: string;
  chapters: { time: string; title: string }[];
  sourcesLabel: string;
  sources: string[];
  hashtags: string[];
}

/**
 * The full description: the written part, chapters, sources, hashtags.
 * Sources are dropped from the end when the text would pass the limit.
 */
export function assembleDescription(parts: DescriptionParts): { text: string; droppedSources: number } {
  const build = (sources: string[]) =>
    [
      parts.body,
      parts.chapters.length > 0
        ? [parts.chaptersLabel, ...parts.chapters.map((c) => `${c.time} ${c.title}`)].join("\n")
        : "",
      sources.length > 0 ? [parts.sourcesLabel, ...sources.map((s) => `• ${s}`)].join("\n") : "",
      parts.hashtags.join(" "),
    ]
      .filter(Boolean)
      .join("\n\n");

  const sources = [...parts.sources];
  while (sources.length > 0 && build(sources).length > DESCRIPTION_MAX) sources.pop();
  return { text: build(sources), droppedSources: parts.sources.length - sources.length };
}
