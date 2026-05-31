#!/usr/bin/env python3
"""
Beat detector — reads an audio file, returns BPM and beat timestamps as JSON.
Usage: python3 beat_detector.py <audio_file>
"""

import sys
import json
import os

def detect_beats(audio_path):
    import librosa
    import numpy as np

    if not os.path.exists(audio_path):
        return {"error": f"File not found: {audio_path}"}

    # Load audio — librosa handles mp3/wav/flac/ogg/m4a
    try:
        y, sr = librosa.load(audio_path, sr=None, mono=True)
    except Exception as e:
        return {"error": f"Failed to load audio: {str(e)}"}

    duration = librosa.get_duration(y=y, sr=sr)

    # Detect tempo and beat frames
    try:
        tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, units='frames')
        beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()
        tempo_val = float(tempo) if hasattr(tempo, '__float__') else float(tempo[0])
    except Exception as e:
        return {"error": f"Beat tracking failed: {str(e)}"}

    # Compute onset strength envelope for scoring beat intensity
    try:
        onset_env = librosa.onset.onset_strength(y=y, sr=sr)
        # Sample onset strength at each beat
        beat_strengths = []
        for bf in beat_frames:
            idx = min(int(bf), len(onset_env) - 1)
            beat_strengths.append(float(onset_env[idx]))
        # Normalize 0-1
        max_str = max(beat_strengths) if beat_strengths else 1.0
        beat_strengths = [s / max_str for s in beat_strengths]
    except Exception:
        beat_strengths = [1.0] * len(beat_times)

    # Build beat intervals (start, end, duration, strength)
    intervals = []
    for i, t in enumerate(beat_times):
        end = beat_times[i + 1] if i + 1 < len(beat_times) else duration
        intervals.append({
            "index": i,
            "start": round(t, 4),
            "end": round(end, 4),
            "duration": round(end - t, 4),
            "strength": round(beat_strengths[i], 4),
        })

    # Compute bar timestamps (every 4 beats) for slower-cut edits
    bars = []
    for i in range(0, len(beat_times), 4):
        bar_start = beat_times[i]
        bar_end = beat_times[i + 4] if i + 4 < len(beat_times) else duration
        bars.append({"start": round(bar_start, 4), "end": round(bar_end, 4),
                     "duration": round(bar_end - bar_start, 4)})

    return {
        "bpm": round(tempo_val, 2),
        "duration": round(duration, 3),
        "beat_count": len(beat_times),
        "beats": intervals,
        "bars": bars,
        "sr": int(sr),
    }

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: beat_detector.py <audio_file>"}))
        sys.exit(1)

    result = detect_beats(sys.argv[1])
    print(json.dumps(result))
