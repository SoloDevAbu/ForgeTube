import { splitWords } from "../src/core/script/scriptFormat.js";

/** The sample film retold in Hindi: five segments where the English has four. */
export const HINDI_SEGMENTS: Record<string, string> = {
  narration_001:
    "आज के बड़े बंदरगाहों से बहुत पहले, मिस्र की ओर जाने वाले नाविकों के सामने एक ऐसा तट आता था जो इतना नीचा और सपाट था कि समुद्र में लगभग खो जाता था। अलेक्जेंड्रिया के शासक टॉलेमी राजाओं ने इस ख़तरे का जवाब एक मीनार से दिया।",
  narration_002:
    "यह मीनार बंदरगाह के मुहाने पर, एक छोटे से द्वीप पर खड़ी की गई। पत्थर पर पत्थर रखकर इसे आसमान की ओर उठाया गया।",
  narration_003:
    "कहा जाता है कि इसकी रोशनी दूर समुद्र से भी दिखाई देती थी। [pause] रात दर रात, जहाज़ अँधेरे पानी के ऊपर जलती आग के एक अकेले बिंदु को देखकर घर का रास्ता पाते थे, और उस द्वीप का नाम ही प्रकाश स्तंभ का दूसरा नाम बन गया।",
  narration_004:
    "लेकिन पत्थर धरती से बहस नहीं कर सकता। सदियों तक भूकंप इस मीनार को बार बार हिलाते रहे, और उन दीवारों में दरारें पड़ती गईं जिन्होंने इतने नाविकों को रात में रास्ता दिखाया था। हर मरम्मत पिछली से छोटी होती गई, और हर पीढ़ी ने इसे खाड़ी के ऊपर थोड़ा और कम खड़ा देखा।",
  narration_005:
    "आख़िर में यह गिर गई। इसके पत्थर लहरों के नीचे सरक गए, और जिस बंदरगाह की इसने रखवाली की थी, वह भूल गया कि यह कभी कितनी ऊँची थी। फिर भी इसका विचार ज़िंदा रहा, और उसके बाद बना हर प्रकाश स्तंभ अँधेरे पानी के पार वही वादा लेकर चलता है।",
};

export function hindiScriptMarkdown(): string {
  return [
    "# Chapter chapter_01: मीनार | third century BC",
    "## narration_001 [clm_built]",
    HINDI_SEGMENTS.narration_001,
    "## narration_002 [clm_built]",
    HINDI_SEGMENTS.narration_002,
    "## narration_003 [clm_guide]",
    HINDI_SEGMENTS.narration_003,
    "# Chapter chapter_02: पतन | medieval period",
    "## narration_004 [clm_fell]",
    HINDI_SEGMENTS.narration_004,
    "## narration_005 [clm_fell]",
    HINDI_SEGMENTS.narration_005,
  ].join("\n");
}

export const HINDI_NEW_PROMPT = "A new stone tower rising on a small island at first light";

/**
 * Shots cut about every eight Hindi words. Each reuses a base-film image,
 * except one that asks for a new picture.
 */
export function hindiStoryboardText(baseSceneIds: string[]): string {
  let next = 0;
  const lines = (segmentId: string, newPromptLast = false): string[] => {
    const words = splitWords(HINDI_SEGMENTS[segmentId]!);
    const out: string[] = [];
    const reuse = () => `= | img=${baseSceneIds[next++ % baseSceneIds.length]}`;
    for (let at = 8; at < words.length - 3; at += 8) {
      out.push(`${segmentId} | ${words.slice(at - 3, at).join(" ")} | ${reuse()}`);
    }
    out.push(`${segmentId} | * | ${newPromptLast ? HINDI_NEW_PROMPT : reuse()}`);
    return out;
  };

  return [
    "# style",
    "direction: restrained oil painting of the ancient Mediterranean",
    "wardrobe: plain linen tunics, Hellenistic Egyptian dress",
    "environment: pale limestone, low sandy coast, working harbour",
    "palette: amber firelight against deep blue night",
    "composition: wide shots, low horizon, room for the sky",
    "negative: text, watermark, logo",
    "",
    "# chapter chapter_01 | mood: slow, reverent strings",
    ...lines("narration_001"),
    ...lines("narration_002", true),
    ...lines("narration_003"),
    "",
    "# chapter chapter_02 | mood: dark, sorrowful drones",
    ...lines("narration_004"),
    ...lines("narration_005"),
  ].join("\n");
}
