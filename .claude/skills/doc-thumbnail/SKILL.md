---
name: doc-thumbnail
description: Plan and render three YouTube thumbnail variants for a finished ForgeTube documentary, from what the top videos on the topic do. Use for the thumbnail stage of a film, or when asked for a thumbnail.
---

# Make the thumbnails

Run commands with `bun run bin/video-studio.js`, shortened here to `vs`. The film should have its final render.

1. Run `vs thumbnail brief -p <id>`.
2. Look at what wins on this topic. Search the web once or twice for the most-viewed YouTube videos on it, in the film's language. For the top 5 to 8, note the subject shown, the words on the image, and the colours. Favour videos with far more views than their channel usually gets. Take the pattern, never the image or the wording.
3. Look at the contact sheets the brief lists, and pick images by the rules below.
4. Write three variants, one line each, as the brief shows. Each variant tests one different idea:
   - A: the pattern the top videos share.
   - B: another subject or another hook.
   - C: the boldest one: a number, a question, or no text at all.
5. Run `vs thumbnail make -p <id> -i <file>`, then fix what it prints.
6. Look at `publish/thumbnails/review.jpg`. The top row is full size. The bottom row is the size a phone shows in a list. Change the plan and run `make` again until all three pass the checks below.
7. Show the user the three files and say what each one tests. Stop for their review.

## The image

- One subject, filling a third of the frame or more. A face with a clear emotion is best: a person or a statue, close up. Next best is one monument or one object.
- Three elements at most: the subject, the text, the background.
- Skip wide battles, crowds, maps and any image with words drawn in it. They turn to noise at phone size.
- Set `focus=` on the subject's face or centre. The layout moves it away from the text. Raise `zoom=` until the subject is large.
- If no shot has one strong subject, write one Google Flow prompt in the film's style: a close-up of one subject, set to one side, with plain dark space on the other side, 16:9, no text. Ask the user for that image, then use it with `file=`.

## The text

- 2 to 4 words. Never a sentence.
- It adds the hook. It does not repeat the title. The title names the subject; the thumbnail gives the stakes, the number or the question.
- Mark the one word that carries the weight with `*word*`. Use one accent colour.
- It must be true to the film. Use only what the approved script says.
- Hindi films take Hindi text in Devanagari. Keep it to short, common words.

## Checks on the review sheet

- In the small row, can you read every word and name the subject at a glance?
- Does the text stand clear of the subject's face?
- Do the three look different from each other, and from the top videos you found?
- Is anything cut off at an edge?

Never say a thumbnail reads well without looking at the review sheet.
