#!/usr/bin/env python3
"""Gera os ícones do app a partir do medalhão da coruja (owl-mascot.png).

Saídas:
  assets/icon.png          — ícone iOS/geral (fundo terracota, sem alfa)
  assets/adaptive-icon.png — primeiro plano do ícone adaptativo Android
  assets/splash-icon.png   — imagem da splash (fundo transparente)
  assets/favicon.png       — favicon web
"""

from PIL import Image

SRC = "assets/owl-mascot.png"
CLAY = (194, 104, 59)  # #C2683B


def render(size, frac, bg):
    owl = Image.open(SRC).convert("RGBA").resize(
        (int(size * frac),) * 2, Image.LANCZOS)
    if bg is None:
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    else:
        canvas = Image.new("RGBA", (size, size), bg + (255,))
    off = (size - owl.width) // 2
    canvas.paste(owl, (off, off), owl)
    return canvas


def main():
    render(1024, 0.80, CLAY).convert("RGB").save("assets/icon.png")
    render(1024, 0.62, None).save("assets/adaptive-icon.png")
    render(1024, 0.94, None).save("assets/splash-icon.png")
    render(64, 0.90, CLAY).convert("RGB").save("assets/favicon.png")
    print("ícones gerados: icon, adaptive-icon, splash-icon, favicon")


if __name__ == "__main__":
    main()
