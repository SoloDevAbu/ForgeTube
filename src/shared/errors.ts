export class BaseAppError extends Error {
  public readonly code: string;
  public readonly details?: unknown;

  constructor(message: string, code = "APP_ERROR", details?: unknown) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
  }
}

export class ProjectNotFoundError extends BaseAppError {
  constructor(projectId: string) {
    super(`Project not found: "${projectId}"`, "PROJECT_NOT_FOUND", { projectId });
  }
}

export class ValidationError extends BaseAppError {
  constructor(message: string, details?: unknown) {
    super(message, "VALIDATION_ERROR", details);
  }
}

export class StateTransitionError extends BaseAppError {
  constructor(current: string, attempted: string, reason?: string) {
    super(
      `Cannot transition project from state "${current}" to "${attempted}"${reason ? `: ${reason}` : ""}`,
      "INVALID_STATE_TRANSITION",
      { current, attempted, reason }
    );
  }
}

export class AssetError extends BaseAppError {
  constructor(message: string, details?: unknown) {
    super(message, "ASSET_ERROR", details);
  }
}

export class TimelineError extends BaseAppError {
  constructor(message: string, details?: unknown) {
    super(message, "TIMELINE_ERROR", details);
  }
}

export class RenderError extends BaseAppError {
  constructor(message: string, details?: unknown) {
    super(message, "RENDER_ERROR", details);
  }
}

export class ProviderError extends BaseAppError {
  constructor(message: string, details?: unknown) {
    super(message, "PROVIDER_ERROR", details);
  }
}

