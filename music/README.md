# Music folder

Put your background music and ambience here, in any folder layout. Tracks stay out of git.

Use descriptive file names, such as `dark_strings_slow.wav`. Names help when earshot isn't available, and words like `ambience`, `wind`, `rain` or `crowd` mark a track as ambience.

No tracks yet? Make quiet pad beds in code with earshot. They go to `music/earshot/`:

```bash
bun run bin/video-studio.js audio music generate
```

After adding your own files, run:

```bash
bun run bin/video-studio.js audio music scan
```
