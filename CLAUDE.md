# ForgeTube

Local CLI that makes 10–15 minute history documentaries: 1920×1080, 30 fps, H.264. Claude Code writes the words; the CLI validates, times, mixes and renders.

## Rules

- Runtime is Bun, for the CLI, scripts, tests and packages. Only `src/render-worker/render.mjs` runs on Node, because Remotion times out in-process under Bun.
- CLI only. No server, no database. State is JSON in `projects/<id>/`.
- Images are stills. No character animation. Subtle camera moves only.
- An image lasts 5 s at most. Usually 2–5 s, sometimes under 2 s.
- Never overwrite originals. Imports are versioned.
- Timing comes from measured voice, never estimates, in the final render.
- Commit or push only when asked.

## Commands

```bash
bun run bin/video-studio.js doctor
bun run bin/video-studio.js pipeline status -p <id>
bun run bin/video-studio.js project status --project <id>
```

```bash
bun run typecheck
bun test tests/unit
bun run test:e2e
```

## Stages

Run `/doc-film` to go through them, or use each skill alone.

| Stage | Written by | Commands |
|---|---|---|
| Research | `doc-research` skill | `research brief`, `import`, `approve` |
| Script | `doc-script` skill | `script brief`, `import`, `set-segment`, `approve` |
| Storyboard | `doc-storyboard` skill | `storyboard brief`, `import`, `approve`; `prompts export` |
| Images | You, in Google Flow | `assets import --order`; `calibration apply-preset`, `contact-sheet`, `approve` |
| Voice | Code | `audio voice`, then `timeline compile`, `storyboard rebalance` |
| Sound | Code | `audio sfx render`, `audio music scan`, `audio music plan`, `audio mix`, `audio approve` |
| Render | Code | `render --mode scene`, `draft`, `final` |

Each stage records a hash of its inputs. When an input changes, later stages show as stale in `pipeline status`, and their work is kept.

## Token rules

- Run research once, with 8–12 sources. Later stages read the claim list, not the pages.
- Write one chapter at a time, using the compact formats the briefs describe.
- Change one segment with `script set-segment`. Never rewrite the script for a small fix.
- Never write IDs, filenames, timing or JSON that the CLI derives.
- Read CLI output, not project JSON. Commands print only problems. Use `--json` only when you need it.
- Voice, music choice, timeline, mix and render use no LLM.
- Review images with contact sheets, and audio with earshot numbers.
- Don't start subagents unless asked.

## Local setup

`forgetube.config.json` (git-ignored) holds tool paths:

```json
{ "python": "<python with edge_tts>", "earshot": "<earshot launcher>" }
```

`FORGETUBE_PYTHON`, `FORGETUBE_EARSHOT`, `FORGETUBE_NODE`, `FORGETUBE_MUSIC_DIR` and `BROWSER_EXECUTABLE` override it. FFmpeg 7 or newer is required.
