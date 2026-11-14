---
name: doc-research
description: Research a history documentary topic and import a verified dossier into ForgeTube. Use for the research stage of a film.
---

# Research a film

1. Run `bun run bin/video-studio.js research brief -p <id>` and follow it.
2. Search once. Read 8–12 strong sources, favouring scholarly and museum sources.
3. Write the dossier JSON in the topic's `research/` folder (`projects/<topic>/research/`). It is shared by every language version, so research a topic once. Set `opened: true` only for pages you actually read.
4. Keep claims short. Mark each `kind`:
   - `fact`: well attested
   - `tradition`: legend or later story
   - `estimate`: a number that's a scholarly estimate
   - `debated`: scholars disagree
5. Give each chapter its `claim_ids`.
6. Run `research import -p <id> -i <file>` and fix only the errors it prints.
7. Summarize the chapters and the open debates for the user. Stop for approval, then run `research approve`.

Never invent a source, a URL or a date. If you can't support a claim, leave it out.
