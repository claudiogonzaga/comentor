#!/usr/bin/env python3
"""
Gera src/constants/sleepAwarenessCards.ts a partir da planilha de cards.

A planilha (assets/data/sleep_awareness_cards.xlsx) é a base de citações sobre
a importância do sono usada nas notificações de conscientização. Este script
a converte num módulo TypeScript empacotado no app (funciona 100% offline).

Uso:  python3 scripts/generate_sleep_cards.py
"""

import json
import os

import openpyxl

ROOT = os.path.join(os.path.dirname(__file__), "..")
XLSX = os.path.join(ROOT, "assets", "data", "sleep_awareness_cards.xlsx")
OUT = os.path.join(ROOT, "src", "constants", "sleepAwarenessCards.ts")


def build():
    wb = openpyxl.load_workbook(XLSX)
    ws = wb.worksheets[0]
    cards = []
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i == 0:
            continue  # cabeçalho
        cells = (list(row) + [None] * 5)[:5]
        text, tags, _tema, author, source = cells
        if not text or not str(text).strip():
            continue
        cards.append(
            {
                "text": str(text).strip(),
                "tags": str(tags).strip() if tags else "",
                "author": str(author).strip() if author else "",
                "source": str(source).strip() if source else "",
            }
        )

    lines = [
        "// GERADO AUTOMATICAMENTE por scripts/generate_sleep_cards.py",
        "// Fonte: assets/data/sleep_awareness_cards.xlsx — não editar à mão.",
        "// Para atualizar: troque a planilha e rode o script de novo.",
        "",
        "export interface SleepAwarenessCard {",
        "  text: string;",
        "  tags: string;",
        "  author: string;",
        "  source: string;",
        "}",
        "",
        "export const SLEEP_AWARENESS_CARDS: SleepAwarenessCard[] = [",
    ]
    for c in cards:
        lines.append("  {")
        lines.append(f"    text: {json.dumps(c['text'], ensure_ascii=False)},")
        lines.append(f"    tags: {json.dumps(c['tags'], ensure_ascii=False)},")
        lines.append(f"    author: {json.dumps(c['author'], ensure_ascii=False)},")
        lines.append(f"    source: {json.dumps(c['source'], ensure_ascii=False)},")
        lines.append("  },")
    lines.append("];")
    lines.append("")

    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"{len(cards)} cards -> {OUT}")


if __name__ == "__main__":
    build()
