#!/usr/bin/env python3
"""
Gera os sons de notificacao do CoMentor — um arquivo .wav por especie de coruja.

Os sons sao SINTETIZADOS (nao sao gravacoes reais). Foram criados porque o
ambiente de build nao tem acesso de rede a bancos de audio (xeno-canto,
Wikimedia, etc). Cada especie tem um padrao de pio distinto, inspirado na
vocalizacao real da especie brasileira correspondente.

Para trocar por gravacoes reais: substitua os arquivos em assets/sounds/
mantendo os mesmos nomes (ver assets/sounds/README.md).

Uso:  python3 scripts/generate_owl_sounds.py
"""

import math
import os
import random
import struct
import wave

SR = 44100
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "assets", "sounds")


def _env(n, total, attack=0.03, release=0.15):
    a = max(1, int(attack * SR))
    r = max(1, int(release * SR))
    if n < a:
        return n / a
    if n > total - r:
        return max(0.0, (total - n) / r)
    return 1.0


def hoot(freq, dur, vibrato_rate=5.5, vibrato_depth=0.012, glide=0.0,
         harmonics=(1.0, 0.55, 0.28, 0.12), breath=0.035,
         attack=0.03, release=0.18):
    """Um pio tonal suave (caracteristico de coruja: grave e arredondado)."""
    total = int(dur * SR)
    out = []
    phase = 0.0
    hsum = sum(harmonics)
    for n in range(total):
        t = n / SR
        f = freq * (1.0 + glide * (t / dur))
        f *= 1.0 + vibrato_depth * math.sin(2 * math.pi * vibrato_rate * t)
        phase += 2 * math.pi * f / SR
        s = 0.0
        for i, amp in enumerate(harmonics, start=1):
            s += amp * math.sin(i * phase)
        s /= hsum
        s += breath * (random.random() * 2 - 1)
        s *= _env(n, total, attack, release)
        out.append(s)
    return out


def silence(dur):
    return [0.0] * int(dur * SR)


def screech(dur, f_start=1850.0, f_end=850.0):
    """Grito raspado e descendente (Suindara / coruja-da-igreja)."""
    total = int(dur * SR)
    out = []
    for n in range(total):
        t = n / SR
        f = f_start + (f_end - f_start) * (t / dur)
        s = math.sin(2 * math.pi * f * t)
        s *= 0.55 + 0.45 * math.sin(2 * math.pi * 42 * t)  # tremor raspado
        s = 0.6 * s + 0.4 * (random.random() * 2 - 1)
        s *= _env(n, total, attack=0.02, release=0.28)
        out.append(s)
    return out


def concat(*chunks):
    out = []
    for c in chunks:
        out.extend(c)
    return out


def normalize(samples, peak=0.62):
    m = max((abs(s) for s in samples), default=1.0) or 1.0
    g = peak / m
    return [s * g for s in samples]


def write_wav(name, samples):
    samples = normalize(samples)
    path = os.path.join(OUT_DIR, name)
    with wave.open(path, "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        frames = b"".join(
            struct.pack("<h", max(-32767, min(32767, int(s * 32767))))
            for s in samples
        )
        w.writeframes(frames)
    dur = len(samples) / SR
    print(f"  {name:24s} {dur:4.1f}s  {os.path.getsize(path)//1024:4d} KB")


def build():
    random.seed(42)
    os.makedirs(OUT_DIR, exist_ok=True)
    print("Gerando sons de coruja em assets/sounds/ ...")

    # Suindara (Tyto furcata) — grito raspado.
    write_wav("owl_suindara.wav", screech(2.1))

    # Cabure (Glaucidium brasilianum) — serie de assobios curtos, ritmo igual.
    cabure = []
    for _ in range(15):
        cabure += hoot(1120, 0.10, vibrato_depth=0.0, harmonics=(1.0, 0.3),
                       breath=0.02, attack=0.015, release=0.05)
        cabure += silence(0.10)
    write_wav("owl_cabure.wav", cabure)

    # Coruja-buraqueira (Athene cunicularia) — dois toques "cu-cuuu".
    buraqueira = concat(
        hoot(760, 0.16, glide=0.02, breath=0.03),
        silence(0.12),
        hoot(720, 0.42, glide=-0.05, breath=0.03),
        silence(0.35),
        hoot(760, 0.16, glide=0.02, breath=0.03),
        silence(0.12),
        hoot(720, 0.42, glide=-0.05, breath=0.03),
    )
    write_wav("owl_buraqueira.wav", buraqueira)

    # Murucututu (Pulsatrix perspicillata) — batidas graves acelerando e caindo.
    murucututu = []
    gap = 0.26
    freq = 340
    for i in range(9):
        dur = 0.16 if i == 0 else 0.13
        murucututu += hoot(freq, dur, harmonics=(1.0, 0.6, 0.3),
                           vibrato_depth=0.0, breath=0.03,
                           attack=0.02, release=0.08)
        murucututu += silence(max(0.05, gap))
        gap *= 0.82
        freq *= 0.97
    write_wav("owl_murucututu.wav", murucututu)

    # Mocho-orelhudo (Asio clamator) — assobio unico descendente "uiiiooo".
    mocho = concat(
        hoot(720, 0.7, glide=-0.42, vibrato_rate=6.0, vibrato_depth=0.02,
             harmonics=(1.0, 0.4, 0.15), breath=0.03, release=0.3),
        silence(0.5),
        hoot(720, 0.7, glide=-0.42, vibrato_rate=6.0, vibrato_depth=0.02,
             harmonics=(1.0, 0.4, 0.15), breath=0.03, release=0.3),
    )
    write_wav("owl_mocho.wav", mocho)

    # Coruja-listrada (Strix hylophila) — pio ritmico "u u u-u".
    note = lambda: hoot(380, 0.22, harmonics=(1.0, 0.6, 0.3, 0.14),
                        vibrato_depth=0.008, breath=0.03, release=0.14)
    listrada = concat(
        note(), silence(0.22),
        note(), silence(0.22),
        note(), silence(0.10),
        note(),
    )
    write_wav("owl_listrada.wav", listrada)

    print("Pronto.")


if __name__ == "__main__":
    build()
