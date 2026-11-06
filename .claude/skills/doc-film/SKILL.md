---
name: doc-film
description: Make a history documentary from a topic with ForgeTube, stage by stage, stopping at each approval gate. Use when asked to make, continue or finish a documentary or film.
---

# Make a documentary

Run commands with `bun run bin/video-studio.js`, shortened here to `vs`.

1. Run `vs doctor` once, then `vs project create --name "<name>" --topic "<topic>" --target-minutes <n>`.
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
   - `vs audio music scan`, then `vs audio music plan -p <id>`
   - Show the user the plan. They can override with `vs audio music set`.
   - `vs audio mix -p <id>`
   - Check balance with the earshot tools on `editing/mix.wav`, not by guessing.
9. Render:
   - `vs render -p <id> --mode draft`. Stop for the user to review the draft.
   - `vs audio approve -p <id>`, then `vs render -p <id> --mode final`.

Never claim how something sounds or looks without a reading or an image you checked.
