"""Speaks text with Edge TTS and saves word timings next to the audio.

usage: edge_tts_words.py <text_file> <voice> <rate> <pitch> <out_mp3> <out_json>
Times in the JSON are seconds from the start of the audio.
"""
import asyncio
import json
import sys

import edge_tts

TICKS_PER_SECOND = 10_000_000


async def main(text_file, voice, rate, pitch, out_mp3, out_json):
    with open(text_file, encoding="utf-8") as handle:
        text = handle.read()

    speech = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, boundary="WordBoundary")
    words = []
    with open(out_mp3, "wb") as audio:
        async for chunk in speech.stream():
            if chunk["type"] == "audio":
                audio.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                start = chunk["offset"] / TICKS_PER_SECOND
                words.append(
                    {
                        "word": chunk["text"],
                        "start": start,
                        "end": start + chunk["duration"] / TICKS_PER_SECOND,
                    }
                )

    with open(out_json, "w", encoding="utf-8") as handle:
        json.dump(words, handle)


if __name__ == "__main__":
    asyncio.run(main(*sys.argv[1:7]))
