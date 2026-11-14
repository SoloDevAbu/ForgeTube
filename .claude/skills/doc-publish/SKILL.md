---
name: doc-publish
description: Write three YouTube titles, the description, hashtags and tags for a finished ForgeTube documentary, and pack them with timed subtitles and a transcript for upload. Use for the publish stage of a film, or when asked for titles, a description, tags or subtitles.
---

# Write the upload package

Run commands with `bun run bin/video-studio.js`, shortened here to `vs`. Make the thumbnails first with the `doc-thumbnail` skill, so the titles can work with them.

1. Run `vs publish brief -p <id>`. It has the chapters, the opening and the thumbnail texts. Don't read the script again.
2. Search the web once or twice for the most-viewed YouTube videos on the topic, in the film's language. Note how the top titles are built and which words they share. Reuse the search from the thumbnail stage if you just ran it. Take the pattern, never the wording.
3. Write the file in the format the brief shows.
4. Run `vs publish import -p <id> -i <file>`, then fix what it prints.
5. Run `vs publish pack -p <id>`. It writes the files into `publish/` and times the subtitles and chapters from the measured voice.
6. Show the user the three titles and where the folder is. Stop for their review.

## Titles

Write three, each built a different way, so a test between them teaches something:

- One led by what people search: the subject first, then the scope. "The Entire History of Rome in 15 Minutes".
- One that tells a story: name the subject and hold back the outcome. "How a Village of Huts Came to Rule the Known World".
- One on the stakes: a question, a number or a turning point.

Rules for all three:

- Under 70 characters, with the subject in the first 40. Feeds cut the rest.
- Be specific: a name, a year, a number. Vague hooks like "This Changes Everything" lose.
- Say only what the film shows. No "secret", "shocking" or "you won't believe".
- Don't repeat a thumbnail's text. The two are read together.
- No all capitals.

## Description

- The first line is under 150 characters, holds the main search words, and makes a reader want the film. Search shows only that line.
- Then two or three short paragraphs on what the film covers, in plain words.
- Leave out timestamps, chapters, sources and hashtags. The CLI adds them.

## Hashtags and tags

- 3 to 5 hashtags, most specific first. The first three show above the title.
- Tags: the topic, the main people and places, other spellings and common misspellings. Up to 500 characters. They matter little, so don't pad them.
- For a Hindi film, write titles and description in Hindi. Tags mix Hindi, the same words in Latin letters, and the English search terms.

## What the folder holds

`titles.txt`, `description.txt`, `tags.txt`, `subtitles.srt`, `transcript.txt` and `thumbnails/thumbnail_a.jpg` to `_c.jpg`.

Tell the user how to use them in YouTube Studio:

- Upload `subtitles.srt` under Subtitles, as a file with timing, in the film's language.
- Put the three thumbnails and the three titles into Test & Compare. YouTube picks the winner by watch time over about two weeks.
