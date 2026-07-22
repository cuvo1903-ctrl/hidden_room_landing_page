#!/usr/bin/env python3
"""Hidden Room Beat Store audio analyzer.

Runs on Debian behind Supabase Edge Function. It expects raw audio in the POST
body and returns BPM/key detected with Essentia. Keep this service private on
Tailscale or localhost and protect it with BEAT_ANALYZER_SECRET.
"""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import tempfile
import traceback

from essentia.standard import KeyExtractor, MonoLoader, RhythmExtractor2013

HOST = os.getenv("BEAT_ANALYZER_HOST", "127.0.0.1")
PORT = int(os.getenv("BEAT_ANALYZER_PORT", "8092"))
SECRET = os.getenv("BEAT_ANALYZER_SECRET", "")
MAX_UPLOAD_BYTES = int(os.getenv("BEAT_ANALYZER_MAX_BYTES", str(120 * 1024 * 1024)))
SAMPLE_RATE = 44100

KEY_ALIASES = {
    "A#": "Bb",
    "C#": "C#",
    "D#": "Eb",
    "F#": "F#",
    "G#": "Ab",
}


def response(handler, status, payload):
    data = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


def format_key(key, scale):
    note = KEY_ALIASES.get(str(key), str(key))
    normalized_scale = str(scale or "").lower()
    if normalized_scale == "minor":
        return f"{note}m"
    if normalized_scale == "major":
        return note
    return note


def analyze_audio(path, target):
    audio = MonoLoader(filename=path, sampleRate=SAMPLE_RATE)()
    result = {"sample_rate": SAMPLE_RATE}

    if target in ("bpm", "all"):
        bpm, ticks, confidence, estimates, intervals = RhythmExtractor2013(method="multifeature")(audio)
        if bpm and bpm > 0:
            result["bpm"] = int(round(float(bpm)))
            result["bpm_confidence"] = float(confidence)
            result["beats"] = len(ticks)

    if target in ("key", "all"):
        key, scale, strength = KeyExtractor(sampleRate=SAMPLE_RATE)(audio)
        if key:
            result["key"] = format_key(key, scale)
            result["key_raw"] = str(key)
            result["scale"] = str(scale)
            result["key_strength"] = float(strength)

    return result


class Handler(BaseHTTPRequestHandler):
    server_version = "HiddenRoomBeatAnalyzer/1.0"

    def do_GET(self):
        if self.path == "/health":
            response(self, 200, {"ok": True})
            return
        response(self, 404, {"error": "Not found"})

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/analyze":
            response(self, 404, {"error": "Not found"})
            return

        if not SECRET or self.headers.get("X-Beat-Analyzer-Secret") != SECRET:
            response(self, 401, {"error": "Unauthorized"})
            return

        target = (self.headers.get("X-Analyze-Target") or "all").lower()
        if target not in ("bpm", "key", "all"):
            response(self, 400, {"error": "Tipo de analisis invalido."})
            return

        length = int(self.headers.get("Content-Length") or "0")
        if length <= 0:
            response(self, 400, {"error": "Archivo vacio."})
            return
        if length > MAX_UPLOAD_BYTES:
            response(self, 413, {"error": "Archivo demasiado grande."})
            return

        suffix = os.path.splitext(self.headers.get("X-File-Name") or "audio.wav")[1] or ".audio"
        temp_path = ""
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
                temp_path = temp_file.name
                remaining = length
                while remaining > 0:
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        break
                    temp_file.write(chunk)
                    remaining -= len(chunk)

            result = analyze_audio(temp_path, target)
            response(self, 200, result)
        except Exception as exc:
            print("Beat analyzer failed:", exc)
            traceback.print_exc()
            response(self, 500, {"error": "No se pudo analizar el audio."})
        finally:
            if temp_path:
                try:
                    os.unlink(temp_path)
                except FileNotFoundError:
                    pass

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    if not SECRET:
        raise SystemExit("BEAT_ANALYZER_SECRET es obligatorio")
    print(f"Hidden Room Beat Analyzer listening on {HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
