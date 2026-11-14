import { ValidationError } from "../../shared/errors.js";

/** What changes when a film is narrated in another language. */
export interface LanguageProfile {
  code: string;
  name: string;
  /** Folder of this language's version inside a topic. */
  folder: string;
  /** Edge TTS voice and delivery. */
  voice: { voice: string; rate: string; pitch: string };
  /** Spoken words per minute of that voice, measured on real takes. */
  speakingRateWpm: number;
  /** Lines added to the script brief. */
  scriptRules: string[];
  /** Phrases that mark a legend or later story as such. Lowercase. */
  attribution: string[];
}

export const LANGUAGES: Record<string, LanguageProfile> = {
  en: {
    code: "en",
    name: "English",
    folder: "english",
    voice: { voice: "en-US-AndrewMultilingualNeural", rate: "+0%", pitch: "+0Hz" },
    speakingRateWpm: 130,
    scriptRules: ["Rules: slow documentary narration, plain spoken English, one idea per sentence."],
    attribution: [],
  },
  hi: {
    code: "hi",
    name: "Hindi",
    folder: "hindi",
    voice: { voice: "hi-IN-MadhurNeural", rate: "+0%", pitch: "+0Hz" },
    speakingRateWpm: 140,
    scriptRules: [
      "Rules: slow documentary narration in plain spoken Hindi, written in Devanagari. One idea per sentence.",
      "Write it as a Hindi storyteller would tell it. Do not translate line by line: reorder, merge or split",
      "segments wherever Hindi flows better. Use everyday Hindustani, not heavy Sanskritised words.",
      "End sentences with the danda (।). Write years and counts as digits (509), never as Devanagari digits.",
      "Keep names as Hindi speakers say them (रोम, जूलियस सीज़र). Chapter titles are in Hindi too.",
    ],
    attribution: [
      "परंपरा",
      "किंवदंती",
      "दंतकथा",
      "पौराणिक",
      "कथा",
      "कहानी",
      "मान्यता",
      "माना जाता",
      "कहा जाता",
      "कहते हैं",
      "बताया जाता",
      "के अनुसार",
      "शायद",
      "संभवतः",
      "कथित",
    ],
  },
};

export const DEFAULT_LANGUAGE = "en";

/** Finds a language by its code ("hi") or its folder name ("hindi"). */
export function getLanguage(code: string | undefined | null): LanguageProfile {
  const wanted = (code ?? DEFAULT_LANGUAGE).toLowerCase();
  const profile = LANGUAGES[wanted] ?? Object.values(LANGUAGES).find((l) => l.folder === wanted);
  if (!profile) {
    const known = Object.values(LANGUAGES).map((l) => l.folder).join(", ");
    throw new ValidationError(`Unknown language "${code}". Use one of: ${known}.`);
  }
  return profile;
}

export const LANGUAGE_FOLDERS = Object.values(LANGUAGES).map((l) => l.folder);
