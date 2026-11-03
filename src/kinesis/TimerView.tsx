// A tela do timer em andamento. No Mac é uma janelinha flutuante, sempre por cima;
// aqui ocupa a aba, e a notificação fixa faz o papel de "sempre à vista".

import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  activeCircuits,
  REGION_LETTER,
  sortedExercises,
  useKinesis,
} from './store';
import {
  fmtTime,
  isCallPhase,
  overdueSeconds,
  PHASE_LABEL,
  phaseTotalSeconds,
  remainingSeconds,
  roundsToUnlock,
  SNOOZE_MAX,
  snoozesLeft,
} from './timer';
import { Check, F, K, MeanderBar, SkipIcon } from './ui';

export function TimerView() {
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const timer = useKinesis((s) => s.timer);
  const config = useKinesis((s) => s.config);
  const minutesOnly = useKinesis((s) => s.minutesOnly);
  const exercises = useKinesis((s) => s.exercises);
  const circuits = useKinesis((s) => s.circuits);
  const budget = useKinesis((s) => s.budget);
  const actions = useKinesis.getState();

  const [now, setNow] = useState(Date.now());
  const awaiting = !!timer?.awaitingConfirm;

  useEffect(() => {
    if (!focused) return;
    const beat = () => {
      useKinesis.getState().tick();
      setNow(Date.now());
    };
    beat();
    // A piscada do "EXERCITOU?" é de 0,85 s; o relógio só precisa de 4 batidas por segundo.
    const id = setInterval(beat, awaiting ? 106 : 250);
    return () => clearInterval(id);
  }, [focused, awaiting]);

  const scheduled = useMemo(() => activeCircuits(circuits, new Date(now)), [circuits, Math.floor(now / 30000)]);
  const planned = useMemo(() => new Set(scheduled.flatMap((c) => c.items)), [scheduled]);
  // A lista É o circuito deste dia e período; sem circuito, todos, para sempre haver o que marcar.
  const rows = useMemo(
    () => sortedExercises(planned.size ? exercises.filter((ex) => planned.has(ex.id)) : exercises),
    [exercises, planned],
  );

  if (!timer) return null;

  if (timer.phase === 'finished') {
    return (
      <LinearGradient colors={[K.terracottaLight, K.terracottaDeep]} style={[styles.root, styles.center]}>
        <View style={styles.finishedBand}>
          <MeanderBar frac={1} color={K.ink} />
        </View>
        <Text style={[styles.phase, { color: K.ink, fontSize: 34 }]}>{PHASE_LABEL.finished}</Text>
        <Pressable
          onPress={actions.start}
          accessibilityRole="button"
          style={({ pressed }) => [styles.finishedBtn, pressed && { opacity: 0.75 }]}
        >
          <Text style={styles.finishedBtnText}>Reiniciar</Text>
        </Pressable>
        <Pressable onPress={actions.stop} accessibilityRole="button" hitSlop={10}>
          <Text style={[styles.finishedLink, { color: K.ink }]}>Voltar à configuração</Text>
        </Pressable>
        <View style={styles.finishedBand}>
          <MeanderBar frac={1} color={K.ink} />
        </View>
      </LinearGradient>
    );
  }

  const phase = timer.phase;
  const call = isCallPhase(phase);
  const remaining = remainingSeconds(timer, now);
  const total = phaseTotalSeconds(timer);
  const late = overdueSeconds(timer, now);
  const left = snoozesLeft(budget);

  // Pisca entre as duas cores do app: terracota e quase-preto.
  const blinkDark = awaiting && Math.floor(now / 425) % 2 === 1;
  const dark = phase === 'work' || blinkDark;
  const fg = phase === 'prepare' ? K.text : dark ? K.terracotta : K.ink;
  const gradient: [string, string] =
    phase === 'prepare'
      ? [K.indigo, K.indigoDeep]
      : dark
        ? ['#1b1916', '#000000']
        : [K.terracottaLight, K.terracottaDeep];

  const warning = !awaiting && !timer.paused && remaining <= 3 && remaining > 0;
  const showBig = awaiting ? `-${fmtTime(late ?? 0)}` : minutesOnly ? String(Math.floor(remaining / 60)) : fmtTime(remaining);
  const showUnit = !awaiting && minutesOnly;
  const showLate = !awaiting && late != null && call;
  const bigSize = call ? 92 : 170;

  return (
    <LinearGradient colors={gradient} style={[styles.root, { paddingBottom: insets.bottom + 10 }]}>
      <Text style={[styles.phase, { color: fg }]}>
        {awaiting ? 'EXERCITOU?' : PHASE_LABEL[phase]}
        {timer.paused ? ' · em pausa' : ''}
      </Text>

      <View style={[styles.countRow, !call && { flex: 1 }]}>
        <Pressable
          onPress={actions.prev}
          accessibilityRole="button"
          accessibilityLabel="Intervalo anterior"
          hitSlop={10}
          style={styles.skip}
        >
          <SkipIcon direction="prev" color={fg} />
        </Pressable>
        <Pressable
          onPress={() => !awaiting && actions.setMinutesOnly(!minutesOnly)}
          accessibilityRole="button"
          accessibilityLabel="Alternar entre minutos e minutos com segundos"
          style={styles.countPress}
        >
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            style={[styles.big, { color: fg, fontSize: bigSize, opacity: warning && Math.floor(now / 350) % 2 ? 0.4 : 1 }]}
          >
            {showBig}
            {showUnit ? <Text style={[styles.unit, { fontSize: bigSize * 0.2 }]}> min</Text> : null}
          </Text>
        </Pressable>
        <Pressable
          onPress={actions.next}
          accessibilityRole="button"
          accessibilityLabel="Próximo intervalo"
          hitSlop={10}
          style={styles.skip}
        >
          <SkipIcon direction="next" color={fg} />
        </Pressable>
      </View>

      {showUnit && (
        <View style={styles.meander}>
          <MeanderBar frac={total > 0 ? remaining / total : 0} color={fg} />
        </View>
      )}

      {showLate && (
        <Text style={[styles.late, { color: fg }]}>
          -{fmtTime(late ?? 0)} <Text style={styles.lateLabel}>atrasado</Text>
        </Text>
      )}

      <Text style={[styles.series, { color: fg }]}>
        Série {timer.currentSet} / {timer.config.sets || config.sets}
      </Text>

      {call && (
        <>
          <Text style={[styles.checkTitle, { color: fg }]} numberOfLines={2}>
            {scheduled.length
              ? `${scheduled.length > 1 ? 'CIRCUITOS' : 'CIRCUITO'}: ${scheduled.map((c) => c.name).join(' + ').toUpperCase()}`
              : 'MARQUE O QUE FEZ'}
          </Text>
          <ScrollView style={styles.checkList} contentContainerStyle={{ paddingVertical: 2 }}>
            {rows.length === 0 && (
              <Text style={[styles.checkEmpty, { color: fg }]}>Cadastre exercícios na configuração.</Text>
            )}
            {rows.map((ex) => {
              const on = timer.checkedExercises.includes(ex.id);
              return (
                <Pressable
                  key={ex.id}
                  onPress={() => actions.toggleChecked(ex.id, !on)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  style={styles.checkRow}
                >
                  <Check on={on} />
                  <Text style={styles.checkName} numberOfLines={1}>
                    {ex.name}
                  </Text>
                  <Text style={[styles.checkRegion, { color: K.region[ex.region] ?? K.muted }]}>
                    {REGION_LETTER[ex.region] ?? ''}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {awaiting && (
            <CallButton label="EXERCITAR AGORA" onPress={actions.exerciseNow} fg={fg} />
          )}
          {phase === 'rest' && (
            <Pressable
              onPress={actions.snooze}
              disabled={left === 0}
              accessibilityRole="button"
              accessibilityLabel={
                left
                  ? `Adiar ${config.snoozeMinutes} minutos. Restam ${left} de ${SNOOZE_MAX} sonecas.`
                  : `Sonecas esgotadas. Faltam ${roundsToUnlock(budget)} rodadas sem adiar.`
              }
              style={({ pressed }) => [
                styles.callBtn,
                { borderColor: fg, opacity: left === 0 ? 0.45 : pressed ? 0.75 : 1 },
              ]}
            >
              <Text style={[styles.callBtnText, { color: fg }]}>
                {left ? `ADIAR ${config.snoozeMinutes} MIN · ${left}` : `SONECA EM ${roundsToUnlock(budget)}`}
              </Text>
            </Pressable>
          )}

          <View style={styles.confirmRow}>
            <Pressable
              onPress={actions.confirm}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.confirm,
                { borderColor: K.terracotta },
                pressed && { opacity: 0.75 },
              ]}
            >
              <Text style={styles.confirmText}>✓ EXERCITEI</Text>
            </Pressable>
            {scheduled.length > 0 && (
              <Pressable
                onPress={actions.confirmCircuit}
                accessibilityRole="button"
                accessibilityLabel="Exercitei o circuito inteiro"
                style={({ pressed }) => [
                  styles.confirm,
                  { borderColor: K.terracotta },
                  pressed && { opacity: 0.75 },
                ]}
              >
                <Text style={styles.confirmText}>✓✓ CIRCUITO</Text>
              </Pressable>
            )}
          </View>
        </>
      )}

      <View style={styles.actions}>
        <TimerButton label={timer.paused ? 'RETOMAR' : 'PAUSAR'} onPress={actions.togglePause} fg={fg} />
        <TimerButton label="PARAR" onPress={actions.stop} fg={fg} />
      </View>
    </LinearGradient>
  );
}

function CallButton({ label, onPress, fg }: { label: string; onPress: () => void; fg: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.callBtn, { borderColor: fg }, pressed && { opacity: 0.75 }]}
    >
      <Text style={[styles.callBtnText, { color: fg }]}>▶ {label}</Text>
    </Pressable>
  );
}

function TimerButton({ label, onPress, fg }: { label: string; onPress: () => void; fg: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.timerBtn, { borderColor: fg }, pressed && { opacity: 0.7 }]}
    >
      <Text style={[styles.timerBtnText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 16, paddingTop: 14 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 22 },
  phase: { fontFamily: F.bold, fontSize: 24, textAlign: 'center', letterSpacing: 1 },
  countRow: { flexDirection: 'row', alignItems: 'center' },
  skip: { padding: 8 },
  countPress: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  big: { fontFamily: F.bold, textAlign: 'center', includeFontPadding: false },
  unit: { fontFamily: F.regular },
  meander: { marginTop: 4, marginBottom: 6 },
  late: { fontFamily: F.bold, fontSize: 22, textAlign: 'center', marginTop: 2 },
  lateLabel: { fontFamily: F.regular, fontSize: 15 },
  series: { fontFamily: F.regular, fontSize: 16, textAlign: 'center', marginTop: 4, marginBottom: 8 },
  checkTitle: { fontFamily: F.bold, fontSize: 14, letterSpacing: 0.6, textAlign: 'center', marginBottom: 6 },
  checkList: {
    flex: 1,
    backgroundColor: 'rgba(20,18,16,0.88)',
    borderRadius: 10,
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  checkEmpty: { fontFamily: F.regular, fontSize: 15, padding: 12, textAlign: 'center' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  checkName: { flex: 1, color: K.text, fontFamily: F.regular, fontSize: 17 },
  checkRegion: { fontFamily: F.bold, fontSize: 14, width: 18, textAlign: 'center' },
  callBtn: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
    marginBottom: 8,
  },
  callBtnText: { fontFamily: F.bold, fontSize: 16, letterSpacing: 0.6 },
  confirmRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  confirm: {
    flex: 1,
    backgroundColor: K.ink,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
  },
  confirmText: { color: K.terracotta, fontFamily: F.bold, fontSize: 18, letterSpacing: 0.6 },
  actions: { flexDirection: 'row', gap: 8 },
  timerBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  timerBtnText: { fontFamily: F.bold, fontSize: 15, letterSpacing: 0.6 },
  finishedBand: { alignSelf: 'stretch', paddingHorizontal: 16 },
  finishedBtn: { backgroundColor: K.ink, borderRadius: 10, paddingHorizontal: 34, paddingVertical: 14 },
  finishedBtnText: { color: K.terracotta, fontFamily: F.bold, fontSize: 20 },
  finishedLink: { fontFamily: F.regular, fontSize: 15, textDecorationLine: 'underline' },
});
