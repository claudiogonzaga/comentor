#!/usr/bin/env python3
"""Mockup da estetica de vaso grego (figuras negras) para a Comentora.

NAO faz parte do app. Renderiza /tmp/theme_preview.png com duas telas:
- Dia: fundo terracota claro.
- Noite: o mesmo, com o laranja escurecido.
Ambas com figuras pretas, borda em meandro grego e a coruja estilo vaso.
"""

from PIL import Image, ImageDraw, ImageFont

PW, PH = 430, 880
GAP = 50
W, H = PW * 2 + GAP, PH

DAY_BG = (201, 109, 63)     # terracota
NIGHT_BG = (74, 41, 26)     # terracota escuro (noite)
INK = (26, 18, 13)          # "figuras negras"
CLAY_DAY = (228, 150, 99)   # tom claro para detalhes/incisao
CLAY_NIGHT = (200, 120, 78)

OWL = [
    (100, 28), (126, 32), (149, 47), (161, 75), (151, 101), (145, 110),
    (154, 135), (148, 163), (124, 183), (100, 189), (76, 183), (52, 163),
    (46, 135), (55, 110), (49, 101), (39, 75), (51, 47), (74, 32),
]


def fnt(path, sz):
    for p in (path, "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(p, sz)
        except OSError:
            continue
    return ImageFont.load_default()


SERIF = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"
SANS = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def meander(d, x, y, w, color, flip=False):
    """Borda em meandro grego (grega) — espiral quadrada repetida."""
    u = 30
    th = 4
    for i in range(x, x + w - u, u):
        pts = [(2, 22), (2, 6), (24, 6), (24, 20), (10, 20),
               (10, 12), (18, 12)]
        seg = [(i + px, y + (28 - py if flip else py)) for px, py in pts]
        d.line(seg, fill=color, width=th, joint="curve")


def owl(d, cx, cy, scale, bg, clay):
    """Coruja estilo vaso: silhueta preta com olhos e incisoes em terracota."""
    def P(pts):
        return [(cx + (px - 100) * scale, cy + (py - 105) * scale)
                for px, py in pts]

    # corpo preto
    d.polygon(P(OWL), fill=INK)
    # disco facial — incisao em terracota (coracao)
    heart = [(100, 58), (78, 50), (58, 62), (52, 88), (64, 120),
             (100, 140), (136, 120), (148, 88), (142, 62), (122, 50)]
    d.line(P(heart) + [P(heart)[0]], fill=clay, width=max(2, int(2 * scale)))
    # olhos: circulos terracota com pupila preta
    for ex in (78, 122):
        r = 17 * scale
        px, py = cx + (ex - 100) * scale, cy + (90 - 105) * scale
        d.ellipse([px - r, py - r, px + r, py + r], fill=clay)
        d.ellipse([px - r * 0.42, py - r * 0.42, px + r * 0.42,
                   py + r * 0.42], fill=INK)
    # bico terracota
    d.polygon(P([(100, 100), (92, 122), (108, 122)]), fill=clay)
    # incisoes de plumagem no peito (chevrons)
    for k in range(3):
        yy = 138 + k * 14
        d.line(P([(82, yy), (100, yy + 8), (118, yy)]), fill=clay,
               width=max(2, int(1.6 * scale)))
    # pes
    for fx in (88, 112):
        d.line(P([(fx, 188), (fx, 198)]), fill=INK, width=max(2, int(3 * scale)))


def card(d, x, y, w, h, bg, clay, title, body, fnt_t, fnt_b):
    d.rounded_rectangle([x, y, x + w, y + h], radius=14, fill=INK,
                        outline=clay, width=2)
    d.text((x + 22, y + 18), title, font=fnt_t, fill=clay)
    for i, line in enumerate(body):
        d.text((x + 22, y + 52 + i * 26), line, font=fnt_b, fill=clay)


def screen(d, ox, bg, clay, label):
    d.rectangle([ox, 0, ox + PW, PH], fill=bg)

    # bordas em meandro
    meander(d, ox + 20, 22, PW - 40, INK)
    meander(d, ox + 20, PH - 50, PW - 40, INK, flip=True)

    # coruja
    owl(d, ox + PW // 2, 168, 0.92, bg, clay)

    # titulo
    ft = fnt(SERIF, 44)
    fs = fnt(SANS, 19)
    t = "COMENTORA"
    tw = d.textlength(t, font=ft)
    d.text((ox + PW / 2 - tw / 2, 270), t, font=ft, fill=INK)
    s = "a coruja de Atena, sua coach de sono"
    sw = d.textlength(s, font=fs)
    d.text((ox + PW / 2 - sw / 2, 322), s, font=fs, fill=INK)

    # cards
    fct = fnt(SERIF, 20)
    fcb = fnt(SANS, 17)
    card(d, ox + 28, 372, PW - 56, 132, bg, clay, "SUA NOITE",
         ["Você dormiu no horário", "4 dias seguidos. Siga assim."],
         fct, fcb)
    card(d, ox + 28, 524, PW - 56, 110, bg, clay, "HORÁRIO",
         ["Deitar às 23:00 — faltam 2h."], fct, fcb)

    # botao
    bx, by, bw, bh = ox + 28, 670, PW - 56, 58
    d.rounded_rectangle([bx, by, bx + bw, by + bh], radius=29, fill=INK,
                        outline=clay, width=2)
    fb = fnt(SERIF, 20)
    bt = "Conversar com a Comentora"
    bw2 = d.textlength(bt, font=fb)
    d.text((bx + bw / 2 - bw2 / 2, by + bh / 2 - 13), bt, font=fb, fill=clay)

    # etiqueta
    fl = fnt(SANS, 16)
    lw = d.textlength(label, font=fl)
    d.text((ox + PW / 2 - lw / 2, PH - 36), label, font=fl, fill=INK)


def main():
    img = Image.new("RGB", (W, H), (15, 15, 20))
    d = ImageDraw.Draw(img)
    screen(d, 0, DAY_BG, CLAY_DAY, "DIA")
    screen(d, PW + GAP, NIGHT_BG, CLAY_NIGHT, "NOITE")
    out = "/tmp/theme_preview.png"
    img.save(out)
    print("ok ->", out)


if __name__ == "__main__":
    main()
