#!/usr/bin/env python3
"""Renderiza a coruja-rede do componente Owl.tsx para conferência visual.

NÃO faz parte do app — é só uma prévia. Replica a geometria de buildGraph()
de src/components/Owl.tsx (a aleatoriedade cosmética usa o random do Python,
mas a forma — elipse do corpo, anéis dos olhos, tufos, bico — é idêntica).
"""

import math
import random

from PIL import Image, ImageDraw

W = 720
S = W / 200.0  # viewBox 200 -> imagem

EYE_L = (74, 95, 24)
EYE_R = (126, 95, 24)
BODY = (100, 116, 60, 66)

GOLD = (244, 197, 83)
TINT = (142, 138, 200)
BG = (27, 31, 59)


def build():
    rng = random.Random(7)
    nodes = []  # (x, y, r, op, kind)
    edges = []

    def push(x, y, r, kind):
        nodes.append((x, y, r, 0.6 + rng.random() * 0.4, kind))
        return len(nodes) - 1

    # corpo
    body_idx = []
    BODY_N = 26
    for i in range(BODY_N):
        a = (i / BODY_N) * math.tau - math.pi / 2
        j = 0.93 + rng.random() * 0.13
        body_idx.append(
            push(BODY[0] + math.cos(a) * BODY[2] * j,
                 BODY[1] + math.sin(a) * BODY[3] * j,
                 1.6 + rng.random() * 1.1, "body"))
    for i in range(BODY_N):
        edges.append((body_idx[i], body_idx[(i + 1) % BODY_N]))

    # tufos
    def tuft(corners):
        idx = [push(x, y, 1.5 + rng.random() * 0.8, "tuft") for x, y in corners]
        for e in range(3):
            x1, y1 = corners[e]
            x2, y2 = corners[(e + 1) % 3]
            idx.append(push((x1 + x2) / 2, (y1 + y2) / 2,
                            1.3 + rng.random() * 0.7, "tuft"))
        order = [idx[0], idx[3], idx[1], idx[4], idx[2], idx[5]]
        for i in range(len(order)):
            edges.append((order[i], order[(i + 1) % len(order)]))

    tuft([(60, 22), (44, 66), (86, 60)])
    tuft([(140, 22), (156, 66), (114, 60)])

    # olhos
    def eye(cx, cy, r):
        N = 12
        ring = []
        for i in range(N):
            a = (i / N) * math.tau
            ring.append(push(cx + math.cos(a) * r, cy + math.sin(a) * r,
                              1.5 + rng.random() * 0.7, "eye"))
        for i in range(N):
            edges.append((ring[i], ring[(i + 1) % N]))
        pupil = push(cx, cy, 3.6, "pupil")
        for i in range(0, N, 3):
            edges.append((pupil, ring[i]))
        return ring

    eye(*EYE_L)
    eye(*EYE_R)

    # bico
    beak = [push(100, 106, 1.8, "beak"), push(92, 117, 1.5, "beak"),
            push(100, 130, 2, "beak"), push(108, 117, 1.5, "beak")]
    for i in range(4):
        edges.append((beak[i], beak[(i + 1) % 4]))

    # nós internos
    inner = []
    tries = 0
    while len(inner) < 22 and tries < 600:
        tries += 1
        x = BODY[0] + (rng.random() * 2 - 1) * BODY[2] * 0.92
        y = BODY[1] + (rng.random() * 2 - 1) * BODY[3] * 0.92
        dx = (x - BODY[0]) / BODY[2]
        dy = (y - BODY[1]) / BODY[3]
        if dx * dx + dy * dy > 0.88:
            continue
        if (math.hypot(x - EYE_L[0], y - EYE_L[1]) < EYE_L[2] + 3 or
                math.hypot(x - EYE_R[0], y - EYE_R[1]) < EYE_R[2] + 3):
            continue
        inner.append(push(x, y, 1.1 + rng.random() * 1.4, "inner"))

    # arestas de proximidade
    pool = [i for i, n in enumerate(nodes) if n[4] not in ("eye", "pupil")]
    seen = set()

    def mark(a, b):
        k = (a, b) if a < b else (b, a)
        if k in seen:
            return False
        seen.add(k)
        return True

    for i in pool:
        n = nodes[i]
        near = sorted(((j, math.hypot(nodes[j][0] - n[0], nodes[j][1] - n[1]))
                       for j in pool if j != i), key=lambda t: t[1])
        added = 0
        for j, d in near:
            if added >= 2 or d > 38:
                break
            if mark(i, j):
                edges.append((i, j))
            added += 1

    return nodes, edges


def main():
    nodes, edges = build()
    img = Image.new("RGB", (W, W), BG)
    layer = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    for a, b in edges:
        x1, y1 = nodes[a][0] * S, nodes[a][1] * S
        x2, y2 = nodes[b][0] * S, nodes[b][1] * S
        d.line([(x1, y1), (x2, y2)], fill=TINT + (70,), width=max(1, int(0.85 * S)))

    for x, y, r, op, kind in nodes:
        col = TINT if kind in ("tuft", "inner") else GOLD
        if kind == "pupil":
            col = GOLD
            d.ellipse([(x - 9) * S, (y - 9) * S, (x + 9) * S, (y + 9) * S],
                      fill=GOLD + (60,))
        alpha = int(255 * (1.0 if kind == "pupil" else op))
        rr = r * S
        d.ellipse([x * S - rr, y * S - rr, x * S + rr, y * S + rr],
                  fill=col + (alpha,))

    img.paste(layer, (0, 0), layer)
    out = "/tmp/owl_preview.png"
    img.save(out)
    print(f"{len(nodes)} nos, {len(edges)} arestas -> {out}")


if __name__ == "__main__":
    main()
