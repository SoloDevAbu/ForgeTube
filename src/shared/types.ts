export const ProjectStateValues = [
  "NEW",
  "RESEARCH_IN_PROGRESS",
  "RESEARCH_REVIEW",
  "SCRIPT_IN_PROGRESS",
  "SCRIPT_REVIEW",
  "STORYBOARD_IN_PROGRESS",
  "STORYBOARD_REVIEW",
  "WAITING_FOR_MANUAL_IMAGES",
  "ASSETS_IMPORTED",
  "CALIBRATION_COMPLETE",
  "AUDIO_READY",
  "TIMELINE_READY",
  "RENDERING",
  "RENDERED",
  "FAILED",
] as const;

export type ProjectState = (typeof ProjectStateValues)[number];

export const CameraEffectValues = [
  "static",
  "slow_zoom_in",
  "slow_zoom_out",
  "pan_left",
  "pan_right",
  "pan_up",
  "pan_down",
  "cinematic_drift",
] as const;

export type CameraEffect = (typeof CameraEffectValues)[number];

export const TransitionTypeValues = [
  "cut",
  "cross_dissolve",
  "fade_black",
  "fade_white",
] as const;

export type TransitionType = (typeof TransitionTypeValues)[number];

export const FitModeValues = ["cover", "contain", "manual"] as const;
export type FitMode = (typeof FitModeValues)[number];

export const RenderModeValues = ["scene", "draft", "final"] as const;
export type RenderMode = (typeof RenderModeValues)[number];

