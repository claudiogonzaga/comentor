#!/usr/bin/env python3
"""Gera os sons do Kinesis (WAV) a partir da mesma síntese do app do Mac.

No Mac os sons saem do Web Audio, na hora. No Android quem toca é o serviço
nativo, com a tela apagada e sem JS: precisa de arquivos em res/raw. Este script
reproduz os osciladores e envelopes de src/sounds.js do Kinesis-MacOS, com
volume 1 (o volume escolhido é aplicado na hora de tocar).

Uso: python3 scripts/gen-kinesis-sounds.py
"""
import os
import wave

import numpy as np

RATE = 44100
OUT = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..",
    "modules",
    "kinesis-timer",
    "android",
    "src",
    "main",
    "res",
    "raw",
)


def env_exp(t, points):
    """Envelope por rampas exponenciais entre (tempo, valor), como o Web Audio."""
    out = np.zeros_like(t)
    for (t0, v0), (t1, v1) in zip(points, points[1:]):
        mask = (t >= t0) & (t < t1)
        if t1 > t0:
            out[mask] = v0 * (v1 / v0) ** ((t[mask] - t0) / (t1 - t0))
    return out


def wave_of(kind, phase):
    if kind == "sine":
        return np.sin(2 * np.pi * phase)
    frac = phase - np.floor(phase)
    if kind == "square":
        return np.where(frac < 0.5, 1.0, -1.0)
    if kind == "triangle":
        return 2 * np.abs(2 * frac - 1) - 1
    if kind == "sawtooth":
        return 2 * frac - 1
    raise ValueError(kind)


class Mix:
    def __init__(self, seconds):
        self.buf = np.zeros(int(seconds * RATE))
        self.t = np.arange(len(self.buf)) / RATE

    def tone(self, freq, dur_ms, kind="sine", delay_ms=0, peak_scale=0.55):
        start = delay_ms / 1000
        dur = dur_ms / 1000
        peak = max(0.0001, peak_scale)
        stop = start + dur + 0.1
        e = env_exp(
            self.t,
            [(start, 0.0001), (start + 0.01, peak), (start + dur + 0.06, 0.0001)],
        )
        mask = (self.t >= start) & (self.t < stop)
        self.buf[mask] += wave_of(kind, freq * (self.t[mask] - start)) * e[mask]

    def bell(self, freq, ratios=(1,), decays=(0.6,), when=0.0, peak_scale=0.5, kind="sine"):
        peak = max(0.0001, peak_scale)
        for i, ratio in enumerate(ratios):
            decay = decays[i] if i < len(decays) else decays[-1]
            amp = max(0.0001, peak / (1 + i * 0.8))
            e = env_exp(
                self.t, [(when, 0.0001), (when + 0.004, amp), (when + decay, 0.0001)]
            )
            mask = (self.t >= when) & (self.t < when + decay + 0.05)
            self.buf[mask] += wave_of(kind, freq * ratio * (self.t[mask] - when)) * e[mask]


def school_bell():
    m = Mix(0.75)
    for i in range(5):
        m.bell(1046, (1, 2.76, 5.4), (0.16, 0.12, 0.09), i * 0.1, 0.4, "triangle")
    return m.buf


def zen_bell():
    m = Mix(3.0)
    m.bell(320, (1, 2.7, 4.2, 5.9), (2.8, 2.1, 1.6, 1.1), 0, 0.5)
    m.bell(323, (1,), (2.8,), 0, 0.18)
    return m.buf


def chime():
    m = Mix(1.2)
    m.bell(1318, (1, 3, 5.2), (1.1, 0.7, 0.5), 0, 0.4)
    return m.buf


def gong():
    m = Mix(3.0)
    m.bell(140, (1, 1.5, 2.3, 3.4, 4.7), (2.8, 2.3, 1.9, 1.4, 1.0), 0, 0.5)
    return m.buf


def dingdong():
    m = Mix(1.75)
    m.bell(660, (1, 2.9), (0.9, 0.6), 0, 0.45)
    m.bell(523, (1, 2.9), (1.2, 0.7), 0.42, 0.45)
    return m.buf


def whistle():
    dur = 0.42
    m = Mix(dur + 0.03)
    t = m.t
    peak = 0.55
    e = env_exp(
        t,
        [(0, 0.0001), (0.015, peak), (dur - 0.07, peak), (dur, 0.0001)],
    )
    # Duas senoides com o mesmo vibrato de 23 Hz (±130 Hz), como no Web Audio.
    vibrato = 130 * np.sin(2 * np.pi * 23 * t)
    out = np.zeros_like(t)
    for freq in (2850, 2872):
        phase = np.cumsum(freq + vibrato) / RATE
        out += np.sin(2 * np.pi * phase)
    return out * e


def alarm():
    m = Mix(0.72)
    for i in range(3):
        m.tone(1760, 130, "square", i * 180, 0.85)
    return m.buf


def siren():
    m = Mix(1.42)
    t = m.t
    knots_t = [0, 0.4, 0.8, 1.2, 1.42]
    knots_f = [620, 1180, 620, 1180, 1180]
    freq = np.interp(t, knots_t, knots_f)
    phase = np.cumsum(freq) / RATE
    peak = 0.6
    e = env_exp(t, [(0, 0.0001), (0.05, peak), (1.15, peak), (1.32, 0.0001)])
    return wave_of("sawtooth", phase) * e


def buzzer():
    m = Mix(1.02)
    for i in range(2):
        m.tone(170, 280, "sawtooth", i * 340, 0.7)
    return m.buf


def gentle():
    m = Mix(1.05)
    m.bell(784, (1, 2), (0.6, 0.4), 0, 0.3)
    m.bell(1047, (1, 2), (0.8, 0.5), 0.2, 0.3)
    return m.buf


def prepare_tone():
    m = Mix(0.4)
    m.tone(440, 180, "sine")
    return m.buf


def exercise_end():
    m = Mix(0.9)
    m.tone(1047, 150, "sine", 0, 0.55)
    m.tone(784, 150, "sine", 170, 0.55)
    m.tone(523, 380, "sine", 340, 0.6)
    return m.buf


def finished():
    m = Mix(0.92)
    m.tone(660, 140, "sine")
    m.tone(880, 140, "sine", 170)
    m.tone(1175, 420, "sine", 340)
    return m.buf


def beeps():
    """Os três bipes dos últimos 3 segundos de uma fase, um por segundo."""
    m = Mix(2.3)
    for i in range(3):
        m.tone(880, 85, "square", i * 1000, 0.55)
    return m.buf


SOUNDS = {
    "kin_schoolbell": school_bell,
    "kin_zenbell": zen_bell,
    "kin_chime": chime,
    "kin_gong": gong,
    "kin_dingdong": dingdong,
    "kin_whistle": whistle,
    "kin_alarm": alarm,
    "kin_siren": siren,
    "kin_buzzer": buzzer,
    "kin_gentle": gentle,
    "kin_prepare": prepare_tone,
    "kin_exercise_end": exercise_end,
    "kin_finished": finished,
    "kin_beeps": beeps,
}


def write_wav(path, samples):
    peak = float(np.max(np.abs(samples)))
    # O Web Audio corta o que passa de 1; aqui só evita o corte.
    if peak > 0.98:
        samples = samples * (0.98 / peak)
    # 5 ms de saída: o fim das rampas exponenciais não termina num clique.
    fade = min(len(samples), int(0.005 * RATE))
    samples = samples.copy()
    samples[-fade:] *= np.linspace(1, 0, fade)
    pcm = (samples * 32767).astype("<i2").tobytes()
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm)


def main():
    os.makedirs(OUT, exist_ok=True)
    total = 0
    for name, fn in SOUNDS.items():
        samples = fn()
        path = os.path.join(OUT, f"{name}.wav")
        write_wav(path, samples)
        size = os.path.getsize(path)
        total += size
        rms = float(np.sqrt(np.mean(samples**2)))
        print(
            f"{name:18s} {len(samples) / RATE:5.2f}s pico={np.max(np.abs(samples)):.2f} "
            f"rms={rms:.3f} {size // 1024:4d} KiB"
        )
    print(f"total {total // 1024} KiB em {os.path.normpath(OUT)}")


if __name__ == "__main__":
    main()
