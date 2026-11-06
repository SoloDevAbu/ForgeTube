---
name: doc-script
description: Write a documentary narration script from approved research and import it into ForgeTube. Use for the script stage of a film.
---

# Write the script

1. Run `bun run bin/video-studio.js script brief -p <id> --chapter <chapter_id>`. Write one chapter at a time.
2. Use the format the brief gives. It's plain Markdown with claim tags, and the CLI builds the JSON.
3. Write for a slow, unhurried voice:
   - Plain, concrete sentences.
   - Tell a story with people and stakes, not a list of dates.
   - Attribute anything legendary ("according to tradition").
   - Use a number only if a cited claim contains it.
   - Add `[pause]` or `[pause 1.5]` where a line should land. Use them sparingly.
4. Run `script import -p <id> -i <file>`. Import adds or replaces only the chapters in the file.
5. Fix errors with `script set-segment`. Don't rewrite whole chapters for small fixes, and don't read back what you wrote.
6. Stop for the user's review, then run `script approve`.

Aim for the word range the brief gives. It sets the film's length at about 130 words a minute.
