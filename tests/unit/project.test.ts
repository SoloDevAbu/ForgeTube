import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ProjectManager } from "../../src/core/projects/projectManager.js";
import { resolveSafeProjectPath, toProjectRelativePath, PathTraversalError } from "../../src/shared/paths.js";

describe("ProjectManager & Path utilities", () => {
  let tmpDir: string;
  let pm: ProjectManager;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "forgetube-test-"));
    pm = new ProjectManager(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates a new project and saves valid project.json", async () => {
    const project = await pm.createProject({
      name: "History of Rome",
      topic: "The complete history of Rome",
      targetMinutes: 12,
    });

    expect(project.id).toBe("history_of_rome/english");
    expect(project.status).toBe("NEW");
    expect(project.name).toBe("History of Rome");
    expect(project.settings.fps).toBe(30);

    // Verify reopen
    const loaded = await pm.loadProject("history_of_rome");
    expect(loaded.id).toBe("history_of_rome/english");
    expect(loaded.topic).toBe("The complete history of Rome");
  });

  it("lists projects correctly", async () => {
    await pm.createProject({ name: "Rome Project", topic: "Rome" });
    await pm.createProject({ name: "Egypt Project", topic: "Egypt" });

    const list = await pm.listProjects();
    expect(list.length).toBe(2);
    expect(list.map((p) => p.name)).toContain("Rome Project");
    expect(list.map((p) => p.name)).toContain("Egypt Project");
  });

  it("prevents path traversal outside project root", () => {
    const root = path.join(tmpDir, "sample_project");
    expect(() => {
      resolveSafeProjectPath(root, "../../etc/passwd");
    }).toThrow(PathTraversalError);

    expect(() => {
      toProjectRelativePath(root, "C:\\Windows\\System32");
    }).toThrow(PathTraversalError);
  });

  it("reports project status accurately", async () => {
    await pm.createProject({ name: "Status Test", topic: "Testing status" });
    const status = await pm.getProjectStatus("status_test");
    expect(status.status).toBe("NEW");
    expect(status.nextCommand).toContain("research brief");
  });
});

