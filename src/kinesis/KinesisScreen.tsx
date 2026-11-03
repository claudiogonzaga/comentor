// A aba do Kinesis: timer de pausas ativas. Alterna trabalho sentado e exercício.

import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CircuitsSection } from './CircuitsSection';
import {
  activeCircuits,
  dayKey,
  nextCircuitSlot,
  PERIODS,
  periodAt,
  REGION_LABEL,
  REGION_SHORT,
  REGIONS,
  useKinesis,
  WD_LETTER,
  WD_SHORT,
  type ImportedData,
  type Preset,
} from './store';
import {
  fmtTime,
  parseField,
  preExerciseCount,
  preExerciseHint,
  roundsToUnlock,
  SNOOZE_MAX,
  snoozesLeft,
  type NumericField,
} from './timer';
import { TimerView } from './TimerView';
import { BoltIcon, F, K, Panel, SectionTitle, SelectRow, SmallButton, SOUND_LABELS, textStyles, VolumeBar } from './ui';

function soundOptions(ids: string[]) {
  return ids.map((value) => ({ value, label: SOUND_LABELS[value] ?? value }));
}

const BELLS = soundOptions(['schoolBell', 'zenBell', 'chime', 'gong', 'dingdong', 'whistle']);
const ALERTS = soundOptions(['alarm', 'siren', 'buzzer', 'whistle', 'gong']);
const PRE_SOUNDS = soundOptions(['gentle', 'chime', 'zenBell', 'dingdong']);
const ALERT_EVERY = [1, 2, 3, 5, 10].map((m) => ({ value: String(m), label: `${m} min` }));
const SNOOZE_MINUTES = [1, 3, 5, 10, 15, 30].map((m) => ({ value: String(m), label: `${m} min` }));
const PRE_PERCENT = [
  { value: '0', label: 'Desligado' },
  ...[5, 10, 15, 20, 25].map((p) => ({ value: String(p), label: `${p}%` })),
];
const PRE_COUNT = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: n === 1 ? '1 aviso' : `${n} avisos` }));

export function KinesisScreen() {
  const loaded = useKinesis((s) => s.loaded);
  const timer = useKinesis((s) => s.timer);
  if (!loaded) return <View style={styles.root} />;
  return timer ? <TimerView /> : <ConfigView />;
}

function ConfigView() {
  const insets = useSafeAreaInsets();
  const config = useKinesis((s) => s.config);
  const volume = useKinesis((s) => s.volume);
  const minutesOnly = useKinesis((s) => s.minutesOnly);
  const budget = useKinesis((s) => s.budget);
  const actions = useKinesis.getState();

  // O cartão responde "o que fazer agora?": acompanha o relógio com a tela parada.
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const [liveVolume, setLiveVolume] = useState<number | null>(null);
  const [savingPreset, setSavingPreset] = useState(false);

  const left = snoozesLeft(budget);
  const pick = (patch: Partial<typeof config>, sound?: string) => {
    actions.patchConfig(patch);
    if (sound) actions.preview(sound);
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.topbar}>
        <View style={styles.brand}>
          <Image source={require('../../assets/kinesis/icon-mini.png')} style={styles.brandLogo} />
          <Text style={styles.brandText}>Kinesis</Text>
        </View>
        <VolumeBar
          value={liveVolume ?? volume}
          onChange={setLiveVolume}
          onCommit={(v) => {
            actions.setVolume(v);
            setLiveVolume(null);
          }}
        />
      </View>

      <TodayCard now={now} />

      <SectionTitle>CONFIGURAÇÃO</SectionTitle>
      <SettingRow field="sets" label="SÉRIES" value={String(config.sets)} />
      {config.prepare > 0 && <SettingRow field="prepare" label="PREPARAR" value={fmtTime(config.prepare)} />}
      <SettingRow field="work" label="TRABALHAR" value={fmtTime(config.work)} />
      <SettingRow field="rest" label="EXERCÍCIO" value={fmtTime(config.rest)} />

      <View style={styles.configActions}>
        {config.prepare <= 0 && (
          <SmallButton label="+ PREPARAÇÃO" onPress={() => actions.setField('prepare', 10)} />
        )}
        <SmallButton label="SALVAR" onPress={() => setSavingPreset(true)} />
      </View>

      <Pressable
        onPress={actions.start}
        accessibilityRole="button"
        style={({ pressed }) => [styles.start, pressed && { opacity: 0.85 }]}
      >
        <BoltIcon color={K.ink} size={24} />
        <Text style={styles.startText}>INICIAR</Text>
      </Pressable>

      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>Mostrar só minutos + barra de segundos</Text>
        <Switch
          value={minutesOnly}
          onValueChange={actions.setMinutesOnly}
          trackColor={{ false: K.panelHi, true: K.terracotta }}
          thumbColor={K.text}
        />
      </View>

      <SectionTitle>SONS</SectionTitle>
      <Panel style={{ paddingVertical: 2 }}>
        <SelectRow
          label="Ao trabalhar"
          value={config.workSound}
          options={BELLS}
          onChange={(v) => pick({ workSound: v }, v)}
        />
        <SelectRow
          label="Ao exercitar"
          value={config.restSound}
          options={BELLS}
          onChange={(v) => pick({ restSound: v }, v)}
        />
        <SelectRow
          label="Alerta (não exercitou)"
          value={config.alertSound}
          options={ALERTS}
          onChange={(v) => pick({ alertSound: v }, v)}
        />
        <SelectRow
          label="Repetir alerta a cada"
          value={String(config.alertEvery || 2)}
          options={ALERT_EVERY}
          onChange={(v) => pick({ alertEvery: Number(v) || 2 })}
        />
        <SelectRow
          label="Adiar (soneca) por"
          value={String(config.snoozeMinutes || 5)}
          options={SNOOZE_MINUTES}
          onChange={(v) => pick({ snoozeMinutes: Number(v) || 5 })}
        />
        <Text style={[textStyles.hint, styles.hint]}>
          {left
            ? `${left} de ${SNOOZE_MAX} sonecas disponíveis.`
            : `Sonecas esgotadas — faltam ${roundsToUnlock(budget)} rodada(s) sem adiar para liberar.`}
        </Text>
        <SelectRow
          label="Avisar ao restar do trabalho"
          value={String(config.preExercisePercent ?? 10)}
          options={PRE_PERCENT}
          onChange={(v) => pick({ preExercisePercent: Number(v) || 0 })}
        />
        <SelectRow
          label="↳ quantos avisos"
          value={String(preExerciseCount(config))}
          options={PRE_COUNT}
          onChange={(v) => pick({ preExerciseCount: Number(v) || 1 })}
        />
        <Text style={[textStyles.hint, styles.hint]}>{preExerciseHint(config)}</Text>
        <SelectRow
          label="↳ som do aviso"
          value={config.preExerciseSound || 'gentle'}
          options={PRE_SOUNDS}
          onChange={(v) => pick({ preExerciseSound: v }, v)}
        />
      </Panel>

      <CircuitsSection now={now} />

      <SectionTitle>HISTÓRICO</SectionTitle>
      <Stats />

      <SectionTitle>SEUS PRESETS</SectionTitle>
      <Presets />

      <SectionTitle>DADOS</SectionTitle>
      <DataSection />

      <PresetDialog visible={savingPreset} onClose={() => setSavingPreset(false)} />
    </ScrollView>
  );
}

const ROW_LABELS: Record<NumericField, string> = {
  sets: 'séries',
  prepare: 'preparação',
  work: 'trabalho',
  rest: 'exercício',
};

function SettingRow({ field, label, value }: { field: NumericField; label: string; value: string }) {
  const actions = useKinesis.getState();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = () => {
    setEditing(false);
    const parsed = parseField(field, draft);
    if (Number.isFinite(parsed)) actions.setField(field, parsed);
  };

  return (
    <View style={styles.settingRow}>
      <Pressable
        onPress={() => actions.bumpField(field, -1)}
        accessibilityRole="button"
        accessibilityLabel={`Diminuir ${ROW_LABELS[field]}`}
        style={styles.step}
      >
        <Text style={styles.stepText}>−</Text>
      </Pressable>
      <Pressable
        onPress={() => {
          setDraft(value);
          setEditing(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={`Editar ${ROW_LABELS[field]}`}
        style={styles.settingValue}
      >
        <Text style={styles.settingLabel}>{label}</Text>
        {editing ? (
          <TextInput
            autoFocus
            selectTextOnFocus
            value={draft}
            onChangeText={(t) =>
              setDraft(t.replace(field === 'sets' ? /[^\d]/g : /[^\d:]/g, '').slice(0, field === 'sets' ? 2 : 5))
            }
            onBlur={commit}
            onSubmitEditing={commit}
            keyboardType="numbers-and-punctuation"
            style={[styles.settingNumber, styles.settingInput]}
          />
        ) : (
          <Text style={styles.settingNumber}>{value}</Text>
        )}
      </Pressable>
      <Pressable
        onPress={() => actions.bumpField(field, 1)}
        accessibilityRole="button"
        accessibilityLabel={`Aumentar ${ROW_LABELS[field]}`}
        style={styles.step}
      >
        <Text style={styles.stepText}>+</Text>
      </Pressable>
    </View>
  );
}

/** O cartão do topo: o que fazer agora, ou o que vem a seguir. */
function TodayCard({ now }: { now: Date }) {
  const circuits = useKinesis((s) => s.circuits);
  const exercises = useKinesis((s) => s.exercises);
  if (!circuits.length) {
    return (
      <View style={styles.today}>
        <Text style={textStyles.muted}>Sem circuitos programados — monte um em CIRCUITOS DA SEMANA.</Text>
      </View>
    );
  }
  const active = activeCircuits(circuits, now)[0] ?? null;
  const slot = active ? null : nextCircuitSlot(circuits, now);
  const circuit = active ?? slot?.circuit ?? null;
  if (!circuit) {
    return (
      <View style={styles.today}>
        <Text style={textStyles.muted}>Nenhum circuito programado para os próximos dias.</Text>
      </View>
    );
  }
  const group = circuit.region ? ` · ${REGION_SHORT[circuit.region]}` : '';
  const periodLabel = PERIODS.find((p) => p.id === periodAt(now))?.label ?? '';
  const head = active
    ? `AGORA · ${WD_SHORT[now.getDay()]}, ${periodLabel}${group}`
    : `PRÓXIMO · ${slot ? WD_SHORT[slot.day] : ''}, ${slot?.period.label ?? ''}${group}`;
  const names = circuit.items.map((id) => exercises.find((ex) => ex.id === id)?.name).filter(Boolean);
  return (
    <View style={[styles.today, active && styles.todayNow]}>
      <Text style={styles.todayHead}>{head}</Text>
      <Text style={styles.todayName}>{circuit.name}</Text>
      <Text style={textStyles.muted}>{names.length ? names.join(' · ') : 'circuito sem exercícios'}</Text>
    </View>
  );
}

function Stats() {
  const history = useKinesis((s) => s.history);
  const data = useMemo(() => {
    const byDay: Record<string, number> = {};
    const regionCount: Record<string, number> = {};
    for (const s of history) {
      byDay[s.date] = (byDay[s.date] || 0) + 1;
      for (const it of s.items || []) regionCount[it.region] = (regionCount[it.region] || 0) + 1;
    }
    const days: string[] = [];
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(dayKey(d.getTime()));
    }
    return { byDay, regionCount, days, max: Math.max(1, ...days.map((k) => byDay[k] || 0)) };
  }, [history]);

  if (!history.length) {
    return <Text style={textStyles.muted}>Ainda sem registros. Marque exercícios na tela Exercite-se!</Text>;
  }
  return (
    <Panel>
      <View style={styles.statToday}>
        <Text style={styles.statBig}>{data.byDay[dayKey()] || 0}</Text>
        <Text style={textStyles.muted}>exercício(s) hoje</Text>
      </View>
      <Text style={styles.statTitle}>Últimos 7 dias</Text>
      <View style={styles.statDays}>
        {data.days.map((k) => {
          const n = data.byDay[k] || 0;
          return (
            <View key={k} style={styles.statDay}>
              <Text style={styles.statNum}>{n ? n : ''}</Text>
              <View
                style={[
                  styles.statBar,
                  { height: Math.round((n / data.max) * 44) + (n ? 6 : 3) },
                  !n && { backgroundColor: K.panelHi },
                ]}
              />
              <Text style={styles.statCap}>{WD_LETTER[new Date(`${k}T00:00:00`).getDay()]}</Text>
            </View>
          );
        })}
      </View>
      <Text style={styles.statTitle}>Por região (total)</Text>
      <View style={styles.statRegions}>
        {REGIONS.map((r) => (
          <View key={r} style={[styles.statRegion, { borderColor: K.region[r] }]}>
            <Text style={[styles.statRegionNum, { color: K.region[r] }]}>{data.regionCount[r] || 0}</Text>
            <Text style={styles.statRegionLabel}>{REGION_LABEL[r]}</Text>
          </View>
        ))}
      </View>
    </Panel>
  );
}

function Presets() {
  const presets = useKinesis((s) => s.presets);
  const actions = useKinesis.getState();
  if (!presets.length) return <Text style={textStyles.muted}>Nenhum preset salvo.</Text>;
  return (
    <View style={{ gap: 8 }}>
      {presets.map((preset: Preset) => (
        <View key={preset.id} style={styles.preset}>
          <View style={{ flex: 1 }}>
            <Text style={styles.presetName}>{preset.name}</Text>
            <Text style={textStyles.hint}>
              {preset.sets} séries • {fmtTime(preset.prepare)} / {fmtTime(preset.work)} / {fmtTime(preset.rest)}
            </Text>
          </View>
          <SmallButton label="CARREGAR" onPress={() => actions.loadPreset(preset)} />
          <Pressable
            onPress={() => actions.deletePreset(preset.id)}
            accessibilityRole="button"
            accessibilityLabel="Excluir preset"
            hitSlop={8}
            style={{ padding: 8 }}
          >
            <Text style={{ color: K.danger, fontSize: 20 }}>×</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

function PresetDialog({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const config = useKinesis((s) => s.config);
  const actions = useKinesis.getState();
  const [name, setName] = useState('');
  useEffect(() => {
    if (visible) setName(`${config.sets} séries ${fmtTime(config.work)}/${fmtTime(config.rest)}`);
  }, [visible]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.dialogBackdrop}>
        <View style={styles.dialog}>
          <Text style={styles.dialogTitle}>Salvar preset</Text>
          <TextInput
            autoFocus
            selectTextOnFocus
            value={name}
            onChangeText={setName}
            maxLength={40}
            placeholder="HIIT 6x40/20"
            placeholderTextColor={K.muted}
            style={styles.dialogInput}
          />
          <View style={styles.dialogActions}>
            <SmallButton label="Cancelar" onPress={onClose} />
            <SmallButton
              label="Salvar"
              primary
              onPress={() => {
                const trimmed = name.trim();
                if (!trimmed) return;
                actions.savePreset(trimmed);
                onClose();
              }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function DataSection() {
  const actions = useKinesis.getState();

  const importFile = async () => {
    const res = await DocumentPicker.getDocumentAsync({
      type: ['application/json', 'text/plain', '*/*'],
      copyToCacheDirectory: true,
    });
    const asset = res.canceled ? null : res.assets?.[0];
    if (!asset) return;
    let data: ImportedData;
    try {
      data = JSON.parse(await FileSystem.readAsStringAsync(asset.uri)) as ImportedData;
      if (!data || typeof data !== 'object' || !Array.isArray(data.exercises)) throw new Error('formato');
    } catch {
      Alert.alert('Arquivo inválido', 'Este arquivo não veio do Kinesis.');
      return;
    }
    const n = data.exercises.length;
    const c = Array.isArray(data.circuits) ? data.circuits.length : 0;
    const h = Array.isArray(data.history) ? data.history.length : 0;
    Alert.alert(
      'Importar dados do Kinesis',
      `${n} exercícios, ${c} circuitos e ${h} registros de histórico vão SUBSTITUIR os que estão aqui.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Importar', onPress: () => actions.importData(data) },
      ],
    );
  };

  const exportFile = async () => {
    const uri = `${FileSystem.cacheDirectory}kinesis-dados.json`;
    await FileSystem.writeAsStringAsync(uri, JSON.stringify(actions.exportData()));
    await Sharing.shareAsync(uri, { mimeType: 'application/json', dialogTitle: 'Dados do Kinesis' });
  };

  return (
    <View>
      <Text style={[textStyles.hint, { marginBottom: 8 }]}>
        Exercícios, circuitos e histórico do Kinesis do Mac entram por um arquivo. Os dois não sincronizam
        sozinhos.
      </Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <SmallButton label="IMPORTAR" onPress={() => void importFile().catch(() => {})} />
        <SmallButton label="EXPORTAR" onPress={() => void exportFile().catch(() => {})} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: K.bg },
  content: { paddingHorizontal: 16, paddingTop: 12 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandLogo: { width: 30, height: 30, borderRadius: 6 },
  brandText: { color: K.terracotta, fontFamily: F.bold, fontSize: 24 },
  today: {
    backgroundColor: K.panel,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: K.line,
    padding: 12,
  },
  todayNow: { borderColor: K.terracotta, borderWidth: 1.5 },
  todayHead: { color: K.terracotta, fontFamily: F.bold, fontSize: 13, letterSpacing: 0.6 },
  todayName: { color: K.text, fontFamily: F.bold, fontSize: 20, marginVertical: 2 },
  settingRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8, marginBottom: 8 },
  step: {
    width: 62,
    backgroundColor: K.panel,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: K.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { color: K.terracotta, fontSize: 30, fontFamily: F.bold },
  settingValue: {
    flex: 1,
    backgroundColor: K.panel,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: K.line,
    alignItems: 'center',
    paddingVertical: 8,
  },
  settingLabel: { color: K.muted, fontFamily: F.bold, fontSize: 13, letterSpacing: 1 },
  settingNumber: { color: K.text, fontFamily: F.bold, fontSize: 34, includeFontPadding: false },
  settingInput: { padding: 0, minWidth: 120, textAlign: 'center' },
  configActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end', marginBottom: 12 },
  start: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: K.terracotta,
    borderRadius: 10,
    paddingVertical: 16,
  },
  startText: { color: K.ink, fontFamily: F.bold, fontSize: 24, letterSpacing: 1.5 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 12,
  },
  toggleLabel: { color: K.text, fontSize: 15, flex: 1, fontFamily: F.regular },
  hint: { paddingVertical: 6 },
  statToday: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  statBig: { color: K.terracotta, fontFamily: F.bold, fontSize: 40 },
  statTitle: { color: K.muted, fontFamily: F.bold, fontSize: 13, marginTop: 12, marginBottom: 6 },
  statDays: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  statDay: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  statNum: { color: K.text, fontSize: 12, fontFamily: F.bold },
  statBar: { width: '70%', backgroundColor: K.terracotta, borderRadius: 3 },
  statCap: { color: K.muted, fontSize: 12, marginTop: 3, fontFamily: F.regular },
  statRegions: { flexDirection: 'row', gap: 6 },
  statRegion: { flex: 1, borderWidth: 1, borderRadius: 6, alignItems: 'center', paddingVertical: 6 },
  statRegionNum: { fontFamily: F.bold, fontSize: 20 },
  statRegionLabel: { color: K.muted, fontSize: 12, fontFamily: F.regular },
  preset: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: K.panel,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: K.line,
    padding: 10,
  },
  presetName: { color: K.text, fontFamily: F.bold, fontSize: 16 },
  dialogBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: K.panel, borderRadius: 12, borderWidth: 1, borderColor: K.line, padding: 16 },
  dialogTitle: { color: K.terracotta, fontFamily: F.bold, fontSize: 18, marginBottom: 10 },
  dialogInput: {
    color: K.text,
    backgroundColor: K.bg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: K.line,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 14 },
});
