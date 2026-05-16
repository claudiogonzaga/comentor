#!/usr/bin/env python3
"""Processa a imagem escolhida do mascote num medalhao circular com fundo
transparente, pronto para uso no app.

Entrada: a imagem do ChatGPT (coruja de Atena em medalhao).
Saida: assets/owl-mascot.png (recortado no circulo, fora = transparente).
"""

from PIL import Image, ImageDraw

SRC = "assets/ChatGPT Image 16 de mai. de 2026, 14_09_53.png"
OUT = "assets/owl-mascot.png"


def main():
    im = Image.open(SRC).convert("RGBA")
    W, H = im.size
    px = im.load()

    # contagem de pixels escuros por linha e por coluna; o anel do medalhao
    # gera contagens altas — pontos esparsos de textura sao descartados
    rows = [0] * H
    cols = [0] * W
    for y in range(H):
        for x in range(W):
            r, g, b, _ = px[x, y]
            if r + g + b < 140:
                rows[y] += 1
                cols[x] += 1

    thr = 12
    ys = [y for y in range(H) if rows[y] > thr]
    xs = [x for x in range(W) if cols[x] > thr]
    minx, maxx = xs[0], xs[-1]
    miny, maxy = ys[0], ys[-1]
    print(f"bbox do anel: ({minx},{miny})-({maxx},{maxy}) "
          f"larg={maxx - minx} alt={maxy - miny}")
    cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
    radius = max(maxx - minx, maxy - miny) / 2 + 10
    print(f"emblema: centro=({cx:.0f},{cy:.0f}) raio={radius:.0f}")

    # mascara circular com antialias (4x)
    ss = 4
    mask = Image.new("L", (W * ss, H * ss), 0)
    ImageDraw.Draw(mask).ellipse(
        [(cx - radius) * ss, (cy - radius) * ss,
         (cx + radius) * ss, (cy + radius) * ss], fill=255)
    mask = mask.resize((W, H), Image.LANCZOS)
    im.putalpha(mask)

    # recorta no quadrado do circulo
    pad = 4
    box = (int(cx - radius - pad), int(cy - radius - pad),
           int(cx + radius + pad), int(cy + radius + pad))
    im = im.crop(box)
    im.save(OUT)
    print(f"salvo: {OUT} {im.size}")

    # previa sobre fundos diferentes para conferir o recorte
    prev = Image.new("RGB", (im.width * 3 + 40, im.height + 20),
                     (240, 240, 240))
    for i, bg in enumerate([(201, 109, 63), (255, 255, 255), (30, 30, 38)]):
        tile = Image.new("RGB", im.size, bg)
        tile.paste(im, (0, 0), im)
        prev.paste(tile, (10 + i * (im.width + 10), 10))
    prev.save("/tmp/mascot_preview.png")
    print("previa: /tmp/mascot_preview.png")


if __name__ == "__main__":
    main()
