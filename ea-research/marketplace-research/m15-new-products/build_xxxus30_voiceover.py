# Usage: python -I build_xxxus30_voiceover.py <video_dir> plan   (narration + durations.json), then render the videos, then ... <video_dir> mux
"""Adds an English (Indian accent) neural voiceover to the silent XXX US30 promo + how-to videos. Text is public marketing copy only."""
import asyncio
import json
import os
import re
import subprocess
import sys

import edge_tts
import imageio_ffmpeg

vdir = sys.argv[1]
MODE = sys.argv[2] if len(sys.argv) > 2 else "plan"
VOICE = "en-IN-NeerjaNeural"
here = os.path.dirname(os.path.abspath(__file__))
FF = imageio_ffmpeg.get_ffmpeg_exe()

HOWTO_FILE = "xxxus30-demo-howto-website-1920x1080.mp4"
HOWTO = [
    "Start your free thirty day demo of triple X U S thirty.",
    "Step one. Open Algo Traders twenty four dot A I slash demo, log in, and press Start.",
    "Step two. Download the demo E A.",
    "Step three. Show your licence key, and copy it.",
    "Step four. In MetaTrader five, open Tools, Options, Expert Advisors, and allow Web Request for the Algo Traders twenty four website.",
    "Step five. Attach the E A to a U S thirty chart on a demo account, and paste your key.",
    "Free for thirty days. No payment, no card. Demo accounts only.",
]
PROMO = [
    "Meet triple X U S thirty, a U S thirty breakout E A for MetaTrader five.",
    "Try it free for thirty days, on your own demo account.",
    "Three independent breakout modules.",
    "A daily loss guard that stops trading when your limit is hit.",
    "An on chart panel shows what the E A is doing.",
    "Start your demo online, download the E A, paste your key, and attach it to U S thirty on a demo account.",
    "Free thirty day demo. Algo Traders twenty four dot A I slash demo. Demo accounts only.",
]
PROMOS = ["xxxus30-demo-promo-vertical-1080x1920.mp4", "xxxus30-demo-promo-landscape-1920x1080.mp4"]
PAD = 0.9  # seconds of breathing room after each narration
LEAD = 0.25


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.stderr


def duration(path):
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", run([FF, "-i", path]))
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))


async def tts(text, path):
    await edge_tts.Communicate(text, VOICE, rate="+0%").save(path)


def narrate(texts, tmp, tag):
    out = []
    for i, text in enumerate(texts):
        path = os.path.join(tmp, f"{tag}{i}.mp3")
        asyncio.run(tts(text, path))
        out.append((path, duration(path)))
    return out


def plan():
    """Generate the narration, write the scene durations the video scripts read (durations.json) and keep the audio."""
    keep = os.path.join(here, "voice_cache")
    os.makedirs(keep, exist_ok=True)
    durs = {}
    for tag, key, texts, mins in (("h", "howto", HOWTO, 4.0), ("p", "promo", PROMO, 3.5)):
        clips = narrate(texts, keep, tag)
        durs[key] = [round(max(mins, d + PAD + LEAD) * 2) / 2 for _, d in clips]
        print(key, [round(d, 1) for _, d in clips], "->", durs[key], "total", sum(durs[key]))
    json.dump(durs, open(os.path.join(here, "durations.json"), "w"))


def mux(video, key, tag):
    durs = json.load(open(os.path.join(here, "durations.json")))[key]
    keep = os.path.join(here, "voice_cache")
    starts, acc = [], 0.0
    for d in durs:
        starts.append(acc + LEAD)
        acc += d
    clips = [(st, os.path.join(keep, f"{tag}{i}.mp3")) for i, st in enumerate(starts)]
    cmd = [FF, "-y", "-loglevel", "error", "-i", os.path.join(vdir, video)]
    for _, p in clips:
        cmd += ["-i", p]
    delays = ";".join(f"[{k + 1}:a]adelay={int(s * 1000)}|{int(s * 1000)}[a{k}]" for k, (s, _) in enumerate(clips))
    mix = "".join(f"[a{k}]" for k in range(len(clips))) + f"amix=inputs={len(clips)}:normalize=0,volume=1.6[aout]"
    outp = os.path.join(vdir, video.replace(".mp4", "-voice.mp4"))
    cmd += ["-filter_complex", delays + ";" + mix, "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", outp]
    err = run(cmd)
    print(err.strip() or "ok", "->", outp, os.path.getsize(outp) // 1024, "KB")


if MODE == "plan":
    plan()
else:
    mux(HOWTO_FILE, "howto", "h")
    for v in PROMOS:
        mux(v, "promo", "p")
