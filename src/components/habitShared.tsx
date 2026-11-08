// Peças pequenas das telas de HÁBITOS (v1.130): o anel da força, o cabeçalho,
// os chips, o seletor segmentado, as datas e os textos que se repetem entre a
// Home, a lista, o detalhe e a edição. Ficam juntas para que as cinco telas
// falem a mesma língua visual — e para que trocar o tema (terracota, espacial,
// Gaia) mude tudo de uma vez: aqui nada tem cor fixa, só as do tema.

import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { format } from 'date-fns';
import { colors, radius, spacing, typography } from '../theme';
import type { HabitDef, HabitStage, HabitStats } from '../types/habits';

// ————————————————— cor —————————————————

/**
 * A cor do tema com transparência. As cores de destaque são '#RRGGBB' nos três
 * temas; as de texto são rgba(). Antes as telas usavam um dourado fixo
 * (rgba(244,197,83,…)) que no tema terracota virava um borrão amarelo.
 */
export function withAlpha(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  if (/^#[0-9a-f]{6}$/i.test(color)) {
    return color + Math.round(a * 255).toString(16).padStart(2, '0');
  }
  const m = color.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const [r, g, b] = m[1].split(',').map((s) => s.trim());
    return `rgba(${r},${g},${b},${a})`;
  }
  return color;
}

// ————————————————— datas —————————————————

export function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

/** yyyy-MM-dd → Date local ao meio-dia (meio-dia evita tropeçar no horário de verão). */
export function parseDay(iso: string): Date {
  const [y, m, d] = iso.split('-').map((s) => parseInt(s, 10));
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}

export function addDays(iso: string, n: number): string {
  const d = parseDay(iso);
  d.setDate(d.getDate() + n);
  return format(d, 'yyyy-MM-dd');
}

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** "Hoje", "Ontem" ou "seg, 3 nov". */
export function dayLabel(iso: string): string {
  const today = todayISO();
  if (iso === today) return 'Hoje';
  if (iso === addDays(today, -1)) return 'Ontem';
  const d = parseDay(iso);
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "3 nov" — curto, para listas. */
export function shortDate(iso: string): string {
  const d = parseDay(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** Letras dos dias para os chips (0 = domingo, igual a Date.getDay()). */
export const DAY_LETTERS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
export const DAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

// ————————————————— textos —————————————————

export function pct(v: number | null | undefined): string {
  return `${Math.round(Math.max(0, Math.min(1, v ?? 0)) * 100)}%`;
}

export const STAGE_LABEL: Record<HabitStage, string> = {
  aprendendo: 'Aprendendo',
  firmando: 'Firmando',
  quase: 'Quase automático',
  formado: 'Formado',
};

/**
 * Uma linha dizendo QUANTO a coruja vai lembrar, e por quê. A pessoa precisa
 * entender que o silêncio de um hábito firme é de propósito (o lembrete
 * garante a repetição, mas atrapalha a automaticidade), não um defeito.
 */
export function stageExplain(habit: HabitDef, stats: HabitStats | null): string {
  if (habit.kind === 'parar') {
    return `Um aviso por dia, às ${habit.scheduleTime}: como foi hoje? Sem cobrança.`;
  }
  if (habit.reminders === 'nenhum') return 'Sem avisos — você escolheu só registrar.';
  if (habit.reminders === 'hora') return 'Só o aviso na hora — você escolheu assim.';
  if (habit.reminders === 'completo') {
    return 'Avisos completos sempre: antes, na hora, a pergunta e as cobranças.';
  }
  switch (stats?.stage ?? 'aprendendo') {
    case 'aprendendo':
      return 'Aprendendo: a coruja avisa antes, na hora, pergunta depois e cobra se passar. É a fase que mais precisa de apoio.';
    case 'firmando':
      return 'Firmando: aviso na hora, a pergunta depois e no máximo duas cobranças.';
    case 'quase':
      return 'Quase automático: só um aviso na hora, e só se você ainda não fez.';
    case 'formado':
      return 'Formado: a coruja fica em silêncio. A cada 14 dias, quatro perguntas para conferir.';
  }
}

/** Os status crus dos eventos (getHabitReasons, revisão da semana), em português. */
export function reasonStatusLabel(status: string, kind: 'fazer' | 'parar' = 'fazer'): string {
  switch (status) {
    case 'rest':
      return 'folga';
    case 'not_done':
      return kind === 'parar' ? 'deslize' : 'não fiz';
    case 'no_answer':
      return 'sem resposta';
    case 'done':
      return kind === 'parar' ? 'dia limpo' : 'feito';
    case 'undone':
      return 'desfeito';
    default:
      return status;
  }
}

/** Preposições e locuções que já abrem uma pista ("depois do café", "ao acordar"). */
const CUE_OPENERS =
  /^(ao|aos|à|às|depois|antes|após|quando|assim que|logo|sempre que|enquanto|durante|no|na|nos|nas|em|de manhã|de tarde|de noite|toda|todo)\b/i;

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function lowerFirst(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

/**
 * "eu vou ler 10 páginas" quando o título começa por um verbo no infinitivo
 * (o mais comum: "ler", "beber água", "caminhar"); senão "eu {título}" — quem
 * escreveu "leio 10 páginas" já conjugou.
 */
function iWill(action: string): string {
  const a = lowerFirst(action.trim());
  const first = a.split(/\s+/)[0] ?? '';
  return /(ar|er|ir|or|ôr|pôr)$/i.test(first) ? `eu vou ${a}` : `eu ${a}`;
}

/**
 * O plano de implementação em uma frase — "Depois do café, eu vou ler 10
 * páginas." (planos se-então dobram a chance de o hábito acontecer;
 * Gollwitzer & Sheeran, 2006). Num hábito de parar, o plano é a substituição.
 */
export function planSentence(h: {
  kind: 'fazer' | 'parar';
  title: string;
  cue?: string | null;
  planB?: string | null;
}): string {
  const title = h.title.trim() || '…';
  if (h.kind === 'parar') {
    const sub = h.planB?.trim();
    return sub
      ? `Quando sentir vontade de ${lowerFirst(title)}, ${iWill(sub)}.`
      : `Eu vou parar de ${lowerFirst(title)}.`;
  }
  const cue = h.cue?.trim();
  if (!cue) return `${capitalize(iWill(title))}.`;
  const opener = CUE_OPENERS.test(cue) ? capitalize(cue) : `Quando ${lowerFirst(cue)}`;
  return `${opener}, ${iWill(title)}.`;
}

/** "Se {obstáculo}, então…" — mostrado como está; só garante o ponto final. */
export function sentenceEnd(s: string): string {
  const t = s.trim();
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

// ————————————————— mapa de calor —————————————————

/**
 * A cor de cada caractere do `heat` (ver HEAT_CHAR em types/habits.ts). Feito
 * é o destaque cheio; o mínimo e o parcial, o mesmo tom mais claro (contam);
 * folga é neutra (lavanda clara); não fiz e sem resposta, o vermelho de
 * cerâmica bem suave — o mapa mostra, não acusa.
 */
export function heatColor(ch: string): string {
  switch (ch) {
    case 'F':
      return colors.accent.gold;
    case 'M':
      return withAlpha(colors.accent.gold, 0.7);
    case 'P':
      return withAlpha(colors.accent.gold, 0.4);
    case 'O':
      return withAlpha(colors.accent.lavender, 0.35);
    case 'N':
      return withAlpha(colors.accent.danger, 0.5);
    case 'X':
      return withAlpha(colors.accent.danger, 0.28);
    case 'H':
      return 'transparent';
    case '-':
      return 'transparent';
    default:
      return colors.bg.surfaceStrong;
  }
}

/** Os últimos `days` dias do `heat`, em quadradinhos (a lista e a revisão). */
export function MiniHeat({ heat, days = 14, size = 10 }: { heat: string; days?: number; size?: number }) {
  const tail = heat.slice(-days).padStart(days, '-');
  return (
    <View
      style={{ flexDirection: 'row', gap: 2 }}
      accessibilityLabel={`Últimos ${days} dias: ${tail.split('').filter((c) => c === 'F' || c === 'M').length} feitos`}
    >
      {tail.split('').map((ch, i) => (
        <View
          key={i}
          style={{
            width: size,
            height: size,
            borderRadius: 2,
            backgroundColor: heatColor(ch),
            borderWidth: ch === 'H' || ch === '-' ? 1 : 0,
            borderColor: ch === 'H' ? colors.accent.gold : colors.border,
          }}
        />
      ))}
    </View>
  );
}

// ————————————————— componentes —————————————————

/** Anel da força (0..1). Pequeno na lista, grande no detalhe. */
export function StrengthRing({
  value,
  size = 36,
  stroke,
  color = colors.accent.gold,
  showLabel = true,
  labelSize,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  showLabel?: boolean;
  labelSize?: number;
}) {
  const sw = stroke ?? Math.max(3, Math.round(size / 10));
  const r = (size - sw) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value || 0));
  return (
    <View
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
      accessibilityLabel={`Força ${pct(v)}`}
    >
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.bg.surfaceStrong} strokeWidth={sw} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={sw}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c * v} ${c}`}
          // Começa às 12h, como um relógio.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {showLabel && (
        <Text
          style={{
            fontFamily: typography.label.fontFamily,
            fontSize: labelSize ?? Math.max(9, Math.round(size * 0.28)),
            color: colors.text.primary,
          }}
        >
          {Math.round(v * 100)}
        </Text>
      )}
    </View>
  );
}

/** Cabeçalho das telas de hábitos: "‹ Voltar", título, e um espaço à direita. */
export function ScreenHeader({
  title,
  onBack,
  right,
  backLabel = '‹ Voltar',
}: {
  title: string;
  onBack: () => void;
  right?: ReactNode;
  backLabel?: string;
}) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={12} style={styles.headerSide} accessibilityRole="button">
        <Text style={styles.back}>{backLabel}</Text>
      </Pressable>
      <Text style={styles.headerTitle} numberOfLines={1}>
        {title}
      </Text>
      <View style={[styles.headerSide, { alignItems: 'flex-end' }]}>{right}</View>
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  icon,
  style,
  accessibilityLabel,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: ReactNode;
  style?: ViewStyle;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipOn,
        pressed && { opacity: 0.8 },
        style,
      ]}
    >
      {icon}
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

export function ChipRow({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.chipRow, style]}>{children}</View>;
}

/** Rótulo de campo/seção, em versalete pequeno. */
export function FieldLabel({ children, style }: { children: ReactNode; style?: object }) {
  return <Text style={[styles.fieldLabel, style]}>{children}</Text>;
}

/** Seletor segmentado (Fazer/Parar, Sim-não/Quantidade…). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segment} accessibilityRole="radiogroup">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            style={[styles.segmentItem, on && styles.segmentItemOn]}
          >
            <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Estilos compartilhados de campo de texto. */
export const fieldStyles = StyleSheet.create({
  input: {
    ...typography.body,
    color: colors.text.primary,
    backgroundColor: colors.bg.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 48,
  },
  multiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  hint: {
    ...typography.small,
    color: colors.text.secondary,
    marginTop: spacing.xs,
    lineHeight: 18,
  },
});

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    minHeight: 48,
  },
  headerSide: { width: 76, minHeight: 44, justifyContent: 'center' },
  back: { ...typography.bodyMedium, color: colors.accent.gold },
  headerTitle: {
    ...typography.subtitle,
    color: colors.text.primary,
    flex: 1,
    textAlign: 'center',
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg.surface,
  },
  chipOn: {
    borderColor: colors.accent.gold,
    backgroundColor: withAlpha(colors.accent.gold, 0.14),
  },
  chipText: { ...typography.small, color: colors.text.secondary },
  chipTextOn: { color: colors.text.primary, fontFamily: typography.label.fontFamily },
  fieldLabel: {
    ...typography.label,
    color: colors.text.secondary,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },
  segment: {
    flexDirection: 'row',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg.surface,
    padding: 3,
    gap: 3,
  },
  segmentItem: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
  },
  segmentItemOn: { backgroundColor: colors.accent.gold },
  segmentText: { ...typography.bodyMedium, color: colors.text.secondary },
  segmentTextOn: { color: colors.text.onGold },
});
