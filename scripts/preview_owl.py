#!/usr/bin/env python3
"""Previa do mascote: coruja de Atena de PERFIL, estilo vaso grego (figura
negra), emoldurada por ramos de louro.

NAO faz parte do app — so conferencia visual. Gera /tmp/owl_preview.png.
"""

import math

from PIL import Image, ImageDraw

W = 760
BG = (201, 109, 63)       # terracota
INK = (26, 18, 13)        # figura negra
CLAY = (224, 146, 96)     # incisao / detalhe terracota claro


def T(x, y, ox, oy, s):
    return (ox + x * s, oy + y * s)


def leaf(d, x, y, ang, ln, wd, fill, vein):
    """Folha de louro pontuda."""
    dx, dy = math.cos(ang), math.sin(ang)
    px, py = -dy, dx
    tip = (x + dx * ln, y + dy * ln)
    base = (x, y)
    s1 = (x + dx * ln * 0.45 + px * wd, y + dy * ln * 0.45 + py * wd)
    s2 = (x + dx * ln * 0.45 - px * wd, y + dy * ln * 0.45 - py * wd)
    d.polygon([base, s1, tip, s2], fill=fill)
    d.line([base, tip], fill=vein, width=2)


def laurel(d, ox, oy, s, mirror):
    """Ramo de louro curvando de baixo para cima."""
    sign = -1 if mirror else 1
    pts = []
    for t in range(13):
        f = t / 12
        # curva subindo e fechando para dentro no topo
        x = 120 + sign * (96 - 70 * f - 26 * math.sin(f * math.pi))
        y = 250 - 232 * f
        pts.append((x, y))
    sm = [T(x, y, ox, oy, s) for x, y in pts]
    d.line(sm, fill=INK, width=max(2, int(2.4 * s)), joint="curve")
    for i in range(1, len(pts) - 1):
        x, y = pts[i]
        nx, ny = pts[i + 1]
        ang = math.atan2(ny - y, nx - x)
        for side in (1, -1):
            leaf(d, *T(x, y, ox, oy, s), ang + side * 1.05,
                 26 * s, 7.5 * s, INK, CLAY)


def owl(d, ox, oy, s):
    """Coruja de perfil, virada para a direita, figura negra."""
    def t(x, y):
        return T(x, y, ox, oy, s)

    def disc(cx, cy, rx, ry, fill):
        d.ellipse([*t(cx - rx, cy - ry), *t(cx + rx, cy + ry)], fill=fill)

    def poly(pts, fill):
        d.polygon([t(x, y) for x, y in pts], fill=fill)

    def line(pts, fill, w):
        d.line([t(x, y) for x, y in pts], fill=fill, width=max(2, int(w * s)),
               joint="curve")

    # ---- silhueta preta ----
    # cauda (atras/baixo, lado esquerdo)
    poly([(74, 196), (54, 250), (96, 232), (102, 206)], INK)
    # pernas
    line([(108, 214), (106, 250)], INK, 4)
    line([(132, 216), (134, 250)], INK, 4)
    for fx in (106, 134):
        for dxt in (-9, 0, 9):
            line([(fx, 250), (fx + dxt, 262)], INK, 3)
    # corpo
    disc(116, 158, 52, 66, INK)
    # cabeca (deslocada para a frente / direita)
    disc(132, 80, 45, 43, INK)
    # bico ganchudo apontando para a direita
    poly([(170, 74), (196, 90), (168, 100)], INK)

    # ---- detalhes em terracota (incisao) ----
    # olho grande, voltado para a frente-direita
    ex, ey = 150, 74
    d.ellipse([*t(ex - 14, ey - 14), *t(ex + 14, ey + 14)], fill=CLAY)
    d.ellipse([*t(ex - 6, ey - 6), *t(ex + 6, ey + 6)], fill=INK)
    d.ellipse([*t(ex - 11, ey - 4), *t(ex - 5, ey + 2)], fill=CLAY)
    # sobrancelha
    line([(120, 56), (158, 52)], CLAY, 3)
    # contorno da asa dobrada (separa dorso do peito)
    line([(96, 108), (88, 160), (104, 204)], CLAY, 2.5)
    # penas da asa — fileiras de escamas
    for row in range(4):
        yy = 120 + row * 24
        for k in range(3):
            xx = 92 + k * 22
            d.arc([*t(xx - 11, yy - 9), *t(xx + 11, yy + 11)],
                  200, 340, fill=CLAY, width=max(2, int(1.8 * s)))
    # penas primarias na ponta da asa
    for k in range(3):
        line([(86 + k * 12, 196), (80 + k * 12, 230)], CLAY, 2)
    # pintas no peito (coruja-de-Atena e malhada)
    for row in range(3):
        for k in range(2):
            cxp = 134 + k * 16
            cyp = 124 + row * 22
            d.ellipse([*t(cxp - 3, cyp - 3), *t(cxp + 3, cyp + 3)], fill=CLAY)
    # garras
    for fx in (106, 134):
        d.ellipse([*t(fx - 4, 248), *t(fx + 4, 256)], fill=CLAY)
    # poleiro
    line([(46, 264), (196, 264)], INK, 3)


def main():
    img = Image.new("RGB", (W, W), BG)
    d = ImageDraw.Draw(img)
    s = W / 290.0
    ox, oy = (W - 240 * s) / 2, 14
    laurel(d, ox, oy, s, mirror=False)
    laurel(d, ox, oy, s, mirror=True)
    owl(d, ox, oy, s)
    out = "/tmp/owl_preview.png"
    img.save(out)
    print("ok ->", out)


if __name__ == "__main__":
    main()
