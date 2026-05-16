#!/usr/bin/env python3
"""Renderiza 3 conceitos de mascote (coruja de Atena) para o usuario escolher.

Apenas uma previa de comparacao — nao faz parte do app. Gera /tmp/owl_options.png
com 3 paineis lado a lado.
"""

import math
import random

from PIL import Image, ImageDraw, ImageFont

PW, PH = 520, 600          # painel
W, H = PW * 3, PH
BG = (24, 27, 52)
GOLD = (244, 197, 83)
CREAM = (245, 232, 200)
TINT = (142, 138, 200)
INDIGO = (61, 58, 107)
OLIVE = (155, 176, 127)
INK = (24, 27, 52)


def font(sz):
    try:
        return ImageFont.truetype(
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", sz)
    except OSError:
        return ImageFont.load_default()


# ---------------------------------------------------------------- painel 1
def panel_network(d, ox, oy):
    """Coruja-rede: malha de nos e arestas + ramo de oliveira."""
    S = 2.3
    cx, cy = ox + PW / 2 - 100 * S, oy + 60
    rng = random.Random(7)
    nodes, edges = [], []

    def push(x, y, r, kind):
        nodes.append((x, y, r, 0.55 + rng.random() * 0.45, kind))
        return len(nodes) - 1

    bidx = []
    for i in range(26):
        a = (i / 26) * math.tau - math.pi / 2
        j = 0.93 + rng.random() * 0.13
        bidx.append(push(100 + math.cos(a) * 60 * j,
                         116 + math.sin(a) * 66 * j,
                         1.6 + rng.random() * 1.2, "b"))
    for i in range(26):
        edges.append((bidx[i], bidx[(i + 1) % 26]))

    def tuft(c):
        idx = [push(x, y, 1.6, "t") for x, y in c]
        for e in range(3):
            x1, y1 = c[e]
            x2, y2 = c[(e + 1) % 3]
            idx.append(push((x1 + x2) / 2, (y1 + y2) / 2, 1.4, "t"))
        o = [idx[0], idx[3], idx[1], idx[4], idx[2], idx[5]]
        for i in range(6):
            edges.append((o[i], o[(i + 1) % 6]))

    tuft([(60, 22), (44, 66), (86, 60)])
    tuft([(140, 22), (156, 66), (114, 60)])

    for ex, ey in ((74, 95), (126, 95)):
        ring = []
        for i in range(12):
            a = (i / 12) * math.tau
            ring.append(push(ex + math.cos(a) * 24, ey + math.sin(a) * 24,
                              1.6, "e"))
        for i in range(12):
            edges.append((ring[i], ring[(i + 1) % 12]))
        p = push(ex, ey, 3.8, "p")
        for i in range(0, 12, 3):
            edges.append((p, ring[i]))

    beak = [push(100, 106, 1.8, "k"), push(92, 117, 1.5, "k"),
            push(100, 130, 2, "k"), push(108, 117, 1.5, "k")]
    for i in range(4):
        edges.append((beak[i], beak[(i + 1) % 4]))

    inner = []
    tries = 0
    while len(inner) < 20 and tries < 600:
        tries += 1
        x = 100 + (rng.random() * 2 - 1) * 55
        y = 116 + (rng.random() * 2 - 1) * 60
        if ((x - 100) / 60) ** 2 + ((y - 116) / 66) ** 2 > 0.86:
            continue
        if math.hypot(x - 74, y - 95) < 27 or math.hypot(x - 126, y - 95) < 27:
            continue
        inner.append(push(x, y, 1.1 + rng.random() * 1.4, "i"))

    pool = [i for i, n in enumerate(nodes) if n[4] not in ("e", "p")]
    seen = set()
    for i in pool:
        n = nodes[i]
        near = sorted(((j, math.hypot(nodes[j][0] - n[0], nodes[j][1] - n[1]))
                       for j in pool if j != i), key=lambda t: t[1])
        a = 0
        for j, dd in near:
            if a >= 2 or dd > 38:
                break
            k = (min(i, j), max(i, j))
            if k not in seen:
                seen.add(k)
                edges.append((i, j))
            a += 1

    # ramo de oliveira (nos)
    branch = []
    bx, by = 150, 168
    for t in range(6):
        branch.append(push(bx + t * 9, by + t * 6, 1.5, "o"))
    for i in range(5):
        edges.append((branch[i], branch[i + 1]))
    for li in (1, 3, 5):
        lx, ly = nodes[branch[li]][0], nodes[branch[li]][1]
        leaf = push(lx + 10, ly - 9, 2.6, "o")
        edges.append((branch[li], leaf))

    for a, b in edges:
        d.line([(cx + nodes[a][0] * S, cy + nodes[a][1] * S),
                (cx + nodes[b][0] * S, cy + nodes[b][1] * S)],
               fill=TINT + (60,), width=2)
    for x, y, r, op, kind in nodes:
        col = OLIVE if kind == "o" else (TINT if kind in ("t", "i") else GOLD)
        px, py = cx + x * S, cy + y * S
        if kind == "p":
            d.ellipse([px - 9 * S, py - 9 * S, px + 9 * S, py + 9 * S],
                      fill=GOLD + (55,))
        rr = r * S
        d.ellipse([px - rr, py - rr, px + rr, py + rr],
                  fill=col + (int(255 * op),))


# ---------------------------------------------------------------- painel 2
def panel_coin(d, ox, oy):
    """Coruja da moeda de Atenas: line-art dourado, frontal, com oliveira."""
    S = 2.3
    cx, cy = ox + PW / 2 - 100 * S, oy + 70
    g = GOLD + (255,)

    def L(pts, w=3):
        d.line([(cx + x * S, cy + y * S) for x, y in pts], fill=g, width=w,
               joint="curve")

    def C(x, y, r, w=3, fill=None):
        bb = [cx + (x - r) * S, cy + (y - r) * S,
              cx + (x + r) * S, cy + (y + r) * S]
        d.ellipse(bb, outline=g if fill is None else None, width=w, fill=fill)

    def arc(x, y, r, a0, a1, w=3):
        bb = [cx + (x - r) * S, cy + (y - r) * S,
              cx + (x + r) * S, cy + (y + r) * S]
        d.arc(bb, a0, a1, fill=g, width=w)

    # crescente (canto sup. esq.)
    arc(34, 40, 16, 40, 320, 3)
    # corpo (contorno tipo egg)
    body = [(100, 52), (150, 70), (162, 120), (140, 168),
            (100, 182), (60, 168), (38, 120), (50, 70), (100, 52)]
    L(body, 3)
    # tufos
    L([(70, 56), (62, 30), (86, 52)], 3)
    L([(130, 56), (138, 30), (114, 52)], 3)
    # olhos grandes
    C(76, 96, 23, 3)
    C(124, 96, 23, 3)
    C(76, 96, 7, 0, fill=g)
    C(124, 96, 7, 0, fill=g)
    # sobrancelha unindo os olhos
    L([(56, 78), (100, 70), (144, 78)], 3)
    # bico
    L([(100, 104), (92, 120), (108, 120), (100, 104)], 3)
    # marcas de plumagem (peito)
    for k in range(3):
        yy = 132 + k * 13
        L([(86, yy), (100, yy + 7), (114, yy)], 2)
    # asas dobradas
    arc(64, 128, 40, 70, 150, 2)
    arc(136, 128, 40, 30, 110, 2)
    # pes
    L([(86, 182), (84, 196)], 3)
    L([(80, 196), (84, 196), (90, 194)], 2)
    L([(114, 182), (116, 196)], 3)
    L([(110, 194), (116, 196), (120, 196)], 2)
    # ramo de oliveira (lado direito)
    L([(150, 150), (182, 120), (196, 84)], 3)
    for lx, ly, a in ((168, 134, -35), (182, 116, -20), (190, 96, -10)):
        d.ellipse([cx + (lx - 9) * S, cy + (ly - 5) * S,
                   cx + (lx + 9) * S, cy + (ly + 5) * S],
                  outline=g, width=2)


# ---------------------------------------------------------------- painel 3
def panel_geo(d, ox, oy):
    """Coruja geometrica chapada (flat), moderna, com ramo de oliveira."""
    S = 2.3
    cx, cy = ox + PW / 2 - 100 * S, oy + 70

    def P(pts, fill, outline=None, w=0):
        d.polygon([(cx + x * S, cy + y * S) for x, y in pts],
                  fill=fill, outline=outline, width=w)

    def C(x, y, r, fill, outline=None, w=0):
        d.ellipse([cx + (x - r) * S, cy + (y - r) * S,
                   cx + (x + r) * S, cy + (y + r) * S],
                  fill=fill, outline=outline, width=w)

    # ramo de oliveira atras
    d.line([(cx + 132 * S, cy + 150 * S), (cx + 196 * S, cy + 70 * S)],
           fill=OLIVE + (255,), width=4)
    for lx, ly in ((150, 128), (168, 104), (184, 82)):
        d.ellipse([cx + (lx - 11) * S, cy + (ly - 6) * S,
                   cx + (lx + 11) * S, cy + (ly + 6) * S],
                  fill=OLIVE + (255,))
    # tufos (triangulos)
    P([(58, 58), (66, 22), (90, 54)], INDIGO)
    P([(142, 58), (134, 22), (110, 54)], INDIGO)
    # corpo (hexagono arredondado -> circulo)
    C(100, 114, 60, INDIGO)
    # barriga
    d.pieslice([cx + 60 * S, cy + 74 * S, cx + 140 * S, cy + 174 * S],
               20, 160, fill=GOLD + (60,))
    # olhos
    for ex in (74, 126):
        C(ex, 94, 24, CREAM)
        C(ex, 94, 13, GOLD)
        C(ex, 94, 6, INK)
        C(ex - 3, 90, 2.4, CREAM)
    # bico
    P([(100, 104), (92, 118), (108, 118)], GOLD)
    # pes
    P([(86, 172), (82, 184), (94, 180)], GOLD)
    P([(114, 172), (118, 184), (106, 180)], GOLD)


def main():
    img = Image.new("RGB", (W, H), BG)
    over = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(over)

    panel_network(d, 0, 0)
    panel_coin(d, PW, 0)
    panel_geo(d, PW * 2, 0)

    img.paste(over, (0, 0), over)
    d2 = ImageDraw.Draw(img)
    titles = ["1 — Coruja-rede (constelacao)",
              "2 — Coruja da moeda de Atenas",
              "3 — Coruja geometrica (flat)"]
    f = font(26)
    for i, t in enumerate(titles):
        d2.text((i * PW + 28, H - 54), t, font=f, fill=GOLD)
        if i:
            d2.line([(i * PW, 30), (i * PW, H - 30)], fill=(50, 54, 88), width=2)

    out = "/tmp/owl_options.png"
    img.save(out)
    print("ok ->", out)


if __name__ == "__main__":
    main()
