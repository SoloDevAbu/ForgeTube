# ForgeTube

Local CLI that makes 10–15 minute history documentaries: 1920×1080, 30 fps, H.264. Claude Code writes the words; the CLI validates, times, mixes and renders. A topic can be made in English, in Hindi, or both.

## Rules

- Runtime is Bun, for the CLI, scripts, tests and packages. Only `src/render-worker/render.mjs` runs on Node, because Remotion times out in-process under Bun.
- CLI only. No server, no database. State is JSON in `projects/<topic>/<language>/`.
- Images are stills. No character animation. Subtle camera moves only.
- An image lasts 5 s at most. Usually 2–5 s, sometimes under 2 s.
- Never overwrite originals. Imports are versioned.
- Timing comes from measured voice, never estimates, in the final render.
- Music and effects stay far under the voice. Check levels by measurement, never raise them by ear.
- Commit or push only when asked.

## Commands

```bash
bun run bin/video-studio.js doctor
bun run bin/video-studio.js pipeline status -p <topic>/<language>
bun run bin/video-studio.js project status -p <topic>/<language>
```

```bash
bun run typecheck
bun test tests/unit
bun run test:e2e
```

## Topics and versions

```
projects/<topic>/
  research/   the dossier, written and approved once for the topic
  english/    one version: script, storyboard, assets, editing, render
  hindi/      another version, only if asked for
```

- A project ID is `<topic>/<language>`, for example `-p ancient_rome/hindi`. A topic with one version also answers to `-p ancient_rome`.
- Start a topic in either language: `project create --name <name> --topic <topic> --lang english|hindi`.
- Add the other language only when the user asks: `project add-version -p <topic> --lang hindi|english`. Never start it on your own after finishing the first.
- Work on one version at a time, through to its render.
- The second version reuses the research and its approval. Don't research or fact-check again.
- Its script is a retelling, not a translation. Its brief shows how the first version tells each chapter. Segment and shot counts may differ.
- Its storyboard reuses the first version's images with `img=<scene>` and a prompt of `=`, in whatever order its own script needs. Only shots without `img=` need a new image.
- Hindi voice is `hi-IN-MadhurNeural`. Change voice or speed with `project set-voice`.

## Stages

Run `/doc-film` to go through them, or use each skill alone.

| Stage | Written by | Commands |
|---|---|---|
| Research | `doc-research` skill | `research brief`, `import`, `approve` |
| Script | `doc-script` skill | `script brief`, `import`, `set-segment`, `approve` |
| Storyboard | `doc-storyboard` skill | `storyboard brief`, `import`, `approve`; `prompts export` |
| Images | You, in Google Flow | `assets import --order`; `calibration apply-preset`, `contact-sheet`, `approve` |
| Voice | Code | `audio voice`, then `timeline compile`, `storyboard rebalance` |
| Sound | Code | `audio sfx render`, `audio music generate`, `audio music plan`, `audio levels`, `audio mix`, `audio approve` |
| Render | Code | `render --mode scene`, `draft`, `final` |
| Thumbnails | `doc-thumbnail` skill | `thumbnail brief`, `make` |
| Publish | `doc-publish` skill | `publish brief`, `import`, `pack` |

The upload package goes to `publish/`: three thumbnails, three titles, the description with chapters and hashtags, tags, `subtitles.srt` and `transcript.txt`. Subtitle and chapter times come from the measured voice.

Each stage records a hash of its inputs. When an input changes, later stages show as stale in `pipeline status`, and their work is kept.

## Token rules

- Run research once, with 8–12 sources. Later stages read the claim list, not the pages.
- Write one chapter at a time, using the compact formats the briefs describe.
- Change one segment with `script set-segment`. Never rewrite the script for a small fix.
- Never write IDs, filenames, timing or JSON that the CLI derives.
- Read CLI output, not project JSON. Commands print only problems. Use `--json` only when you need it.
- Voice, music choice, timeline, mix and render use no LLM.
- Review images with contact sheets, thumbnails with `publish/thumbnails/review.jpg`, and audio with earshot numbers.
- For thumbnails and titles, search the web once or twice for the top videos on the topic. Write from the publish brief, not the script.
- For a second version, read the chapter brief. It already carries the first version's telling and its images.
- Don't start subagents unless asked.

## Local setup

`forgetube.config.json` (git-ignored) holds tool paths:

```json
{ "python": "<python with edge_tts>", "earshot": "<earshot launcher>" }
```

`audio music generate` makes the background beds in code with earshot's synthesis toolkit, into `music/earshot/`. Your own tracks in `music/` are used the same way.

`FORGETUBE_PYTHON`, `FORGETUBE_EARSHOT`, `FORGETUBE_NODE`, `FORGETUBE_MUSIC_DIR` and `BROWSER_EXECUTABLE` override it. FFmpeg 7 or newer is required.
