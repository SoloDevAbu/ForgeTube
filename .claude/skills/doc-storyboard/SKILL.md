---
name: doc-storyboard
description: Plan a documentary's shots and Google Flow image prompts from an approved script and import them into ForgeTube. Use for the storyboard stage of a film.
---

# Write the storyboard

1. Run `bun run bin/video-studio.js storyboard brief -p <id>`. For a long film, add `--chapter <chapter_id>` and work through chapters.
2. Write the style block once. Name recurring characters and locations there, so prompts can use the names.
3. Write one line per shot, as the brief shows.
   - Each image is on screen for 5 s at most. The brief gives the most words per shot.
   - Vary shot length by context: quick for action, slower for reflection, under 2 s for a fast beat.
   - Prompts are about 35 words: subject, action, setting. The header adds the shared style.
   - Show what the narration is about. Don't paste the narration in.
4. Give each chapter a mood line. It chooses the music, so describe the sound ("slow, reverent strings").
5. Add `sfx=` only at real story beats. Use IDs from `earshot sfx list`. The bank has impacts, whooshes and risers, not ambience.
6. Leave camera and transition out unless the story needs them. The CLI picks good defaults.
7. Run `storyboard import -p <id> -i <file>`, then fix what it prints. Re-importing keeps existing images and crops.
8. Stop for the user's review, then run `storyboard approve` and `prompts export`.

## Second version of a topic

When the other language version already has shots, the brief lists its images by chapter.

- Cut shots to this version's narration. The count and order will differ from the other version.
- For each shot, pick the image that fits and write `= | img=<scene>`. It brings the image and its crop.
- Write a new English prompt, without `img=`, only when no existing image fits. Each one costs the user a new image, so keep them few.
- Don't show the same image twice in a row.
- Leave out the `# style` block to keep the other version's look.

Stills only. Never write prompts for character animation.
