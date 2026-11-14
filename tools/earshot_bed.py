"""Background beds for documentaries, made in code with earshot's synthesis toolkit.

usage: earshot_bed.py --list
       earshot_bed.py <preset> <out_file> [--seconds 96] [--seed 1]

Each bed is a slow pad underscore: sustained chords, a low drone, room. No
melody and no beat that could pull attention from the narration. Nothing is
recorded or downloaded; every sample is computed. Needs earshot importable.
"""
import argparse
import json
import sys

import numpy as np
import soundfile as sf
from scipy import signal
from earshot.forge import dsp, fx

SR = dsp.SR

# Chord roots and qualities as semitones above the key note.
MINOR = [(0, "m"), (8, "M"), (3, "M"), (10, "M")]        # i  VI  III  VII
DORIAN = [(0, "m"), (5, "M"), (0, "m"), (10, "M")]       # i  IV  i    VII
MAJOR = [(0, "M"), (5, "M"), (9, "m"), (7, "M")]         # I  IV  vi   V
PHRYGIAN = [(0, "m"), (1, "M"), (0, "m"), (10, "m")]     # i  bII i    vii
DRONE = [(0, "5"), (0, "5"), (7, "5"), (0, "5")]         # open fifths only

PRESETS = {
    # name: the file name earshot and the name ranking read, so it describes the sound
    "calm_warm_strings_pad_slow": dict(
        key=50, chords=MAJOR, cutoff=1500, chord_s=14, bells=0.0, pulse=0.0, air=0.03, rt60=5.0, sub=0.25),
    "solemn_reverent_choir_pad_minor": dict(
        key=45, chords=MINOR, cutoff=1100, chord_s=16, bells=0.0, pulse=0.0, air=0.04, rt60=6.5, sub=0.35),
    "dark_tense_low_drone_ominous": dict(
        key=38, chords=DRONE, cutoff=520, chord_s=18, bells=0.0, pulse=0.0, air=0.06, rt60=6.0, sub=0.6),
    "tense_war_low_pulse_dark_strings": dict(
        key=40, chords=MINOR, cutoff=800, chord_s=12, bells=0.0, pulse=0.5, air=0.04, rt60=3.5, sub=0.45),
    "hopeful_bright_dawn_pad_bells": dict(
        key=52, chords=MAJOR, cutoff=2200, chord_s=12, bells=0.5, pulse=0.0, air=0.03, rt60=5.0, sub=0.2),
    "mysterious_ancient_temple_bells_pad": dict(
        key=43, chords=PHRYGIAN, cutoff=1000, chord_s=16, bells=0.35, pulse=0.0, air=0.05, rt60=7.0, sub=0.35),
    "sad_melancholy_slow_strings_pad": dict(
        key=47, chords=DORIAN, cutoff=1250, chord_s=16, bells=0.0, pulse=0.0, air=0.03, rt60=5.5, sub=0.3),
    "epic_grand_wide_brass_pad": dict(
        key=48, chords=MAJOR, cutoff=1800, chord_s=12, bells=0.0, pulse=0.25, air=0.03, rt60=4.5, sub=0.45),
}


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def voicing(root, quality):
    """An open voicing: root, fifth, then the third and the octave above it."""
    third = {"m": 3, "M": 4}.get(quality)
    notes = [root, root + 7, root + 12]
    if third is not None:
        notes.append(root + 12 + third)
    notes.append(root + 19)
    return notes


def swell(n, attack, release):
    env = np.ones(n)
    a, b = min(n // 2, dsp.n_of(attack)), min(n // 2, dsp.n_of(release))
    env[:a] = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, a))
    env[n - b:] = 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, b))
    return env


def pad_note(freq, seconds, r, cutoff):
    """Three slightly detuned voices with slow drift, kept dark until only warmth is left.

    Each voice is a sum of harmonics that fall away above the cutoff. Adding
    sines keeps it free of aliasing and fast without a compiled oscillator.
    """
    n = dsp.n_of(seconds)
    t = dsp.t_of(n)
    y = np.zeros(n)
    for cents in (-8.0, 0.0, 7.0):
        f = freq * 2 ** (cents / 1200)
        phase = 2 * np.pi * f * t + 0.9 * np.sin(2 * np.pi * r.uniform(0.05, 0.2) * t + r.uniform(0, 6.3))
        phase += r.uniform(0, 6.3)
        for k in range(1, int(min(cutoff * 3, 9000) / f) + 1):
            y += np.sin(k * phase) / (k * (1 + (k * f / cutoff) ** 3))
    breathe = 1 + 0.18 * np.sin(2 * np.pi * r.uniform(0.06, 0.13) * t + r.uniform(0, 6.3))
    return y / 3 * breathe * swell(n, seconds * 0.3, seconds * 0.3)


def hall(x, r, rt60, wet):
    """A large dark hall: the input convolved with a decaying, low-passed noise tail."""
    n = dsp.n_of(rt60 * 1.3)
    tail = r.standard_normal((n, 2)) * np.exp(-6.91 * dsp.t_of(n) / rt60)[:, None]
    tail = dsp.butter(dsp.butter(tail, "low", 4200), "high", 160)
    build = dsp.n_of(0.03)
    tail[:build] *= np.linspace(0, 1, build)[:, None]
    tail /= np.sqrt((tail ** 2).sum(axis=0))
    out = x.copy()
    for c in range(2):
        out[:, c] += wet * signal.fftconvolve(x[:, c], tail[:, c])[: len(x)]
    return out


def render(preset, seconds, seed):
    p = PRESETS[preset]
    r = dsp.rng(seed)
    n = dsp.n_of(seconds)
    t = dsp.t_of(n)
    mix = np.zeros((n, 2))

    chord_s = p["chord_s"]
    step = chord_s * 0.62                      # chords overlap, so one melts into the next
    count = int(np.ceil(seconds / step))
    for k in range(count):
        root, quality = p["chords"][k % len(p["chords"])]
        for i, note in enumerate(voicing(p["key"] + root, quality)):
            gain = 0.5 if i == 0 else 0.34 / (1 + 0.25 * i)
            tone = pad_note(hz(note), chord_s, r, p["cutoff"] * (1.0 if i < 3 else 0.8))
            dsp.place(mix, fx.pan(tone, r.uniform(-0.6, 0.6)), k * step, gain)

    # A sine an octave under the key holds the piece together.
    sub = np.sin(2 * np.pi * hz(p["key"] - 12) * t) * (1 + 0.25 * np.sin(2 * np.pi * 0.05 * t))
    mix += (p["sub"] * 0.3 * sub)[:, None]

    if p["air"] > 0:
        air = dsp.butter(dsp.noise(seconds, r, "pink"), "band", (250, 2600))[:n]
        air *= 0.6 + 0.4 * np.sin(2 * np.pi * 0.03 * t + r.uniform(0, 6.3))
        other = dsp.butter(dsp.noise(seconds, r, "pink"), "band", (250, 2600))[:n]
        mix += p["air"] * np.stack([air, 0.6 * air + 0.8 * other * (air.std() / other.std())], axis=1)

    if p["bells"] > 0:
        at = r.uniform(3, 6)
        while at < seconds - 8:
            root, quality = p["chords"][int(at / step) % len(p["chords"])]
            note = r.choice(voicing(p["key"] + root, quality)[2:]) + 12
            ding = dsp.bell(hz(note), 5.0, r, "bar", decay=1.6, bright=0.15, strike=0.08)
            dsp.place(mix, fx.pan(ding, r.uniform(-0.5, 0.5)), at, p["bells"] * 0.12)
            at += r.uniform(5.5, 11)

    if p["pulse"] > 0:
        beat = np.sin(2 * np.pi * hz(p["key"] - 12) * dsp.t_of(dsp.n_of(1.2))) * dsp.env_exp(1.2, 0.28, attack=0.01)
        at = 2.0
        while at < seconds - 3:
            dsp.place(mix, np.stack([beat, beat], axis=1), at, p["pulse"] * 0.35)
            dsp.place(mix, np.stack([beat, beat], axis=1), at + 0.42, p["pulse"] * 0.2)
            at += 2.4

    wet = hall(mix, r, p["rt60"], 0.45)
    out = dsp.butter(dsp.butter(wet, "high", 38), "low", 9000)
    out = dsp.fade(out, 3.0, 4.0)
    return fx.limit(dsp.normalize(out, -5.0), ceiling_db=-3.0)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("preset", nargs="?")
    parser.add_argument("out", nargs="?")
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--seconds", type=float, default=96.0)
    parser.add_argument("--seed", type=int, default=1)
    args = parser.parse_args()

    if args.list:
        print(json.dumps(sorted(PRESETS)))
        return
    if args.preset not in PRESETS or not args.out:
        sys.exit(f"earshot_bed: unknown preset. Use one of: {', '.join(sorted(PRESETS))}")

    audio = render(args.preset, args.seconds, args.seed)
    sf.write(args.out, audio, SR, subtype="PCM_16")
    print(json.dumps({"preset": args.preset, "file": args.out, "seconds": round(len(audio) / SR, 2)}))


if __name__ == "__main__":
    main()
