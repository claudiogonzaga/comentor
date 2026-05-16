#!/usr/bin/env python3
"""Previa da coruja-rede da Comentora (mascote) — conferencia visual.

NAO faz parte do app. Replica a geometria de buildGraph() de
src/components/Owl.tsx. Coruja sem tufos de orelha (estilo coruja de Atena),
com disco facial em coracao, sobrancelha e bico marcados.
"""

import math
import random

from PIL import Image, ImageDraw

W = 760
S = W / 200.0

GOLD = (244, 197, 83)
TINT = (142, 138, 200)
BG = (24, 27, 52)

# Silhueta: cabeca larga, leve estreitamento no "pescoco", corpo afunilando.
OUTLINE = [
    (100, 28), (126, 32), (149, 47), (161, 75), (151, 101),
    (145, 110), (154, 135), (148, 163), (124, 183), (100, 189),
    (76, 183), (52, 163), (46, 135), (55, 110), (49, 101),
    (39, 75), (51, 47), (74, 32),
]
# Disco facial em formato de coracao (anel marcante = traco-chave de coruja).
HEART = [
    (100, 60), (86, 50), (68, 48), (54, 60), (47, 82), (53, 106),
    (70, 128), (88, 140), (100, 145), (112, 140), (130, 128),
    (147, 106), (153, 82), (146, 60), (132, 48), (114, 50),
]
EYE_L = (77, 88)
EYE_R = (123, 88)
EYE_OUT = 19


def sample_closed(pts, n, rng, jit):
    segs, total = [], 0.0
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        d = math.hypot(b[0] - a[0], b[1] - a[1])
        segs.append((a, b, d))
        total += d
    out = []
    for k in range(n):
        target = (k / n) * total
        acc = 0.0
        for a, b, d in segs:
            if acc + d >= target:
                t = (target - acc) / d
                out.append((a[0] + (b[0] - a[0]) * t + (rng.random() * 2 - 1) * jit,
                            a[1] + (b[1] - a[1]) * t + (rng.random() * 2 - 1) * jit))
                break
            acc += d
    return out


def in_poly(x, y, poly):
    inside, j = False, len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if ((yi > y) != (yj > y)) and \
                (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def build():
    rng = random.Random(13)
    nodes, edges = [], []

    def push(x, y, r, kind):
        nodes.append((x, y, r, 0.6 + rng.random() * 0.4, kind))
        return len(nodes) - 1

    def loop(idx, struct=True):
        for i in range(len(idx)):
            edges.append((idx[i], idx[(i + 1) % len(idx)], struct))

    def link(a, b, struct=True):
        edges.append((a, b, struct))

    # contorno do corpo
    body = [push(x, y, 1.7 + rng.random() * 1.1, "body")
            for x, y in sample_closed(OUTLINE, 30, rng, 1.9)]
    loop(body)

    # disco facial (coracao)
    disc = [push(x, y, 1.9 + rng.random() * 0.9, "disc")
            for x, y in sample_closed(HEART, 24, rng, 1.6)]
    loop(disc)

    # sobrancelha: V que desce ao centro (cara classica de coruja)
    brow_l = [push(64, 74, 1.6, "brow"), push(82, 66, 1.6, "brow"),
              push(99, 62, 1.8, "brow")]
    brow_r = [push(136, 74, 1.6, "brow"), push(118, 66, 1.6, "brow"),
              brow_l[2]]
    for b in (brow_l, brow_r):
        for i in range(len(b) - 1):
            link(b[i], b[i + 1])

    # olhos: anel + pupila
    pupils = []
    for ex, ey in (EYE_L, EYE_R):
        ring = []
        for i in range(12):
            a = (i / 12) * math.tau
            ring.append(push(ex + math.cos(a) * EYE_OUT,
                             ey + math.sin(a) * EYE_OUT, 1.6, "eye"))
        loop(ring)
        p = push(ex, ey, 3.8, "pupil")
        pupils.append(p)
        for i in range(0, 12, 2):
            link(p, ring[i])

    # bico: triangulo descendo do centro da sobrancelha
    beak = [push(100, 100, 1.7, "beak"), push(92, 122, 1.6, "beak"),
            push(100, 134, 2.0, "beak"), push(108, 122, 1.6, "beak")]
    loop(beak)
    link(brow_l[2], beak[0])

    # poucos nos internos (preenchimento leve do corpo, fora do disco)
    inner = []
    tries = 0
    while len(inner) < 7 and tries < 700:
        tries += 1
        x = 100 + (rng.random() * 2 - 1) * 48
        y = 132 + (rng.random() * 2 - 1) * 44
        if not in_poly(x, y, OUTLINE):
            continue
        if in_poly(x, y, HEART):
            continue
        inner.append(push(x, y, 1.2 + rng.random() * 1.1, "inner"))

    # arestas de proximidade (teia que liga tudo)
    pool = [i for i, n in enumerate(nodes)
            if n[4] in ("body", "inner", "disc")]
    seen = set()
    for i in pool:
        n = nodes[i]
        near = sorted(((j, math.hypot(nodes[j][0] - n[0], nodes[j][1] - n[1]))
                       for j in pool if j != i), key=lambda t: t[1])
        a = 0
        for j, dd in near:
            if a >= 2 or dd > 32:
                break
            k = (min(i, j), max(i, j))
            if k not in seen:
                seen.add(k)
                link(i, j, False)
            a += 1

    return nodes, edges


def main():
    nodes, edges = build()
    img = Image.new("RGB", (W, W), BG)
    layer = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    for a, b, struct in edges:
        d.line([(nodes[a][0] * S, nodes[a][1] * S),
                (nodes[b][0] * S, nodes[b][1] * S)],
               fill=TINT + (110 if struct else 52,), width=2)
    for x, y, r, op, kind in nodes:
        col = TINT if kind in ("inner", "wing") else GOLD
        px, py = x * S, y * S
        if kind == "pupil":
            d.ellipse([px - 9 * S, py - 9 * S, px + 9 * S, py + 9 * S],
                      fill=GOLD + (55,))
        alpha = int(255 * (1.0 if kind == "pupil" else op))
        rr = r * S
        d.ellipse([px - rr, py - rr, px + rr, py + rr], fill=col + (alpha,))

    img.paste(layer, (0, 0), layer)
    out = "/tmp/owl_preview.png"
    img.save(out)
    print(f"{len(nodes)} nos, {len(edges)} arestas -> {out}")


if __name__ == "__main__":
    main()
