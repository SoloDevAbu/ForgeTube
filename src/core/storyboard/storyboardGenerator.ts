import type { ScriptManifest } from "../schemas/script.js";
import type { ResearchDossier } from "../schemas/research.js";
import type {
  StoryboardManifest,
  SceneRecord,
  ImagePrompt,
  VisualStyleGuide,
} from "../schemas/storyboard.js";
import type { CameraEffect, TransitionType } from "../../shared/types.js";

export function generateStoryboardFromScript(
  script: ScriptManifest,
  dossier: ResearchDossier
): StoryboardManifest {
  const visualStyleGuide: VisualStyleGuide = {
    schemaVersion: 1,
    artisticDirection:
      "Photorealistic, source-faithful historical cinematography. Authentic textures, atmospheric volume lighting, tactile surfaces, non-digital grain.",
    clothingAndArmor:
      "Strict period-accurate woolen tunics, linen drapery, lorica hamata (chainmail) for Republic, lorica segmentata for Principate, authentic Roman scutum shields and Montefortino/Galea helmets. Avoid fantasy or anachronistic Hollywood leather armor.",
    architectureAndEnvironment:
      "Archaic wattle-and-daub huts for 8th c. BC, tuff and terracotta for early Republic, travertine and Carrara marble with vibrant polychrome pigment for Empire, monumental arches, paved basalt roads.",
    colorPaletteAndLighting:
      "Warm Mediterranean sunlight, terra cotta reds, Tyrian purple accents, bronze patina, atmospheric twilight, dramatic chiaroscuro for interior scenes.",
    cameraAndComposition:
      "Cinematic 16:9 widescreen composition, rule of thirds, deep focal depth, atmospheric dust particles, natural lens perspective.",
    negativePromptRules: [
      "modern buildings",
      "automobiles",
      "paved asphalt",
      "wristwatches",
      "sunglasses",
      "modern synthetic fabrics",
      "fantasy spikes",
      "text",
      "subtitles",
      "watermark",
      "logo",
      "distorted anatomy",
      "extra limbs",
      "blurry",
      "low resolution",
    ],
    continuityRules: [
      "Maintain consistent Mediterranean architectural materials across Italian scenes.",
      "Legionary armor must chronologically evolve across chapters from bronze breastplates to iron segmentata.",
      "Senate curia scenes must maintain consistent marble column order and toga drapery.",
    ],
  };

  const scenes: SceneRecord[] = [];
  const prompts: ImagePrompt[] = [];

  let sceneCounter = 1;

  for (const ch of script.chapters) {
    for (const seg of ch.segments) {
      const sceneId = `scene_${String(sceneCounter).padStart(3, "0")}`;
      const promptId = `prompt_${sceneId}`;
      const outputFilename = `${sceneId}.png`;

      // Select camera effect and transition based on narrative flow
      let cameraEffect: CameraEffect = "slow_zoom_in";
      let transitionType: TransitionType = "cross_dissolve";

      if (sceneCounter % 4 === 1) cameraEffect = "slow_zoom_in";
      else if (sceneCounter % 4 === 2) cameraEffect = "pan_right";
      else if (sceneCounter % 4 === 3) cameraEffect = "cinematic_drift";
      else cameraEffect = "slow_zoom_out";

      if (sceneCounter === 1) transitionType = "cut";
      else if (sceneCounter % 3 === 0) transitionType = "cross_dissolve";
      else transitionType = "cross_dissolve";

      // Build scene purpose and prompt
      const visualPurpose = `Visually immerse the viewer in ${ch.title} during ${ch.time_period}, reinforcing: "${seg.text.slice(0, 80)}..."`;

      const promptText = buildDetailedPrompt({
        sceneId,
        chapter: ch.title,
        timePeriod: ch.time_period,
        narration: seg.text,
        sceneNumber: sceneCounter,
      });

      const negativePrompt = visualStyleGuide.negativePromptRules.join(", ");

      const imagePrompt: ImagePrompt = {
        promptId,
        sceneId,
        outputFilename,
        aspectRatio: "16:9",
        prompt: promptText,
        negativePrompt,
        referenceAssets: [],
        continuityNotes: `Ensure 16:9 aspect ratio and seamless visual continuity with chapter ${ch.chapter_number} lighting.`,
        status: "ready_for_manual_generation",
      };

      prompts.push(imagePrompt);

      const sceneRecord: SceneRecord = {
        schemaVersion: 1,
        sceneId,
        sceneNumber: sceneCounter,
        chapterId: ch.chapter_id,
        title: `${ch.title} - Scene ${sceneCounter}`,
        narrationSegmentIds: [seg.segment_id],
        narration: seg.text,
        visualPurpose,
        suggestedDurationSeconds: Math.max(4.0, seg.estimated_duration_seconds),
        actualVoiceDurationFrames: null,
        timeline: {
          startFrame: null,
          endFrame: null,
          durationFrames: null,
          fps: 30,
        },
        visual: {
          type: "image",
          image: `assets/generated/${outputFilename}`,
          fit: "cover",
          crop: null,
        },
        camera: {
          effect: cameraEffect,
          intensity: 0.08,
          origin: "center",
          direction: null,
        },
        transition: {
          type: transitionType,
          durationSeconds: 0.5,
        },
        audio: {
          voice: `assets/voice/${sceneId}.wav`,
          soundEffects: [],
        },
        imagePromptId: promptId,
        sourceClaimIds: seg.source_claim_ids,
        status: {
          image: "missing",
          calibration: "not_started",
          audio: "missing",
          review: "needs_review",
        },
      };

      scenes.push(sceneRecord);
      sceneCounter++;
    }
  }

  return {
    schemaVersion: 1,
    scenes,
    visualStyleGuide,
    prompts,
    status: "draft",
    updatedAt: new Date().toISOString(),
  };
}

function buildDetailedPrompt(opts: {
  sceneId: string;
  chapter: string;
  timePeriod: string;
  narration: string;
  sceneNumber: number;
}): string {
  return [
    `Cinematic 16:9 widescreen master shot representing ${opts.chapter} (${opts.timePeriod}).`,
    `Subject: Historically accurate scene illustrating: "${opts.narration}".`,
    `Environment: Authentic ancient architectural landscape, atmospheric volumetric haze, warm Mediterranean sunlight, dusty ground, weathered materials.`,
    `Styling: Hyper-detailed photorealism, award-winning historical documentary cinematography, natural color grading, Hasselblad lens depth of field, 8k resolution textures.`,
    `Composition: Balanced 16:9 framing with clear focal subject in upper thirds, epic scale, cinematic depth.`,
  ].join(" ");
}

