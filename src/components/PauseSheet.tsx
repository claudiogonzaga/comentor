// PAUSA: férias, doença, uma fase corrida. Os dias pausados são neutros na força
// (não sobem nem descem) e a coruja fica quieta. Pausar não é desistir — é o
// contrário: é o que impede que uma semana fora apague o mês de trabalho e a
// pessoa largue tudo. Por isso pede a data de VOLTA (sem data também vale).

import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { format } from 'date-fns';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { Chip, ChipRow, addDays, dayLabel, parseDay, todayISO } from './habitShared';
import { colors, spacing, typography } from '../theme';
import { PAUSE_FOREVER } from '../services/habitos';

/** Pausado sem data de volta (ver HabitDef.pausedUntil) — o mesmo valor do serviço. */
export const PAUSE_NO_DATE = PAUSE_FOREVER;

export function PauseSheet({
  visible,
  title,
  subtitle,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  /** Último dia da pausa, inclusive (yyyy-MM-dd) ou PAUSE_NO_DATE. */
  onConfirm: (until: string) => Promise<void> | void;
}) {
  const [until, setUntil] = useState<string>(addDays(todayISO(), 6));
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setUntil(addDays(todayISO(), 6));
      setPicking(false);
    }
  }, [visible]);

  const presets: { label: string; value: string }[] = [
    { label: '1 semana', value: addDays(todayISO(), 6) },
    { label: '2 semanas', value: addDays(todayISO(), 13) },
    { label: '1 mês', value: addDays(todayISO(), 29) },
    { label: 'Sem data', value: PAUSE_NO_DATE },
  ];

  const onPick = (e: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') setPicking(false);
    if (e.type === 'set' && date) setUntil(format(date, 'yyyy-MM-dd'));
  };

  const back = until === PAUSE_NO_DATE ? null : addDays(until, 1);

  return (
    <BottomSheet visible={visible} onClose={onClose} title={title} subtitle={subtitle}>
      <View style={{ height: spacing.lg }} />
      <ChipRow>
        {presets.map((p) => (
          <Chip key={p.label} label={p.label} selected={until === p.value} onPress={() => setUntil(p.value)} />
        ))}
        <Chip
          label="Escolher data"
          selected={!presets.some((p) => p.value === until)}
          onPress={() => setPicking(true)}
        />
      </ChipRow>
      {picking && (
        <DateTimePicker
          mode="date"
          value={until === PAUSE_NO_DATE ? parseDay(addDays(todayISO(), 6)) : parseDay(until)}
          minimumDate={parseDay(todayISO())}
          onChange={onPick}
          themeVariant="dark"
        />
      )}
      <Text style={styles.summary}>
        {back
          ? `Volta em ${dayLabel(back)}. Até lá, a coruja fica quieta e a força não muda.`
          : 'Sem data de volta: você retoma quando quiser. A força fica parada até lá.'}
      </Text>
      <View style={{ height: spacing.lg }} />
      <Button
        label="Pausar"
        loading={busy}
        onPress={async () => {
          setBusy(true);
          try {
            await onConfirm(until);
            onClose();
          } finally {
            setBusy(false);
          }
        }}
      />
      <View style={{ height: spacing.sm }} />
      <Button label="Cancelar" variant="ghost" onPress={onClose} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  summary: { ...typography.small, color: colors.text.secondary, marginTop: spacing.lg, lineHeight: 18 },
});
