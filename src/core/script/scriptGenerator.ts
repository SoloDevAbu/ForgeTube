import type { ResearchDossier } from "../schemas/research.js";
import type { ScriptManifest, ScriptChapter, NarrationSegment } from "../schemas/script.js";

/**
 * Calculates estimated narration duration in seconds from word count and speaking rate (WPM).
 */
export function estimateDurationSeconds(text: string, wpm = 140): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return 0;
  // duration in seconds = (words / wpm) * 60
  return Math.round((words / wpm) * 60 * 10) / 10;
}

/**
 * Generates a full script manifest and markdown from a research dossier.
 */
export function generateScriptFromResearch(
  dossier: ResearchDossier,
  targetMinutes: number,
  wpm = 140
): { manifest: ScriptManifest; markdown: string } {
  // If Roman history dossier, generate rich documentary script matching the 6 chapters
  const isRome = dossier.claims.some((c) => c.claim_id === "clm_founding_legend");

  let chapters: ScriptChapter[] = [];

  if (isRome) {
    chapters = [
      {
        chapter_id: "chapter_01",
        chapter_number: 1,
        title: "From Mythic Mud to Republic",
        time_period: "c. 753 BC – 264 BC",
        segments: [
          {
            segment_id: "narration_001",
            chapter_id: "chapter_01",
            segment_number: 1,
            text: "On the mud-soaked banks of the Tiber River, legend tells of twin brothers abandoned to the wild, suckled by a wolf. But behind the myth of Romulus and Remus lies the true archaeological dawn: iron-age shepherd huts clustered upon the Palatine Hill, forged into a sanctuary that would one day command the known world.",
            source_claim_ids: ["clm_founding_legend"],
            estimated_duration_seconds: estimateDurationSeconds(
              "On the mud-soaked banks of the Tiber River, legend tells of twin brothers abandoned to the wild, suckled by a wolf. But behind the myth of Romulus and Remus lies the true archaeological dawn: iron-age shepherd huts clustered upon the Palatine Hill, forged into a sanctuary that would one day command the known world.",
              wpm
            ),
            voice_asset: null,
          },
          {
            segment_id: "narration_002",
            chapter_id: "chapter_01",
            segment_number: 2,
            text: "For more than two centuries, kings held dominion over the fledgling city. But tyranny overreached. In 509 BC, Romans rose in fury, expelling the Etruscan monarch Tarquinius Superbus and swearing an immutable oath: Rome would never again suffer a king. In place of a crown arose the Republic, governed by elected consuls and the venerable Senate under the motto Senatus Populusque Romanus.",
            source_claim_ids: ["clm_monarchy_overthrow"],
            estimated_duration_seconds: estimateDurationSeconds(
              "For more than two centuries, kings held dominion over the fledgling city. But tyranny overreached. In 509 BC, Romans rose in fury, expelling the Etruscan monarch Tarquinius Superbus and swearing an immutable oath: Rome would never again suffer a king. In place of a crown arose the Republic, governed by elected consuls and the venerable Senate under the motto Senatus Populusque Romanus.",
              wpm
            ),
            voice_asset: null,
          },
          {
            segment_id: "narration_003",
            chapter_id: "chapter_01",
            segment_number: 3,
            text: "Inscribed upon twelve bronze tablets in the Forum, the Law of the Twelve Tables established equal civic rights and procedural justice. With legal cohesion and unwavering citizen-militia legions, the young Republic systematically defeated its Latin, Etruscan, and Samnite rivals, securing mastery over the Italian peninsula.",
            source_claim_ids: ["clm_twelve_tables"],
            estimated_duration_seconds: estimateDurationSeconds(
              "Inscribed upon twelve bronze tablets in the Forum, the Law of the Twelve Tables established equal civic rights and procedural justice. With legal cohesion and unwavering citizen-militia legions, the young Republic systematically defeated its Latin, Etruscan, and Samnite rivals, securing mastery over the Italian peninsula.",
              wpm
            ),
            voice_asset: null,
          },
        ],
      },
      {
        chapter_id: "chapter_02",
        chapter_number: 2,
        title: "The Mediterranean Crucible",
        time_period: "264 BC – 146 BC",
        segments: [
          {
            segment_id: "narration_004",
            chapter_id: "chapter_02",
            segment_number: 1,
            text: "Looking across the Straits of Messina, Rome met its supreme existential adversary: Carthage, the maritime titan of North Africa. For over a century across three grueling Punic Wars, the Mediterranean ran red with blood.",
            source_claim_ids: ["clm_punic_wars"],
            estimated_duration_seconds: estimateDurationSeconds(
              "Looking across the Straits of Messina, Rome met its supreme existential adversary: Carthage, the maritime titan of North Africa. For over a century across three grueling Punic Wars, the Mediterranean ran red with blood.",
              wpm
            ),
            voice_asset: null,
          },
          {
            segment_id: "narration_005",
            chapter_id: "chapter_02",
            segment_number: 2,
            text: "Hannibal Barca marched war elephants across the treacherous snows of the Alps, dealing Rome catastrophic defeats at Trebia, Lake Trasimene, and the slaughter of Cannae. Yet Rome refused surrender. Adapting with ruthless resilience under Scipio Africanus, Roman legions carried the war to African soil, crushing Carthage at Zama and razing its walls in 146 BC.",
            source_claim_ids: ["clm_punic_wars"],
            estimated_duration_seconds: estimateDurationSeconds(
              "Hannibal Barca marched war elephants across the treacherous snows of the Alps, dealing Rome catastrophic defeats at Trebia, Lake Trasimene, and the slaughter of Cannae. Yet Rome refused surrender. Adapting with ruthless resilience under Scipio Africanus, Roman legions carried the war to African soil, crushing Carthage at Zama and razing its walls in 146 BC.",
              wpm
            ),
            voice_asset: null,
          },
        ],
      },
      {
        chapter_id: "chapter_03",
        chapter_number: 3,
        title: "The Fall of the Republic",
        time_period: "133 BC – 31 BC",
        segments: [
          {
            segment_id: "narration_006",
            chapter_id: "chapter_03",
            segment_number: 1,
            text: "Conquest brought untold wealth, but also the seeds of ruin. Vast plantations worked by enslaved captives bankrupted free Roman farmers, sparking violent class conflict. When Gaius Marius eliminated property requirements for army recruits, legions became loyal not to the Senate, but to ambitious commanders.",
            source_claim_ids: ["clm_marian_reforms"],
            estimated_duration_seconds: estimateDurationSeconds(
              "Conquest brought untold wealth, but also the seeds of ruin. Vast plantations worked by enslaved captives bankrupted free Roman farmers, sparking violent class conflict. When Gaius Marius eliminated property requirements for army recruits, legions became loyal not to the Senate, but to ambitious commanders.",
              wpm
            ),
            voice_asset: null,
          },
          {
            segment_id: "narration_007",
            chapter_id: "chapter_03",
            segment_number: 2,
            text: "In 49 BC, Gaius Julius Caesar reached the shallow Rubicon river. Declaring 'the die is cast', he crossed with the 13th Legion, igniting civil war. Caesar seized absolute power as dictator perpetuo, only to be struck down by senators on the Ides of March in 44 BC. But freedom could not be restored by assassination; it only unleashed the final death throes of the Republic.",
            source_claim_ids: ["clm_caesar_crossing_rubicon"],
            estimated_duration_seconds: estimateDurationSeconds(
              "In 49 BC, Gaius Julius Caesar reached the shallow Rubicon river. Declaring 'the die is cast', he crossed with the 13th Legion, igniting civil war. Caesar seized absolute power as dictator perpetuo, only to be struck down by senators on the Ides of March in 44 BC. But freedom could not be restored by assassination; it only unleashed the final death throes of the Republic.",
              wpm
            ),
            voice_asset: null,
          },
        ],
      },
      {
        chapter_id: "chapter_04",
        chapter_number: 4,
        title: "The Pax Romana & Imperial Peak",
        time_period: "27 BC – 180 AD",
        segments: [
          {
            segment_id: "narration_008",
            chapter_id: "chapter_04",
            segment_number: 1,
            text: "Out of the ashes of civil war stepped Caesar's adopted son, Octavian. In 27 BC, he accepted the title Augustus. Preserving republican facades while concentrating supreme authority, Augustus became Rome's first emperor, declaring that he found Rome a city of brick and left it a city of marble.",
            source_claim_ids: ["clm_augustan_principate"],
            estimated_duration_seconds: estimateDurationSeconds(
              "Out of the ashes of civil war stepped Caesar's adopted son, Octavian. In 27 BC, he accepted the title Augustus. Preserving republican facades while concentrating supreme authority, Augustus became Rome's first emperor, declaring that he found Rome a city of brick and left it a city of marble.",
              wpm
            ),
            voice_asset: null,
          },
          {
            segment_id: "narration_009",
            chapter_id: "chapter_04",
            segment_number: 2,
            text: "For two centuries, the Pax Romana united over fifty million souls across three continents. Engineered Roman aqueducts, stone-paved highways, amphitheaters, and bathhouses spread from the Scottish border to the sands of the Euphrates, guarded by disciplined legions and flourishing trade.",
            source_claim_ids: ["clm_pax_romana"],
            estimated_duration_seconds: estimateDurationSeconds(
              "For two centuries, the Pax Romana united over fifty million souls across three continents. Engineered Roman aqueducts, stone-paved highways, amphitheaters, and bathhouses spread from the Scottish border to the sands of the Euphrates, guarded by disciplined legions and flourishing trade.",
              wpm
            ),
            voice_asset: null,
          },
        ],
      },
      {
        chapter_id: "chapter_05",
        chapter_number: 5,
        title: "Crisis, Division, and the Cross",
        time_period: "180 AD – 337 AD",
        segments: [
          {
            segment_id: "narration_010",
            chapter_id: "chapter_05",
            segment_number: 1,
            text: "Following the death of philosopher-emperor Marcus Aurelius, the empire plummeted into chaos. The Crisis of the Third Century witnessed over twenty emperors proclaimed and murdered in fifty years, as barbarian invasions, runaway inflation, and catastrophic plague nearly shattered the Roman world.",
            source_claim_ids: ["clm_third_century_crisis"],
            estimated_duration_seconds: estimateDurationSeconds(
              "Following the death of philosopher-emperor Marcus Aurelius, the empire plummeted into chaos. The Crisis of the Third Century witnessed over twenty emperors proclaimed and murdered in fifty years, as barbarian invasions, runaway inflation, and catastrophic plague nearly shattered the Roman world.",
              wpm
            ),
            voice_asset: null,
          },
          {
            segment_id: "narration_011",
            chapter_id: "chapter_05",
            segment_number: 2,
            text: "Order was restored by Diocletian through iron-fisted centralization and the division of imperial power into the Tetrarchy. Soon after, Constantine transformed history: legalizing Christianity through the Edict of Milan in 313 AD and inaugurating Constantinople as the imperial jewel of the East.",
            source_claim_ids: ["clm_diocletian_tetrarchy", "clm_christianization_constantine"],
            estimated_duration_seconds: estimateDurationSeconds(
              "Order was restored by Diocletian through iron-fisted centralization and the division of imperial power into the Tetrarchy. Soon after, Constantine transformed history: legalizing Christianity through the Edict of Milan in 313 AD and inaugurating Constantinople as the imperial jewel of the East.",
              wpm
            ),
            voice_asset: null,
          },
        ],
      },
      {
        chapter_id: "chapter_06",
        chapter_number: 6,
        title: "The Sunset of the West & Enduring Legacy",
        time_period: "376 AD – 476 AD & Legacy",
        segments: [
          {
            segment_id: "narration_012",
            chapter_id: "chapter_06",
            segment_number: 1,
            text: "By the fifth century, the Western Empire strained under internal economic collapse and waves of migrating Germanic confederations. In 410 and 455 AD, Rome was sacked. Finally, in 476 AD, Germanic chieftain Odoacer deposed the teenage emperor Romulus Augustulus in Ravenna, extinguishing the Western imperial line.",
            source_claim_ids: ["clm_western_collapse"],
            estimated_duration_seconds: estimateDurationSeconds(
              "By the fifth century, the Western Empire strained under internal economic collapse and waves of migrating Germanic confederations. In 410 and 455 AD, Rome was sacked. Finally, in 476 AD, Germanic chieftain Odoacer deposed the teenage emperor Romulus Augustulus in Ravenna, extinguishing the Western imperial line.",
              wpm
            ),
            voice_asset: null,
          },
          {
            segment_id: "narration_013",
            chapter_id: "chapter_06",
            segment_number: 2,
            text: "Yet Rome never truly vanished. The Eastern Empire in Constantinople endured for another thousand years. In our legal codes, republican ideals, architectural monuments, Romance languages, and Western consciousness, the eternal city lives on: an enduring testament to the heights and frailties of human civilization.",
            source_claim_ids: ["clm_western_collapse"],
            estimated_duration_seconds: estimateDurationSeconds(
              "Yet Rome never truly vanished. The Eastern Empire in Constantinople endured for another thousand years. In our legal codes, republican ideals, architectural monuments, Romance languages, and Western consciousness, the eternal city lives on: an enduring testament to the heights and frailties of human civilization.",
              wpm
            ),
            voice_asset: null,
          },
        ],
      },
    ];
  } else {
    // Arbitrary research topic: map chapters and claims into structured segments
    chapters = dossier.chapters.map((ch, idx) => {
      const segId = `narration_${String(idx + 1).padStart(3, "0")}`;
      const relevantClaims = dossier.claims.slice(idx * 2, idx * 2 + 2);
      const claimIds = relevantClaims.length > 0 ? relevantClaims.map((c) => c.claim_id) : [dossier.claims[0]!.claim_id];
      const text = `${ch.title}: ${ch.summary}`;
      return {
        chapter_id: ch.chapter_id,
        chapter_number: ch.chapter_number,
        title: ch.title,
        time_period: ch.time_period,
        segments: [
          {
            segment_id: segId,
            chapter_id: ch.chapter_id,
            segment_number: 1,
            text,
            source_claim_ids: claimIds,
            estimated_duration_seconds: estimateDurationSeconds(text, wpm),
            voice_asset: null,
          },
        ],
      };
    });
  }

  // Calculate totals
  let totalWordCount = 0;
  let estimatedTotalDurationSeconds = 0;

  for (const ch of chapters) {
    for (const seg of ch.segments) {
      const words = seg.text.trim().split(/\s+/).filter(Boolean).length;
      totalWordCount += words;
      estimatedTotalDurationSeconds += seg.estimated_duration_seconds;
    }
  }

  const manifest: ScriptManifest = {
    schemaVersion: 1,
    totalWordCount,
    estimatedTotalDurationSeconds: Math.round(estimatedTotalDurationSeconds * 10) / 10,
    targetMinutes,
    chapters,
    status: "draft",
    updatedAt: new Date().toISOString(),
  };

  // Build markdown representation
  let markdown = `# ${dossier.topic}\n\n`;
  markdown += `*Target Runtime: ${targetMinutes} minutes | Estimated Duration: ${manifest.estimatedTotalDurationSeconds}s | Word Count: ${totalWordCount} words*\n\n`;

  for (const ch of chapters) {
    markdown += `## Chapter ${ch.chapter_number}: ${ch.title} (${ch.time_period})\n\n`;
    for (const seg of ch.segments) {
      markdown += `> [Segment: ${seg.segment_id} | Claims: ${seg.source_claim_ids.join(", ")} | ~${seg.estimated_duration_seconds}s]\n\n`;
      markdown += `${seg.text}\n\n`;
    }
  }

  return { manifest, markdown };
}

