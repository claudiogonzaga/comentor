// CRIAR e EDITAR um hábito.
//
// Criar é em 3 passos curtos — o quê, quando, facilitar — porque cada passo é
// uma decisão que a pesquisa mostra que conta, e despejar tudo numa tela só faz
// a pessoa pular justamente as que mais ajudam (a pista e a versão mínima):
//   1. O QUÊ: a ação, curta; fazer ou parar; como medir.
//   2. QUANDO: a PISTA, um momento que já existe no dia. "Quando X, eu Y" dobra
//      a chance de a ação acontecer (Gollwitzer & Sheeran, 2006).
//   3. FACILITAR: a versão mínima para os dias ruins, o plano B para o
//      obstáculo provável, o porquê; e quanto a coruja deve lembrar.
// No fim, o plano numa frase, com "Dizer em voz alta": ensaiar o plano em voz
// alta reforça a ligação pista → ação.
//
// Editar é uma tela só, rolável, com o mesmo conteúdo e as ações de gestão
// (pausar, arquivar, virar lembrete, excluir).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ScreenContainer } from '../components/ScreenContainer';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { GreekIcon } from '../components/GreekIcon';
import { HABIT_ICON_CHOICES, HabitIcon } from '../components/HabitIcon';
import { TimePickerInput } from '../components/TimePickerInput';
import { PauseSheet, PAUSE_NO_DATE } from '../components/PauseSheet';
import {
  Chip,
  ChipRow,
  DAY_LETTERS,
  DAY_NAMES,
  FieldLabel,
  ScreenHeader,
  Segmented,
  addDays,
  dayLabel,
  fieldStyles,
  planSentence,
  sentenceEnd,
  withAlpha,
} from '../components/habitShared';
import { colors, radius, spacing, typography } from '../theme';
import {
  archiveHabit,
  convertHabitToReminder,
  countFormingHabits,
  createHabit,
  deleteHabit,
  getHabit,
  pauseHabit,
  updateHabit,
} from '../services/habitos';
import {
  CUE_CHIPS,
  CUE_TIME,
  DO_TEMPLATES,
  STOP_TEMPLATES,
  cueValue,
  getTemplate,
  templateLabel,
  type HabitTemplate,
} from '../services/habitTemplates';
import { coachAvailable, suggestHabitPlan, type HabitPlanSuggestion } from '../services/habitCoach';
import { checkStrictPrereqs } from '../services/strictHabits';
import { speak, stopSpeaking } from '../services/voice';
import type {
  HabitAction,
  HabitDef,
  HabitFreq,
  HabitInput,
  HabitKind,
  HabitMeasure,
  HabitReminders,
} from '../types/habits';

interface Draft {
  title: string;
  kind: HabitKind;
  emoji: string;
  measure: HabitMeasure;
  target: string;
  unit: string;
  cue: string;
  place: string;
  scheduleTime: string;
  freq: HabitFreq;
  daysOfWeek: number[];
  perWeek: number;
  minimum: string;
  planB: string;
  why: string;
  action: HabitAction | null;
  reminders: HabitReminders;
  strict: boolean;
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

const EMPTY: Draft = {
  title: '',
  kind: 'fazer',
  emoji: '🌿',
  measure: 'sim',
  target: '',
  unit: '',
  cue: '',
  place: '',
  scheduleTime: '08:00',
  freq: 'diario',
  daysOfWeek: ALL_DAYS,
  perWeek: 3,
  minimum: '',
  planB: '',
  why: '',
  action: null,
  reminders: 'auto',
  strict: false,
};

const ACTIONS: { value: HabitAction | null; label: string }[] = [
  { value: null, label: 'Nenhuma' },
  { value: 'respiracao', label: 'Respiração' },
  { value: 'ioga', label: 'Ioga Nidra' },
  { value: 'leia', label: 'Leia para mim' },
  { value: 'zazen', label: 'Zazen' },
];

const REMINDER_OPTIONS: { value: HabitReminders; label: string; detail: string }[] = [
  {
    value: 'auto',
    label: 'Automático (recomendado)',
    detail:
      'Começa completo e diminui conforme o hábito se forma. Lembrete garante a repetição, mas em excesso atrapalha o hábito de ficar automático.',
  },
  { value: 'completo', label: 'Sempre completo', detail: 'Antes, na hora, a pergunta e as cobranças — mesmo depois de formado.' },
  { value: 'hora', label: 'Só na hora', detail: 'Um aviso no horário, sem cobrança.' },
  { value: 'nenhum', label: 'Nenhum', detail: 'Só o registro, sem avisos.' },
];

function fromHabit(h: HabitDef): Draft {
  return {
    title: h.title,
    kind: h.kind,
    emoji: h.emoji ?? EMPTY.emoji,
    measure: h.measure,
    target: h.target != null ? String(h.target) : '',
    unit: h.unit ?? '',
    cue: h.cue ?? '',
    place: h.place ?? '',
    scheduleTime: h.scheduleTime || EMPTY.scheduleTime,
    freq: h.freq,
    daysOfWeek: h.daysOfWeek?.length ? h.daysOfWeek : ALL_DAYS,
    perWeek: h.perWeek ?? 3,
    minimum: h.minimum ?? '',
    planB: h.planB ?? '',
    why: h.why ?? '',
    action: h.action,
    reminders: h.reminders,
    strict: h.strict,
  };
}

/** Aplica um HabitInput parcial (sugestão pronta, "Aplicar" da revisão) sobre o rascunho. */
function applyInput(d: Draft, p: Partial<HabitInput>): Draft {
  const n = { ...d };
  if (p.title !== undefined) n.title = p.title;
  if (p.kind !== undefined) n.kind = p.kind;
  if (p.emoji !== undefined && p.emoji) n.emoji = p.emoji;
  if (p.measure !== undefined) n.measure = p.measure;
  if (p.target !== undefined) n.target = p.target != null ? String(p.target) : '';
  if (p.unit !== undefined) n.unit = p.unit ?? '';
  if (p.cue !== undefined) n.cue = p.cue ?? '';
  if (p.place !== undefined) n.place = p.place ?? '';
  if (p.scheduleTime !== undefined && p.scheduleTime) n.scheduleTime = p.scheduleTime;
  if (p.freq !== undefined) n.freq = p.freq;
  if (p.daysOfWeek !== undefined) n.daysOfWeek = p.daysOfWeek.length ? p.daysOfWeek : ALL_DAYS;
  if (p.perWeek !== undefined && p.perWeek != null) {
    n.perWeek = p.perWeek;
    // "3 vezes por semana" só faz sentido na frequência semanal.
    if (p.freq === undefined) n.freq = 'semana';
  }
  if (p.minimum !== undefined) n.minimum = p.minimum ?? '';
  if (p.planB !== undefined) n.planB = p.planB ?? '';
  if (p.why !== undefined) n.why = p.why ?? '';
  if (p.action !== undefined) n.action = p.action;
  if (p.reminders !== undefined) n.reminders = p.reminders;
  if (p.strict !== undefined) n.strict = p.strict;
  return n;
}

function toInput(d: Draft): HabitInput {
  const parar = d.kind === 'parar';
  const qty = !parar && d.measure === 'quantidade';
  const freq: HabitFreq = parar ? 'diario' : d.freq;
  const target = parseFloat(d.target.replace(',', '.'));
  return {
    title: d.title.trim(),
    kind: d.kind,
    emoji: d.emoji,
    measure: qty ? 'quantidade' : 'sim',
    target: qty && Number.isFinite(target) ? target : null,
    unit: qty ? d.unit.trim() || null : null,
    cue: d.cue.trim() || null,
    place: d.place.trim() || null,
    scheduleTime: d.scheduleTime,
    freq,
    daysOfWeek: freq === 'dias' ? [...d.daysOfWeek].sort((a, b) => a - b) : ALL_DAYS,
    perWeek: freq === 'semana' ? d.perWeek : null,
    minimum: parar ? null : d.minimum.trim() || null,
    planB: d.planB.trim() || null,
    why: d.why.trim() || null,
    action: parar ? null : d.action,
    reminders: d.reminders,
    strict: d.strict,
  };
}

/** O que a pessoa lê e ouve no fim: o plano, a versão mínima, o plano B. */
function spokenPlan(d: Draft): string {
  const parts = [planSentence(d)];
  if (d.kind === 'fazer' && d.minimum.trim()) parts.push(`Nos dias ruins, pelo menos ${sentenceEnd(d.minimum)}`);
  if (d.kind === 'fazer' && d.planB.trim()) parts.push(sentenceEnd(d.planB));
  if (d.why.trim()) parts.push(sentenceEnd(d.why));
  return parts.join(' ');
}

export function HabitEditScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const params = (route.params ?? {}) as { type?: string; template?: string; prefill?: Partial<HabitInput> };
  const editing = !!params.type;

  const [habit, setHabit] = useState<HabitDef | null>(null);
  const [loading, setLoading] = useState(editing);
  const [draft, setDraft] = useState<Draft>(() => {
    let d = EMPTY;
    const t = getTemplate(params.template);
    if (t) d = applyInput(d, t.input);
    if (!editing && params.prefill) d = applyInput(d, params.prefill);
    return d;
  });
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [timeTouched, setTimeTouched] = useState(editing || !!params.template);
  const [aiOn, setAiOn] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [suggestion, setSuggestion] = useState<HabitPlanSuggestion | null>(null);
  const [pauseOpen, setPauseOpen] = useState(false);
  const speakingRef = useRef(false);

  const set = useCallback(<K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v })), []);

  useEffect(() => {
    coachAvailable().then(setAiOn).catch(() => setAiOn(false));
    return () => {
      if (speakingRef.current) stopSpeaking().catch(() => {});
    };
  }, []);

  // Editar: carrega o hábito e, se veio da revisão da semana, aplica a sugestão por cima.
  useEffect(() => {
    if (!editing || !params.type) return;
    let alive = true;
    getHabit(params.type)
      .then((h) => {
        if (!alive) return;
        setHabit(h);
        if (h) setDraft(params.prefill ? applyInput(fromHabit(h), params.prefill) : fromHabit(h));
      })
      .catch(() => alive && setHabit(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // Só na montagem: os parâmetros da rota não mudam com a tela aberta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parar = draft.kind === 'parar';
  const prefillKeys = useMemo(() => Object.keys(params.prefill ?? {}), [params.prefill]);
  const templates: HabitTemplate[] = parar ? STOP_TEMPLATES : DO_TEMPLATES;

  // ——— ações ———

  const applyTemplate = (t: HabitTemplate) => {
    setDraft((d) => applyInput({ ...EMPTY, reminders: d.reminders, strict: d.strict }, t.input));
    setTimeTouched(true);
  };

  const pickCue = (chip: string) => {
    const v = cueValue(chip);
    setDraft((d) => ({
      ...d,
      cue: d.cue === v ? '' : v,
      // A pista sugere um horário — só enquanto a pessoa não escolheu o dela.
      scheduleTime: !timeTouched && d.cue !== v && CUE_TIME[v] && !parar ? CUE_TIME[v] : d.scheduleTime,
    }));
  };

  const askCoach = async () => {
    if (!draft.title.trim()) {
      Alert.alert('Primeiro, o hábito', 'Escreva o que você quer fazer (ou parar) e eu ajudo com o resto.');
      return;
    }
    setAiBusy(true);
    try {
      const s = await suggestHabitPlan({ title: draft.title, kind: draft.kind, cue: draft.cue || null });
      if (!s) Alert.alert('Não deu agora', 'Não consegui falar com a IA. Você pode seguir sem ela.');
      setSuggestion(s);
    } finally {
      setAiBusy(false);
    }
  };

  const sayIt = async () => {
    speakingRef.current = true;
    try {
      await speak(spokenPlan(draft));
    } catch {
      /* sem voz: o texto está na tela */
    }
  };

  const validate = (upTo: number): string | null => {
    if (!draft.title.trim()) return parar ? 'Escreva o que você quer parar.' : 'Escreva o que você quer fazer.';
    if (upTo >= 0 && !parar && draft.measure === 'quantidade') {
      const n = parseFloat(draft.target.replace(',', '.'));
      if (!Number.isFinite(n) || n <= 0) return 'Diga a meta da quantidade (ex.: 10 páginas).';
    }
    if (upTo >= 1 && !parar && draft.freq === 'dias' && draft.daysOfWeek.length === 0) {
      return 'Escolha ao menos um dia da semana.';
    }
    return null;
  };

  const next = () => {
    const err = validate(step);
    if (err) {
      Alert.alert('Falta um detalhe', err);
      return;
    }
    setStep((s) => Math.min(2, s + 1));
  };

  const doSave = async () => {
    setSaving(true);
    try {
      const input = toInput(draft);
      if (editing && params.type) await updateHabit(params.type, input);
      else await createHabit(input);
      navigation.goBack();
    } catch (err) {
      console.warn('salvar hábito:', err);
      Alert.alert('Não consegui salvar agora', 'Tente de novo em instantes.');
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    const err = validate(2);
    if (err) {
      Alert.alert('Falta um detalhe', err);
      return;
    }
    if (!editing) {
      // Muitos hábitos ao mesmo tempo dividem a atenção e a força de cada um
      // cresce mais devagar. Avisar, não proibir.
      const forming = await countFormingHabits().catch(() => 0);
      if (forming >= 5) {
        Alert.alert(
          `Você já tem ${forming} hábitos em formação`,
          'A pesquisa sugere poucos por vez: cada hábito novo pede atenção até pegar. Quer mesmo assim, ou prefere esperar um deles se formar?',
          [
            { text: 'Esperar', style: 'cancel' },
            { text: 'Criar mesmo assim', onPress: () => void doSave() },
          ],
        );
        return;
      }
    }
    await doSave();
  };

  // ——— gestão (só editar) ———
  const type = params.type ?? '';
  const onArchive = async () => {
    if (!habit) return;
    try {
      await archiveHabit(type, !habit.archived);
      navigation.goBack();
    } catch {
      Alert.alert('Não consegui agora', 'Tente de novo em instantes.');
    }
  };
  const onEnable = async () => {
    try {
      const h = await updateHabit(type, { enabled: true });
      setHabit((cur) => h ?? (cur ? { ...cur, enabled: true } : cur));
    } catch {
      Alert.alert('Não consegui ligar agora', 'Tente de novo em instantes.');
    }
  };
  const onResume = async () => {
    try {
      await pauseHabit(type, null);
      setHabit((h) => (h ? { ...h, pausedUntil: null } : h));
    } catch {
      Alert.alert('Não consegui retomar agora', 'Tente de novo em instantes.');
    }
  };
  const onToReminder = () =>
    Alert.alert(
      'Transformar em lembrete?',
      'Lembretes não se formam: a coruja lembra sempre, sem diminuir. Bom para remédio, suplemento, compromisso. O histórico fica guardado.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Transformar',
          onPress: async () => {
            try {
              await convertHabitToReminder(type);
              navigation.popTo('Reminders');
            } catch {
              Alert.alert('Não consegui agora', 'Tente de novo em instantes.');
            }
          },
        },
      ],
    );
  const onDelete = () =>
    Alert.alert('Excluir o hábito?', `"${draft.title}" e todo o histórico dele serão apagados. Não dá para desfazer.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Excluir',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteHabit(type);
            navigation.popTo('Habits');
          } catch {
            Alert.alert('Não consegui excluir agora', 'Tente de novo em instantes.');
          }
        },
      },
    ]);

  // ——— blocos da tela ———

  const changed = (k: string) => (prefillKeys.includes(k) ? styles.suggested : null);

  const renderWhat = () => (
    <View>
      {!editing && (
        <>
          <FieldLabel style={{ marginTop: 0 }}>Fazer ou parar?</FieldLabel>
          <Segmented<HabitKind>
            options={[
              { value: 'fazer', label: 'Criar um hábito' },
              { value: 'parar', label: 'Parar um hábito' },
            ]}
            value={draft.kind}
            onChange={(k) =>
              setDraft((d) => ({ ...d, kind: k, scheduleTime: k === 'parar' && !timeTouched ? '21:00' : d.scheduleTime }))
            }
          />
          <FieldLabel>Sugestões prontas</FieldLabel>
          <ChipRow>
            {templates.map((t) => (
              <Chip
                key={t.id}
                label={templateLabel(t)}
                selected={draft.title === t.input.title}
                onPress={() => applyTemplate(t)}
                icon={<HabitIcon emoji={t.input.emoji} size={16} color={colors.accent.gold} />}
              />
            ))}
          </ChipRow>
        </>
      )}

      <FieldLabel>{parar ? 'O que você quer parar?' : 'O que você quer fazer?'}</FieldLabel>
      <TextInput
        value={draft.title}
        onChangeText={(t) => set('title', t)}
        placeholder={parar ? 'Ex.: usar o celular na cama' : 'Ex.: ler 10 páginas'}
        placeholderTextColor={colors.text.tertiary}
        style={fieldStyles.input}
        maxLength={80}
        returnKeyType="done"
      />
      <Text style={fieldStyles.hint}>
        {parar
          ? 'O comportamento, sem julgamento. Um de cada vez.'
          : 'Uma ação concreta e pequena — começa com um verbo.'}
      </Text>

      {parar && (
        <>
          <FieldLabel>Quando sentir vontade, eu vou…</FieldLabel>
          <TextInput
            value={draft.planB}
            onChangeText={(t) => set('planB', t)}
            placeholder="Ex.: beber um copo d’água e sair da sala"
            placeholderTextColor={colors.text.tertiary}
            style={[fieldStyles.input, changed('planB')]}
            maxLength={160}
          />
          <Text style={fieldStyles.hint}>
            Pôr algo no lugar funciona melhor do que só resistir: a vontade pede uma resposta.
          </Text>
        </>
      )}

      <FieldLabel>Ícone</FieldLabel>
      <View style={styles.iconGrid}>
        {HABIT_ICON_CHOICES.map((c) => {
          const on = draft.emoji === c.emoji;
          return (
            <Pressable
              key={c.emoji}
              onPress={() => set('emoji', c.emoji)}
              style={[styles.iconChip, on && styles.iconChipOn]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={c.label}
            >
              <HabitIcon name={c.icon} size={22} color={on ? colors.accent.gold : colors.text.primary} />
            </Pressable>
          );
        })}
      </View>

      {!parar && (
        <>
          <FieldLabel>Como medir</FieldLabel>
          <Segmented<HabitMeasure>
            options={[
              { value: 'sim', label: 'Sim ou não' },
              { value: 'quantidade', label: 'Quantidade' },
            ]}
            value={draft.measure}
            onChange={(m) => set('measure', m)}
          />
          {draft.measure === 'quantidade' && (
            <View style={styles.qtyRow}>
              <View style={{ flex: 1 }}>
                <FieldLabel>Meta</FieldLabel>
                <TextInput
                  value={draft.target}
                  onChangeText={(t) => set('target', t.replace(/[^0-9.,]/g, ''))}
                  placeholder="10"
                  placeholderTextColor={colors.text.tertiary}
                  keyboardType="decimal-pad"
                  style={fieldStyles.input}
                />
              </View>
              <View style={{ flex: 2 }}>
                <FieldLabel>Unidade</FieldLabel>
                <TextInput
                  value={draft.unit}
                  onChangeText={(t) => set('unit', t)}
                  placeholder="páginas, copos, minutos"
                  placeholderTextColor={colors.text.tertiary}
                  style={fieldStyles.input}
                  maxLength={20}
                />
              </View>
            </View>
          )}
        </>
      )}
    </View>
  );

  const renderCoachButton = () =>
    aiOn ? (
      <Pressable
        onPress={askCoach}
        disabled={aiBusy}
        style={({ pressed }) => [styles.coachBtn, pressed && { opacity: 0.85 }]}
        accessibilityRole="button"
      >
        {aiBusy ? (
          <ActivityIndicator color={colors.accent.gold} />
        ) : (
          <GreekIcon name="sparkle" size={18} color={colors.accent.gold} />
        )}
        <Text style={styles.coachText}>{aiBusy ? 'Pensando…' : 'Me ajude a formular'}</Text>
      </Pressable>
    ) : null;

  const renderWhen = () => (
    <View>
      {renderCoachButton()}
      <FieldLabel style={{ marginTop: spacing.md }}>
        {parar ? 'Quando a vontade costuma aparecer?' : 'Quando? Depois de algo que você já faz'}
      </FieldLabel>
      {suggestion && suggestion.cues.length > 0 && (
        <View style={styles.suggestBox}>
          <Text style={styles.suggestLabel}>Sugestões da Comentora</Text>
          <ChipRow>
            {suggestion.cues.map((c) => (
              <Chip key={c} label={c} selected={draft.cue === c} onPress={() => set('cue', draft.cue === c ? '' : c)} />
            ))}
          </ChipRow>
        </View>
      )}
      <ChipRow>
        {CUE_CHIPS.map((c) => (
          <Chip key={c} label={c} selected={draft.cue === cueValue(c)} onPress={() => pickCue(c)} />
        ))}
      </ChipRow>
      <TextInput
        value={draft.cue}
        onChangeText={(t) => set('cue', t)}
        placeholder="Ou escreva: depois de pôr o café no fogo"
        placeholderTextColor={colors.text.tertiary}
        style={[fieldStyles.input, { marginTop: spacing.sm }, changed('cue')]}
        maxLength={80}
      />
      <Text style={fieldStyles.hint}>
        Quanto mais concreta a pista, melhor: “depois de servir o café” pega mais que “de manhã”.
      </Text>

      <FieldLabel>Onde? (opcional)</FieldLabel>
      <TextInput
        value={draft.place}
        onChangeText={(t) => set('place', t)}
        placeholder="Ex.: na poltrona da sala"
        placeholderTextColor={colors.text.tertiary}
        style={fieldStyles.input}
        maxLength={60}
      />

      <View style={[{ marginTop: spacing.lg }, changed('scheduleTime')]}>
        <TimePickerInput
          label={parar ? 'Horário da conferência do dia' : 'Horário'}
          value={draft.scheduleTime}
          onChange={(v) => {
            setTimeTouched(true);
            set('scheduleTime', v);
          }}
        />
      </View>
      <Text style={fieldStyles.hint}>
        {parar
          ? 'Uma pergunta por dia, nesse horário: como foi hoje? Sem cobrança.'
          : 'Usado nos avisos e na ordem do dia. Escolha perto da pista.'}
      </Text>

      {!parar && (
        <>
          <FieldLabel>Frequência</FieldLabel>
          <Segmented<HabitFreq>
            options={[
              { value: 'diario', label: 'Todo dia' },
              { value: 'dias', label: 'Dias' },
              { value: 'semana', label: 'X por semana' },
            ]}
            value={draft.freq}
            onChange={(f) => set('freq', f)}
          />
          {draft.freq === 'dias' && (
            <View style={styles.dayRow}>
              {DAY_LETTERS.map((l, i) => {
                const on = draft.daysOfWeek.includes(i);
                return (
                  <Pressable
                    key={i}
                    onPress={() =>
                      set(
                        'daysOfWeek',
                        on ? draft.daysOfWeek.filter((x) => x !== i) : [...draft.daysOfWeek, i].sort((a, b) => a - b),
                      )
                    }
                    style={[styles.dayChip, on && styles.dayChipOn]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={DAY_NAMES[i]}
                  >
                    <Text style={[styles.dayText, on && styles.dayTextOn]}>{l}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
          {draft.freq === 'semana' && (
            <View style={[styles.perWeekRow, changed('perWeek')]}>
              <Pressable
                style={styles.stepBtn}
                onPress={() => set('perWeek', Math.max(1, draft.perWeek - 1))}
                accessibilityRole="button"
                accessibilityLabel="Menos uma vez"
              >
                <Text style={styles.stepText}>−</Text>
              </Pressable>
              <Text style={styles.perWeekText}>
                {draft.perWeek} {draft.perWeek === 1 ? 'vez' : 'vezes'} por semana
              </Text>
              <Pressable
                style={styles.stepBtn}
                onPress={() => set('perWeek', Math.min(7, draft.perWeek + 1))}
                accessibilityRole="button"
                accessibilityLabel="Mais uma vez"
              >
                <Text style={styles.stepText}>+</Text>
              </Pressable>
            </View>
          )}
          {draft.freq === 'semana' && (
            <Text style={fieldStyles.hint}>Qualquer dia serve; a semana vai de segunda a domingo.</Text>
          )}
        </>
      )}
    </View>
  );

  const renderEase = () => (
    <View>
      {/* Quem pulou a ajuda no passo anterior ainda pode pedir aqui. */}
      {!editing && !suggestion && renderCoachButton()}
      {!parar && (
        <>
          <FieldLabel>Nos dias ruins, pelo menos…</FieldLabel>
          {suggestion?.minimum ? (
            <SuggestUse text={suggestion.minimum} current={draft.minimum} onUse={() => set('minimum', suggestion.minimum)} />
          ) : null}
          <TextInput
            value={draft.minimum}
            onChangeText={(t) => set('minimum', t)}
            placeholder="Ex.: ler 1 página"
            placeholderTextColor={colors.text.tertiary}
            style={[fieldStyles.input, changed('minimum')]}
            maxLength={100}
          />
          <Text style={fieldStyles.hint}>
            A versão mínima conta como feito. Manter a sequência viva vale mais que a dose cheia.
          </Text>

          <FieldLabel>Plano B: se algo atrapalhar…</FieldLabel>
          {suggestion?.planB ? (
            <SuggestUse text={suggestion.planB} current={draft.planB} onUse={() => set('planB', suggestion.planB)} />
          ) : null}
          <TextInput
            value={draft.planB}
            onChangeText={(t) => set('planB', t)}
            placeholder="Se eu chegar tarde, eu leio 1 página antes de dormir"
            placeholderTextColor={colors.text.tertiary}
            style={[fieldStyles.input, fieldStyles.multiline, changed('planB')]}
            multiline
            maxLength={180}
          />
        </>
      )}
      {parar && suggestion?.planB ? (
        <>
          <FieldLabel>Substituição sugerida</FieldLabel>
          <SuggestUse text={suggestion.planB} current={draft.planB} onUse={() => set('planB', suggestion.planB)} />
        </>
      ) : null}

      <FieldLabel>Por quê? Quem você quer ser (opcional)</FieldLabel>
      {suggestion?.why ? <SuggestUse text={suggestion.why} current={draft.why} onUse={() => set('why', suggestion.why!)} /> : null}
      <TextInput
        value={draft.why}
        onChangeText={(t) => set('why', t)}
        placeholder="Ex.: Sou alguém que cuida do próprio sono"
        placeholderTextColor={colors.text.tertiary}
        style={fieldStyles.input}
        maxLength={140}
      />

      {!parar && (
        <>
          <FieldLabel>Ação no app</FieldLabel>
          <ChipRow>
            {ACTIONS.map((a) => (
              <Chip key={a.label} label={a.label} selected={draft.action === a.value} onPress={() => set('action', a.value)} />
            ))}
          </ChipRow>
          <Text style={fieldStyles.hint}>Se o hábito é uma prática do app, ao terminá-la ele se marca sozinho.</Text>
        </>
      )}

      <FieldLabel>Lembretes</FieldLabel>
      {parar ? (
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchTitle}>Conferência do dia</Text>
            <Text style={styles.switchHint}>
              Às {draft.scheduleTime}: “Como foi hoje?” — Dia limpo ou Escorreguei.
            </Text>
          </View>
          <Switch
            value={draft.reminders !== 'nenhum'}
            onValueChange={(v) => set('reminders', v ? 'auto' : 'nenhum')}
            trackColor={{ false: colors.bg.surfaceStrong, true: colors.accent.gold }}
            thumbColor={draft.reminders !== 'nenhum' ? colors.text.onGold : colors.text.tertiary}
          />
        </View>
      ) : (
        <View style={{ gap: spacing.sm }}>
          {REMINDER_OPTIONS.map((o) => {
            const on = draft.reminders === o.value;
            return (
              <Pressable
                key={o.value}
                onPress={() => set('reminders', o.value)}
                style={[styles.radio, on && styles.radioOn]}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
              >
                <View style={[styles.radioDot, on && styles.radioDotOn]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.radioTitle}>{o.label}</Text>
                  {on ? <Text style={styles.radioDetail}>{o.detail}</Text> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      {draft.reminders !== 'nenhum' && (
        <View style={[styles.switchRow, { marginTop: spacing.lg }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchTitle}>Rigoroso</Text>
            <Text style={styles.switchHint}>
              No aviso da hora, o celular vibra em pulsos até você responder. Para o que não pode passar.
            </Text>
          </View>
          <Switch
            value={draft.strict}
            onValueChange={(v) => {
              if (v && !checkStrictPrereqs()) return;
              set('strict', v);
            }}
            trackColor={{ false: colors.bg.surfaceStrong, true: colors.accent.gold }}
            thumbColor={draft.strict ? colors.text.onGold : colors.text.tertiary}
          />
        </View>
      )}
    </View>
  );

  const renderSummary = () => (
    <Card style={styles.summary}>
      <Text style={styles.summaryLabel}>SEU PLANO</Text>
      <Text style={styles.summaryText}>{planSentence(draft)}</Text>
      {!parar && draft.minimum.trim() ? (
        <Text style={styles.summarySmall}>Nos dias ruins, pelo menos {sentenceEnd(draft.minimum)}</Text>
      ) : null}
      {!parar && draft.planB.trim() ? <Text style={styles.summarySmall}>{sentenceEnd(draft.planB)}</Text> : null}
      <Pressable onPress={sayIt} style={styles.sayBtn} accessibilityRole="button">
        <GreekIcon name="voice" size={18} color={colors.accent.gold} />
        <Text style={styles.sayText}>Dizer em voz alta</Text>
      </Pressable>
      <Text style={styles.summaryHint}>Ensaiar o plano em voz alta ajuda a pista a puxar a ação.</Text>
    </Card>
  );

  const renderManage = () =>
    habit ? (
      <View style={styles.manage}>
        <FieldLabel>Gerenciar</FieldLabel>
        {!habit.enabled && (
          <ManageRow label="Ligar de novo" detail="Está desligado: não aparece no dia nem avisa" onPress={onEnable} />
        )}
        {habit.pausedUntil ? (
          <ManageRow
            label="Retomar hoje"
            detail={habit.pausedUntil === PAUSE_NO_DATE ? 'Pausado sem data' : `Pausado; voltaria em ${dayLabel(addDays(habit.pausedUntil, 1))}`}
            onPress={onResume}
          />
        ) : (
          <ManageRow label="Pausar até…" detail="Férias, doença: dias pausados não contam" onPress={() => setPauseOpen(true)} />
        )}
        <ManageRow label={habit.archived ? 'Desarquivar' : 'Arquivar'} detail="Sai da lista do dia; o histórico fica" onPress={onArchive} />
        <ManageRow label="Transformar em lembrete" detail="Lembra sempre, sem se formar" onPress={onToReminder} />
        <ManageRow label="Excluir" danger onPress={onDelete} />
      </View>
    ) : null;

  // ——— tela ———

  if (editing && loading) {
    return (
      <ScreenContainer>
        <ScreenHeader title="Editar hábito" onBack={() => navigation.goBack()} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent.gold} />
        </View>
      </ScreenContainer>
    );
  }
  if (editing && !habit) {
    return (
      <ScreenContainer>
        <ScreenHeader title="Editar hábito" onBack={() => navigation.goBack()} />
        <View style={styles.center}>
          <Text style={fieldStyles.hint}>Não achei este hábito. Talvez tenha sido apagado.</Text>
        </View>
      </ScreenContainer>
    );
  }

  const STEP_TITLES = [parar ? 'O que você quer parar?' : 'O que você quer fazer?', 'Quando?', 'Facilitar'];

  return (
    <ScreenContainer>
      <ScreenHeader
        title={editing ? 'Editar hábito' : 'Novo hábito'}
        onBack={() => (!editing && step > 0 ? setStep(step - 1) : navigation.goBack())}
        backLabel={!editing && step > 0 ? '‹ Anterior' : '‹ Voltar'}
        right={!editing ? <Text style={styles.stepCount}>{step + 1} de 3</Text> : undefined}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {prefillKeys.length > 0 && (
            <View style={styles.prefillNote}>
              <GreekIcon name="sparkle" size={16} color={colors.accent.gold} />
              <Text style={styles.prefillText}>Sugestão da revisão aplicada (destacada). Salve para confirmar.</Text>
            </View>
          )}

          {editing ? (
            <>
              <Text style={styles.sectionTitle}>O quê</Text>
              {renderWhat()}
              <Text style={[styles.sectionTitle, styles.sectionGap]}>Quando</Text>
              {renderWhen()}
              <Text style={[styles.sectionTitle, styles.sectionGap]}>Facilitar</Text>
              {renderEase()}
              <View style={{ height: spacing.xl }} />
              {renderSummary()}
              <Button label="Salvar" onPress={save} loading={saving} />
              {renderManage()}
            </>
          ) : (
            <>
              <View style={styles.dots}>
                {[0, 1, 2].map((i) => (
                  <View key={i} style={[styles.dot, i <= step && styles.dotOn]} />
                ))}
              </View>
              <Text style={styles.stepTitle} accessibilityRole="header">
                {STEP_TITLES[step]}
              </Text>
              {step === 0 && renderWhat()}
              {step === 1 && renderWhen()}
              {step === 2 && (
                <>
                  {renderEase()}
                  <View style={{ height: spacing.xl }} />
                  {renderSummary()}
                </>
              )}
              <View style={{ height: spacing.lg }} />
              {step < 2 ? (
                <Button label="Continuar" onPress={next} />
              ) : (
                <Button label="Salvar" onPress={save} loading={saving} />
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <PauseSheet
        visible={pauseOpen}
        title={`Pausar "${draft.title}"`}
        onClose={() => setPauseOpen(false)}
        onConfirm={async (until) => {
          try {
            await pauseHabit(type, until);
            setHabit((h) => (h ? { ...h, pausedUntil: until } : h));
          } catch {
            Alert.alert('Não consegui pausar agora', 'Tente de novo em instantes.');
          }
        }}
      />
    </ScreenContainer>
  );
}

/** A sugestão da Comentora, com "Usar" — some quando já está no campo. */
function SuggestUse({ text, onUse, current }: { text: string; onUse: () => void; current: string }) {
  if (!text || text === current) return null;
  return (
    <Pressable onPress={onUse} style={styles.suggestInline} accessibilityRole="button" accessibilityLabel={`Usar: ${text}`}>
      <GreekIcon name="sparkle" size={14} color={colors.accent.gold} />
      <Text style={styles.suggestInlineText}>{text}</Text>
      <Text style={styles.suggestUse}>Usar</Text>
    </Pressable>
  );
}

function ManageRow({
  label,
  detail,
  onPress,
  danger,
}: {
  label: string;
  detail?: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.manageRow, pressed && { opacity: 0.85 }]}
      accessibilityRole="button"
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.manageLabel, danger && { color: colors.accent.danger }]}>{label}</Text>
        {detail ? <Text style={styles.manageDetail}>{detail}</Text> : null}
      </View>
      <GreekIcon name="chevronRight" size={16} color={colors.text.tertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxxl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  stepCount: { ...typography.small, color: colors.text.secondary },
  dots: { flexDirection: 'row', gap: 6, marginTop: spacing.xs },
  dot: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.bg.surfaceStrong },
  dotOn: { backgroundColor: colors.accent.gold },
  stepTitle: { ...typography.title, color: colors.text.primary, marginTop: spacing.lg, marginBottom: spacing.sm },
  sectionTitle: { ...typography.title, color: colors.text.primary, marginTop: spacing.sm },
  sectionGap: { marginTop: spacing.xxl },
  prefillNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: withAlpha(colors.accent.gold, 0.12),
    marginBottom: spacing.md,
  },
  prefillText: { ...typography.small, color: colors.text.primary, flex: 1 },
  suggested: { borderColor: colors.accent.gold, borderWidth: 2, borderRadius: radius.md },
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  iconChip: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconChipOn: { borderColor: colors.accent.gold, borderWidth: 2, backgroundColor: withAlpha(colors.accent.gold, 0.12) },
  qtyRow: { flexDirection: 'row', gap: spacing.sm },
  coachBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 48,
    marginTop: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.accent.gold,
  },
  coachText: { ...typography.bodyMedium, color: colors.accent.gold },
  suggestBox: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: withAlpha(colors.accent.gold, 0.08),
    marginBottom: spacing.md,
  },
  suggestLabel: { ...typography.label, color: colors.accent.gold, marginBottom: spacing.sm, textTransform: 'uppercase' },
  suggestInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: withAlpha(colors.accent.gold, 0.08),
    marginBottom: spacing.sm,
  },
  suggestInlineText: { ...typography.small, color: colors.text.primary, flex: 1 },
  suggestUse: { ...typography.label, color: colors.accent.gold },
  dayRow: { flexDirection: 'row', gap: 4, marginTop: spacing.md },
  dayChip: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dayChipOn: { backgroundColor: colors.accent.gold, borderColor: colors.accent.gold },
  dayText: { ...typography.bodyMedium, color: colors.text.secondary },
  dayTextOn: { color: colors.text.onGold },
  perWeekRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
  perWeekText: { ...typography.bodyMedium, color: colors.text.primary, flex: 1, textAlign: 'center' },
  stepBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { ...typography.title, color: colors.accent.gold },
  radio: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    minHeight: 48,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg.surface,
  },
  radioOn: { borderColor: colors.accent.gold },
  radioDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
    marginTop: 2,
  },
  radioDotOn: { borderColor: colors.accent.gold, backgroundColor: colors.accent.gold },
  radioTitle: { ...typography.bodyMedium, color: colors.text.primary },
  radioDetail: { ...typography.small, color: colors.text.secondary, marginTop: 2, lineHeight: 18 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  switchTitle: { ...typography.bodyMedium, color: colors.text.primary },
  switchHint: { ...typography.small, color: colors.text.secondary, marginTop: 2, lineHeight: 18 },
  summary: { marginBottom: spacing.lg },
  summaryLabel: { ...typography.label, color: colors.accent.gold },
  summaryText: { ...typography.subtitle, color: colors.text.primary, marginTop: spacing.sm },
  summarySmall: { ...typography.body, color: colors.text.secondary, marginTop: spacing.xs },
  sayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    alignSelf: 'flex-start',
    marginTop: spacing.md,
  },
  sayText: { ...typography.bodyMedium, color: colors.accent.gold },
  summaryHint: { ...typography.small, color: colors.text.tertiary },
  manage: { marginTop: spacing.xl },
  manageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  manageLabel: { ...typography.bodyMedium, color: colors.text.primary },
  manageDetail: { ...typography.small, color: colors.text.secondary },
});
