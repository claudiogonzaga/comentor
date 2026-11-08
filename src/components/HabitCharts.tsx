// Os gráficos do detalhe de um hábito: o mapa de calor de 120 dias, a curva da
// força e as barras de gatilhos (hábitos de parar). Tudo em react-native-svg,
// com as cores do tema e a largura medida na hora (onLayout), para caber em
// qualquer tela sem rolar para o lado.

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { addDays, heatColor, parseDay, todayISO, withAlpha } from './habitShared';
import { colors, spacing, typography } from '../theme';

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function useWidth(): [number, (e: LayoutChangeEvent) => void] {
  const [w, setW] = useState(0);
  return [w, (e) => setW(Math.floor(e.nativeEvent.layout.width))];
}

/**
 * Mapa de calor: uma coluna por semana (domingo em cima), o último quadrado é
 * hoje. Tocar num dia abre a folha daquele dia — o toque é calculado pela
 * posição, com a célula inteira (e o vão) como alvo, porque quadradinhos de
 * 14 px seriam difíceis de acertar um a um.
 */
export function HabitHeatmap({
  heat,
  createdDay,
  onDayPress,
}: {
  heat: string;
  /** Dias antes disto não abrem (o hábito não existia). */
  createdDay?: string;
  onDayPress?: (day: string) => void;
}) {
  const [width, onLayout] = useWidth();
  const n = heat.length;
  const today = todayISO();
  const start = addDays(today, -(n - 1));
  const pad = parseDay(start).getDay();
  const cols = Math.ceil((pad + n) / 7);
  const gap = 3;
  const labelH = 14;
  const cell = width > 0 ? Math.min(22, Math.floor((width - (cols - 1) * gap) / cols)) : 0;
  const step = cell + gap;
  const height = labelH + 7 * cell + 6 * gap;

  // Rótulo do mês na coluna em que o mês começa (ou na primeira).
  const monthLabels: { col: number; text: string }[] = [];
  let lastMonth = -1;
  for (let c = 0; c < cols; c++) {
    const idx = Math.max(0, c * 7 - pad);
    if (idx >= n) break;
    const m = parseDay(addDays(start, idx)).getMonth();
    if (m !== lastMonth) {
      // Evita dois rótulos colados (o primeiro mês pode ter só uma coluna).
      if (monthLabels.length === 0 || c - monthLabels[monthLabels.length - 1].col >= 3) {
        monthLabels.push({ col: c, text: MONTHS[m] });
      }
      lastMonth = m;
    }
  }

  const press = (x: number, y: number) => {
    if (!onDayPress || cell <= 0) return;
    const c = Math.floor(x / step);
    const r = Math.floor((y - labelH) / step);
    if (c < 0 || r < 0 || r > 6) return;
    const idx = c * 7 + r - pad;
    if (idx < 0 || idx >= n) return;
    const day = addDays(start, idx);
    if (createdDay && day < createdDay) return;
    onDayPress(day);
  };

  const done = heat.split('').filter((ch) => ch === 'F' || ch === 'M').length;

  return (
    <View onLayout={onLayout}>
      {cell > 0 && (
        <Pressable
          onPress={(e) => press(e.nativeEvent.locationX, e.nativeEvent.locationY)}
          accessibilityRole="button"
          accessibilityLabel={`Mapa dos últimos ${n} dias: ${done} feitos. Toque num dia para ver ou corrigir.`}
        >
          <Svg width={cols * step - gap} height={height}>
            {monthLabels.map((m) => (
              <SvgText
                key={`${m.col}-${m.text}`}
                x={m.col * step}
                y={10}
                fontSize={10}
                fill={colors.text.tertiary}
              >
                {m.text}
              </SvgText>
            ))}
            {heat.split('').map((ch, i) => {
              const k = i + pad;
              const c = Math.floor(k / 7);
              const r = k % 7;
              const outline = ch === 'H' || ch === '-';
              return (
                <Rect
                  key={i}
                  x={c * step + (outline ? 0.5 : 0)}
                  y={labelH + r * step + (outline ? 0.5 : 0)}
                  width={outline ? cell - 1 : cell}
                  height={outline ? cell - 1 : cell}
                  rx={2}
                  fill={heatColor(ch)}
                  stroke={ch === 'H' ? colors.accent.gold : ch === '-' ? withAlpha(colors.text.primary, 0.12) : 'none'}
                  strokeWidth={outline ? 1 : 0}
                />
              );
            })}
          </Svg>
        </Pressable>
      )}
      <View style={styles.legend}>
        <LegendItem color={heatColor('F')} label="feito" />
        <LegendItem color={heatColor('M')} label="mínimo" />
        <LegendItem color={heatColor('O')} label="folga" />
        <LegendItem color={heatColor('N')} label="não fiz" />
        <LegendItem color={heatColor('.')} label="sem registro" />
      </View>
    </View>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

/** A força ao longo dos dias (0..1), com as linhas de 50% e 80% (as mudanças de fase). */
export function StrengthChart({ series, height = 120 }: { series: number[]; height?: number }) {
  const [width, onLayout] = useWidth();
  const n = series.length;
  const padR = 30;
  const w = Math.max(0, width - padR);
  const y = (v: number) => 4 + (1 - Math.max(0, Math.min(1, v))) * (height - 8);
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * w);
  const line = series.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = n > 0 ? `${line} L${x(n - 1).toFixed(1)},${height} L0,${height} Z` : '';
  return (
    <View onLayout={onLayout} accessibilityLabel={`Força: de ${Math.round((series[0] ?? 0) * 100)}% a ${Math.round((series[n - 1] ?? 0) * 100)}% nos últimos ${n} dias`}>
      {width > 0 && n > 0 && (
        <Svg width={width} height={height}>
          {[0.5, 0.8].map((g) => (
            <Line
              key={g}
              x1={0}
              x2={w}
              y1={y(g)}
              y2={y(g)}
              stroke={colors.border}
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          ))}
          {[0.5, 0.8].map((g) => (
            <SvgText key={`t${g}`} x={w + 4} y={y(g) + 4} fontSize={10} fill={colors.text.tertiary}>
              {`${g * 100}%`}
            </SvgText>
          ))}
          <Path d={area} fill={withAlpha(colors.accent.gold, 0.12)} />
          <Path d={line} stroke={colors.accent.gold} strokeWidth={2} fill="none" strokeLinejoin="round" />
        </Svg>
      )}
      <View style={styles.axis}>
        <Text style={styles.axisText}>{n} dias atrás</Text>
        <Text style={[styles.axisText, { marginRight: padR }]}>hoje</Text>
      </View>
    </View>
  );
}

/** Barras de gatilhos: por rótulo, vontades superadas (cheio) e deslizes (claro). */
export function TriggerBars({ rows }: { rows: { label: string; resisted: number; slips: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.resisted + r.slips));
  return (
    <View style={{ gap: spacing.sm }}>
      {rows.map((r) => (
        <View
          key={r.label}
          style={styles.barRow}
          accessibilityLabel={`${r.label}: ${r.resisted} vontades superadas, ${r.slips} deslizes`}
        >
          <Text style={styles.barLabel} numberOfLines={1}>
            {r.label}
          </Text>
          <View style={styles.barTrack}>
            <View style={{ flex: r.resisted / max, backgroundColor: colors.accent.gold }} />
            <View style={{ flex: r.slips / max, backgroundColor: withAlpha(colors.accent.danger, 0.5) }} />
            <View style={{ flex: 1 - (r.resisted + r.slips) / max }} />
          </View>
          <Text style={styles.barCount}>
            {r.resisted}·{r.slips}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendSwatch: { width: 10, height: 10, borderRadius: 2 },
  legendText: { ...typography.small, fontSize: 11, color: colors.text.secondary },
  axis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  axisText: { ...typography.small, fontSize: 11, color: colors.text.tertiary },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 24 },
  barLabel: { ...typography.small, color: colors.text.secondary, width: 92 },
  barTrack: {
    flex: 1,
    height: 12,
    flexDirection: 'row',
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: colors.bg.surfaceStrong,
  },
  barCount: { ...typography.small, color: colors.text.tertiary, width: 40, textAlign: 'right' },
});
