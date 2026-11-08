// Folha de UM DIA de um hábito (toque longo na Home, toque num dia do mapa de
// calor): feito, versão mínima, folga, não fiz, quantidade, desfazer. Serve para
// hoje e para dias passados — corrigir o registro de ontem é parte do jogo, não
// trapaça: a força só é honesta se o registro for.
//
// Folga e "não fiz" pedem o motivo em chips (um toque), porque o motivo é o que
// a revisão da semana usa para ajustar o plano. Nunca é cobrança.

import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { Chip, ChipRow, FieldLabel, dayLabel, fieldStyles, todayISO, withAlpha } from './habitShared';
import { colors, radius, spacing, typography } from '../theme';
import { clearHabitDay, getDayStatus, markHabit, setHabitValue } from '../services/habitos';
import type { HabitDayStatus, HabitDef, MarkResult } from '../types/habits';

const FOLGA_REASONS = ['doente', 'viagem', 'descanso', 'outro'];
const NAO_REASONS = ['sem tempo', 'esqueci', 'não quis', 'cansaço', 'outro'];

const STATUS_TEXT: Record<HabitDayStatus, string> = {
  feito: 'Feito',
  minimo: 'Versão mínima',
  parcial: 'Parcial',
  folga: 'Folga',
  nao: 'Não fiz',
  sem_resposta: 'Sem resposta',
  vazio: 'Sem registro',
  fora: 'Não era dia',
  pendente: 'Pendente',
};

interface Props {
  visible: boolean;
  habit: HabitDef | null;
  /** yyyy-MM-dd; padrão = hoje. */
  day?: string;
  onClose: () => void;
  /** Depois de qualquer mudança. `result` vem de markHabit/setHabitValue (null ao desfazer). */
  onChanged?: (result: MarkResult | null) => void;
  onOpenHabit?: (type: string) => void;
  /** Hábito de parar, hoje: "Escorreguei" abre a folha do deslize (com o contexto). */
  onSlip?: () => void;
}

export function HabitDaySheet({ visible, habit, day, onClose, onChanged, onOpenHabit, onSlip }: Props) {
  const d = day ?? todayISO();
  const isToday = d === todayISO();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<HabitDayStatus | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [mode, setMode] = useState<'main' | 'folga' | 'nao'>('main');
  const [chip, setChip] = useState<string | null>(null);
  const [freeText, setFreeText] = useState('');
  const [qty, setQty] = useState(0);
  const [qtyText, setQtyText] = useState('0');

  useEffect(() => {
    if (!visible || !habit) return;
    setMode('main');
    setChip(null);
    setFreeText('');
    setLoading(true);
    let alive = true;
    getDayStatus(habit.type, d)
      .then((s) => {
        if (!alive) return;
        setStatus(s.status);
        setReason(s.reason);
        const v = s.value ?? 0;
        setQty(v);
        setQtyText(String(v));
      })
      .catch(() => {
        if (alive) setStatus(null);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [visible, habit, d]);

  if (!habit) return null;
  const parar = habit.kind === 'parar';
  const resolved = status != null && !['pendente', 'vazio', 'fora'].includes(status);

  const run = async (fn: () => Promise<MarkResult | null>, success = false) => {
    setBusy(true);
    try {
      const r = await fn();
      if (success) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onChanged?.(r);
      onClose();
    } catch (err) {
      console.warn('HabitDaySheet:', err);
      Alert.alert('Não consegui salvar agora', 'Tente de novo em instantes.');
    } finally {
      setBusy(false);
    }
  };

  const markFeito = () => run(() => markHabit(habit.type, 'feito', { day: d, via: 'home' }), true);
  const markMin = () => run(() => markHabit(habit.type, 'minimo', { day: d, via: 'home' }), true);
  const confirmFolga = () =>
    run(() => markHabit(habit.type, 'folga', { day: d, via: 'home', reason: chip ?? 'outro' }));
  const confirmNao = () => {
    const txt = freeText.trim();
    const r = [chip, txt].filter(Boolean).join(' — ') || null;
    return run(() => markHabit(habit.type, 'nao', { day: d, via: 'home', reason: r }));
  };
  const saveQty = () => run(() => setHabitValue(habit.type, qty, { day: d, via: 'home' }), qty >= (habit.target ?? 1));
  const undo = () =>
    run(async () => {
      await clearHabitDay(habit.type, d);
      return null;
    });

  const slip = () => {
    if (onSlip && isToday) {
      onClose();
      onSlip();
      return;
    }
    // Dia passado: registra o deslize sem o contexto (a folha completa é para o calor da hora).
    void run(() => markHabit(habit.type, 'nao', { day: d, via: 'home' }));
  };

  const setQtyValue = (v: number) => {
    const n = Math.max(0, Math.round(v * 10) / 10);
    setQty(n);
    setQtyText(String(n));
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={habit.title}
      subtitle={`${dayLabel(d)}${status ? ` · ${STATUS_TEXT[status]}` : ''}${reason ? ` (${reason})` : ''}`}
    >
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent.gold} />
        </View>
      ) : mode === 'main' ? (
        <View style={styles.list}>
          {habit.measure === 'quantidade' && !parar ? (
            <View style={styles.qtyBox}>
              <FieldLabel style={{ marginTop: 0 }}>
                Quanto{habit.target ? ` (meta: ${habit.target}${habit.unit ? ` ${habit.unit}` : ''})` : ''}
              </FieldLabel>
              <View style={styles.qtyRow}>
                <Pressable
                  style={styles.stepBtn}
                  onPress={() => setQtyValue(qty - 1)}
                  accessibilityRole="button"
                  accessibilityLabel="Menos um"
                >
                  <Text style={styles.stepText}>−</Text>
                </Pressable>
                <TextInput
                  value={qtyText}
                  onChangeText={(t) => {
                    const clean = t.replace(',', '.').replace(/[^0-9.]/g, '');
                    setQtyText(clean);
                    const n = parseFloat(clean);
                    if (Number.isFinite(n)) setQty(n);
                  }}
                  keyboardType="decimal-pad"
                  style={[fieldStyles.input, styles.qtyInput]}
                  accessibilityLabel="Quantidade"
                />
                <Pressable
                  style={styles.stepBtn}
                  onPress={() => setQtyValue(qty + 1)}
                  accessibilityRole="button"
                  accessibilityLabel="Mais um"
                >
                  <Text style={styles.stepText}>+</Text>
                </Pressable>
              </View>
              {habit.unit ? <Text style={styles.unit}>{habit.unit}</Text> : null}
              <View style={{ height: spacing.sm }} />
              <Button label="Salvar quantidade" onPress={saveQty} loading={busy} />
            </View>
          ) : (
            <Option label={parar ? 'Dia limpo' : 'Feito'} primary onPress={markFeito} disabled={busy} />
          )}
          {!parar && habit.minimum ? (
            <Option label="Versão mínima" detail={habit.minimum} onPress={markMin} disabled={busy} />
          ) : null}
          <Option
            label="Folga"
            detail="Dia neutro: não sobe nem desce a força"
            onPress={() => {
              setChip(null);
              setMode('folga');
            }}
            disabled={busy}
          />
          {parar ? (
            <Option label="Escorreguei" detail="Um deslize é dado, não veredito" onPress={slip} disabled={busy} />
          ) : (
            <Option
              label="Não fiz"
              onPress={() => {
                setChip(null);
                setMode('nao');
              }}
              disabled={busy}
            />
          )}
          {resolved ? <Option label="Desfazer o registro" onPress={undo} disabled={busy} subtle /> : null}
          {onOpenHabit ? (
            <Option
              label="Ver hábito"
              onPress={() => {
                onClose();
                onOpenHabit(habit.type);
              }}
              subtle
            />
          ) : null}
        </View>
      ) : (
        <View>
          <FieldLabel>{mode === 'folga' ? 'Motivo da folga' : 'O que aconteceu?'}</FieldLabel>
          <ChipRow>
            {(mode === 'folga' ? FOLGA_REASONS : NAO_REASONS).map((r) => (
              <Chip key={r} label={r} selected={chip === r} onPress={() => setChip(chip === r ? null : r)} />
            ))}
          </ChipRow>
          {mode === 'nao' ? (
            <>
              <FieldLabel>Quer contar mais? (opcional)</FieldLabel>
              <TextInput
                value={freeText}
                onChangeText={setFreeText}
                placeholder="Ex.: reunião atrasou e cheguei tarde"
                placeholderTextColor={colors.text.tertiary}
                style={fieldStyles.input}
                maxLength={200}
              />
              <Text style={fieldStyles.hint}>
                Sem culpa: o motivo serve para ajustar o plano na revisão da semana.
              </Text>
            </>
          ) : null}
          <View style={{ height: spacing.lg }} />
          <Button
            label={mode === 'folga' ? 'Marcar folga' : 'Registrar'}
            onPress={mode === 'folga' ? confirmFolga : confirmNao}
            loading={busy}
            disabled={mode === 'folga' && !chip}
          />
          <View style={{ height: spacing.sm }} />
          <Button label="Voltar" variant="ghost" onPress={() => setMode('main')} />
        </View>
      )}
    </BottomSheet>
  );
}

function Option({
  label,
  detail,
  onPress,
  primary,
  subtle,
  disabled,
}: {
  label: string;
  detail?: string;
  onPress: () => void;
  primary?: boolean;
  subtle?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.option,
        primary && styles.optionPrimary,
        subtle && styles.optionSubtle,
        pressed && { opacity: 0.85 },
        disabled && { opacity: 0.5 },
      ]}
    >
      <Text
        style={[
          styles.optionLabel,
          primary && { color: colors.text.onGold },
          subtle && { color: colors.text.secondary },
        ]}
      >
        {label}
      </Text>
      {detail ? (
        <Text style={[styles.optionDetail, primary && { color: withAlpha(colors.text.onGold, 0.85) }]}>
          {detail}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: spacing.xl, alignItems: 'center' },
  list: { gap: spacing.sm, marginTop: spacing.lg },
  option: {
    minHeight: 52,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg.surface,
  },
  optionPrimary: { backgroundColor: colors.accent.gold, borderColor: colors.accent.gold },
  optionSubtle: { backgroundColor: 'transparent', borderColor: 'transparent', minHeight: 44 },
  optionLabel: { ...typography.bodyMedium, color: colors.text.primary },
  optionDetail: { ...typography.small, color: colors.text.secondary, marginTop: 2 },
  qtyBox: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg.surface,
  },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  qtyInput: { flex: 1, textAlign: 'center', ...typography.title },
  stepBtn: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { ...typography.title, color: colors.accent.gold },
  unit: { ...typography.small, color: colors.text.secondary, textAlign: 'center', marginTop: spacing.xs },
});
