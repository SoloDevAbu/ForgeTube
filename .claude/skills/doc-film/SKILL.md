---
name: doc-film
description: Make a history documentary from a topic with ForgeTube, stage by stage, stopping at each approval gate. Use when asked to make, continue or finish a documentary or film.
---

# Make a documentary

Run commands with `bun run bin/video-studio.js`, shortened here to `vs`.

`<id>` is `<topic>/<language>`, for example `ancient_rome/english` or `ancient_rome/hindi`. Make one version at a time, all the way to its render. Ask which language if the user didn't say.

1. Run `vs doctor` once, then `vs project create --name "<name>" --topic "<topic>" --target-minutes <n> --lang english|hindi`.
   For an existing project, run `vs pipeline status -p <id>` and continue from the first stage that isn't approved or is stale.
2. Use the `doc-research` skill. Stop for the user's approval.
3. Use the `doc-script` skill. Stop for the user's approval.
4. Use the `doc-storyboard` skill. Stop for the user's approval, then run `vs prompts export -p <id>`.
5. Tell the user where the prompt batches are, and wait for their Google Flow images.
6. Prepare images:
   - `vs assets import -p <id> --input <dir> --order`
   - `vs calibration apply-preset -p <id> --preset gemini-watermark`
   - `vs calibration contact-sheet -p <id>`, then look at the sheets for watermarks, bad crops and black edges.
   - Fix single scenes with `vs calibration set -p <id> -s <scene> -x <0-1> -y <0-1> -z <zoom>`.
   - Stop for the user's approval, then `vs calibration approve -p <id>`.
7. Voice and timing:
   - `vs audio voice -p <id>`
   - `vs timeline compile -p <id>`
   - If shots are too long, run `vs storyboard rebalance -p <id>`, then compile again.
   - Any shot it can't fix needs another image: split it in the storyboard, re-import, and ask the user for that image.
8. Sound:
   - `vs audio sfx render -p <id>`
   - `vs audio music generate` once, if `music/` has no tracks. It makes quiet pad beds with earshot.
   - `vs audio music plan -p <id>`. Show the user the plan. They can override with `vs audio music set`.
   - `vs audio mix -p <id>`
   - Music and effects must stay far under the voice. Read `vs audio levels -p <id>`, and measure `editing/stems/voice.wav` against `music.wav` and `sfx.wav` with earshot `measure`. Never raise them by guess.
9. Render:
   - `vs render -p <id> --mode draft`. Stop for the user to review the draft.
   - `vs audio approve -p <id>`, then `vs render -p <id> --mode final`.
10. Upload package, once the final render is done:
   - Use the `doc-thumbnail` skill. Stop for the user's review of the three thumbnails.
   - Use the `doc-publish` skill for three titles, the description, hashtags, tags, subtitles and transcript.

## A second language version

Only when the user asks for it. Never start it yourself after the first version is done. It works in either direction: Hindi after English, or English after Hindi.

1. `vs project add-version -p <topic> --lang hindi|english` creates `<topic>/<language>`. The research is the topic's and stays approved, so skip step 2.
2. Use the `doc-script` skill on the new ID. The brief shows how the first version tells each chapter. Stop for approval.
3. Use the `doc-storyboard` skill on the new ID. Reuse the first version's images with `img=`, in the order this script needs. Stop for approval, then `vs prompts export -p <id>`.
4. If it lists prompts, the user makes only those images, then `vs assets import -p <id> --input <dir> --order`.
5. `vs calibration contact-sheet -p <id>`, check the sheets, then `vs calibration approve -p <id>`. Crops come with the reused images.
6. Continue from step 7 above. Run `vs storyboard rebalance` after the first compile: words fall differently in each language.
7. Its upload package is its own: thumbnail text, titles, description and tags are written again in its language.

Never claim how something sounds or looks without a reading or an image you checked.
