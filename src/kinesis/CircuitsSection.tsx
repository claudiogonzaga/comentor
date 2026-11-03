// CIRCUITOS DA SEMANA: um circuito é o que fazer + quando. A semana aparece como
// grade (7 dias × 3 períodos), e os exercícios se escolhem dentro do formulário.

import { useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  PERIODS,
  periodAt,
  REGION_SHORT,
  REGIONS,
  sortedExercises,
  useKinesis,
  WD_LETTER,
  type Circuit,
  type PeriodId,
  type Region,
} from './store';
import { Check, F, K, SectionTitle, SmallButton, textStyles, Toggle } from './ui';

const DAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

function daysLabel(circuit: Circuit): string {
  const days = (circuit.days || []).slice().sort((a, b) => a - b);
  if (days.length === 7) return 'todo dia';
  if (days.length === 5 && days.join() === '1,2,3,4,5') return 'seg–sex';
  return days.map((d) => WD_LETTER[d]).join('');
}

function periodsLabel(circuit: Circuit): string {
  return (circuit.periods || [])
    .map((id) => PERIODS.find((p) => p.id === id)?.label)
    .filter(Boolean)
    .join(', ');
}

export function CircuitsSection({ now }: { now: Date }) {
  const circuits = useKinesis((s) => s.circuits);
  const exercises = useKinesis((s) => s.exercises);
  const actions = useKinesis.getState();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<{ circuit: Circuit | null } | null>(null);

  const selected = circuits.find((c) => c.id === selectedId) ?? null;
  const nowDay = now.getDay();
  const nowPeriod = periodAt(now);
  const memberNames = (c: Circuit) =>
    c.items.map((id) => exercises.find((ex) => ex.id === id)?.name).filter(Boolean) as string[];

  return (
    <View>
      <SectionTitle>CIRCUITOS DA SEMANA</SectionTitle>

      <View style={styles.agendaHead}>
        <View style={styles.agendaLabel} />
        {WD_LETTER.map((letter, day) => (
          <Text
            key={day}
            accessibilityLabel={DAY_NAMES[day]}
            style={[styles.agendaDay, day === nowDay && { color: K.terracotta }]}
          >
            {letter}
          </Text>
        ))}
      </View>
      {PERIODS.map((period) => (
        <View key={period.id} style={styles.agendaRow}>
          <Text style={[styles.agendaLabel, styles.agendaPeriod, period.id === nowPeriod && { color: K.terracotta }]}>
            {period.short}
          </Text>
          {WD_LETTER.map((_, day) => (
            <View
              key={day}
              style={[styles.agendaCell, day === nowDay && period.id === nowPeriod && styles.agendaCellNow]}
            >
              {circuits
                .filter((c) => c.days.includes(day) && (c.periods || []).includes(period.id))
                .map((c) => (
                  <Pressable
                    key={c.id}
                    onPress={() => setSelectedId(selectedId === c.id ? null : c.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`${c.name}, ${DAY_NAMES[day]}, ${period.label}`}
                    style={[
                      styles.block,
                      { backgroundColor: (c.region && K.region[c.region]) || K.panelHi },
                      c.id === selectedId && styles.blockSelected,
                    ]}
                  >
                    <Text style={styles.blockText} numberOfLines={2}>
                      {c.name}
                    </Text>
                  </Pressable>
                ))}
            </View>
          ))}
        </View>
      ))}
      {circuits.length === 0 && (
        <Text style={[textStyles.muted, { marginTop: 8 }]}>Nenhum circuito programado.</Text>
      )}

      {selected && (
        <View style={styles.detail}>
          <Text style={styles.detailName}>
            {selected.name}
            {selected.region ? `  ·  ${REGION_SHORT[selected.region]}` : ''}
          </Text>
          <Text style={textStyles.muted}>
            {daysLabel(selected)} · {periodsLabel(selected)}
          </Text>
          <Text style={[textStyles.muted, { marginTop: 4 }]}>{memberNames(selected).join(' · ')}</Text>
          <View style={styles.rowGap}>
            <SmallButton label="EDITAR" onPress={() => setForm({ circuit: selected })} />
            <SmallButton
              label="REMOVER"
              danger
              onPress={() => {
                actions.deleteCircuit(selected.id);
                setSelectedId(null);
              }}
            />
          </View>
        </View>
      )}

      {form ? (
        <CircuitForm
          key={form.circuit?.id ?? 'novo'}
          circuit={form.circuit}
          onClose={() => setForm(null)}
        />
      ) : (
        <SmallButton
          label="+ NOVO CIRCUITO"
          onPress={() => setForm({ circuit: null })}
          style={{ marginTop: 10, alignSelf: 'flex-start' }}
        />
      )}
    </View>
  );
}

function CircuitForm({ circuit, onClose }: { circuit: Circuit | null; onClose: () => void }) {
  const exercises = useKinesis((s) => s.exercises);
  const actions = useKinesis.getState();
  const [name, setName] = useState(circuit?.name ?? '');
  const [days, setDays] = useState<number[]>(circuit?.days ?? []);
  const [periods, setPeriods] = useState<PeriodId[]>(circuit?.periods ?? []);
  const [region, setRegion] = useState<Region | null>(circuit?.region ?? null);
  const [picks, setPicks] = useState<Set<string>>(() => new Set(circuit?.items ?? []));
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string; region: Region } | null>(null);
  const [error, setError] = useState('');
  const newInput = useRef<TextInput>(null);

  const entries = region ? sortedExercises(exercises.filter((ex) => ex.region === region)) : [];

  const add = () => {
    const trimmed = newName.trim();
    if (!region) {
      setError('Escolha o grupo antes de criar um exercício.');
      return;
    }
    if (!trimmed) {
      newInput.current?.focus();
      return;
    }
    const id = actions.addExercise(trimmed, region);
    setPicks((p) => new Set(p).add(id));
    setNewName('');
    setError('');
  };

  const saveCircuit = () => {
    const items = sortedExercises(exercises.filter((ex) => picks.has(ex.id))).map((ex) => ex.id);
    if (!days.length) return setError('Escolha pelo menos um dia da semana.');
    if (!periods.length) return setError('Escolha pelo menos um período (manhã, tarde ou noite).');
    if (!region) return setError('Escolha o grupo do circuito (upper, lower, core ou full).');
    if (!items.length) return setError('Marque os exercícios que compõem o circuito.');
    const typed = name.trim();
    const fallback = items
      .map((id) => exercises.find((ex) => ex.id === id)?.name)
      .filter(Boolean)
      .join(' + ');
    actions.saveCircuit(circuit?.id ?? null, {
      name: typed || fallback,
      days: days.slice().sort((a, b) => a - b),
      periods: PERIODS.filter((p) => periods.includes(p.id)).map((p) => p.id),
      region,
      items,
    });
    onClose();
  };

  return (
    <View style={styles.form}>
      <TextInput
        value={name}
        onChangeText={setName}
        maxLength={28}
        placeholder="Nome do circuito"
        placeholderTextColor={K.muted}
        style={styles.input}
      />
      <Text style={styles.fieldLabel}>DIAS</Text>
      <View style={styles.toggles}>
        {WD_LETTER.map((letter, day) => (
          <Toggle
            key={day}
            label={letter}
            accessibilityLabel={DAY_NAMES[day]}
            on={days.includes(day)}
            onPress={() =>
              setDays((d) => (d.includes(day) ? d.filter((x) => x !== day) : [...d, day]))
            }
          />
        ))}
      </View>
      <Text style={styles.fieldLabel}>PERÍODO</Text>
      <View style={styles.toggles}>
        {PERIODS.map((p) => (
          <Toggle
            key={p.id}
            label={p.short}
            accessibilityLabel={`${p.label} (${p.hours})`}
            on={periods.includes(p.id)}
            onPress={() =>
              setPeriods((cur) => (cur.includes(p.id) ? cur.filter((x) => x !== p.id) : [...cur, p.id]))
            }
          />
        ))}
      </View>
      <Text style={styles.fieldLabel}>GRUPO</Text>
      <View style={styles.toggles}>
        {REGIONS.map((r) => (
          <Toggle
            key={r}
            label={REGION_SHORT[r]}
            color={K.region[r]}
            on={region === r}
            onPress={() => {
              // Grupo novo, seleção nova: a lista abaixo é só a dele.
              setRegion(region === r ? null : r);
              setPicks(new Set());
            }}
          />
        ))}
      </View>
      <Text style={styles.fieldLabel}>EXERCÍCIOS</Text>
      {entries.length === 0 && (
        <Text style={textStyles.muted}>
          {region
            ? `Nenhum exercício cadastrado em ${REGION_SHORT[region]}.`
            : 'Escolha o grupo acima para listar os exercícios.'}
        </Text>
      )}
      {entries.map((ex) => {
        const on = picks.has(ex.id);
        return (
          <View key={ex.id} style={styles.pick}>
            <Pressable
              onPress={() =>
                setPicks((p) => {
                  const next = new Set(p);
                  if (on) next.delete(ex.id);
                  else next.add(ex.id);
                  return next;
                })
              }
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              style={styles.pickMain}
            >
              <Check on={on} />
              <Text style={styles.pickName} numberOfLines={1}>
                {ex.name}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setEditing({ id: ex.id, name: ex.name, region: ex.region })}
              accessibilityRole="button"
              accessibilityLabel={`Editar ${ex.name}`}
              hitSlop={8}
              style={styles.pickIcon}
            >
              <Text style={styles.pickIconText}>✎</Text>
            </Pressable>
            <Pressable
              onPress={() =>
                Alert.alert('Excluir exercício', `Excluir “${ex.name}” do cadastro e dos circuitos?`, [
                  { text: 'Cancelar', style: 'cancel' },
                  {
                    text: 'Excluir',
                    style: 'destructive',
                    onPress: () => {
                      actions.deleteExercise(ex.id);
                      setPicks((p) => {
                        const next = new Set(p);
                        next.delete(ex.id);
                        return next;
                      });
                      if (editing?.id === ex.id) setEditing(null);
                    },
                  },
                ])
              }
              accessibilityRole="button"
              accessibilityLabel={`Excluir ${ex.name}`}
              hitSlop={8}
              style={styles.pickIcon}
            >
              <Text style={[styles.pickIconText, { color: K.danger }]}>×</Text>
            </Pressable>
          </View>
        );
      })}
      <View style={styles.addRow}>
        <TextInput
          ref={newInput}
          value={newName}
          onChangeText={setNewName}
          onSubmitEditing={add}
          maxLength={28}
          placeholder="Criar exercício neste grupo"
          placeholderTextColor={K.muted}
          style={[styles.input, { flex: 1, marginBottom: 0 }]}
        />
        <SmallButton label="+ ADICIONAR" onPress={add} />
      </View>

      {editing && (
        <View style={styles.editor}>
          <Text style={styles.fieldLabel}>EDITANDO EXERCÍCIO</Text>
          <TextInput
            value={editing.name}
            onChangeText={(text) => setEditing({ ...editing, name: text })}
            maxLength={28}
            accessibilityLabel="Nome do exercício"
            placeholderTextColor={K.muted}
            style={styles.input}
          />
          <View style={styles.toggles}>
            {REGIONS.map((r) => (
              <Toggle
                key={r}
                label={REGION_SHORT[r]}
                color={K.region[r]}
                on={editing.region === r}
                onPress={() => setEditing({ ...editing, region: r })}
              />
            ))}
          </View>
          <View style={styles.rowGap}>
            <SmallButton label="CANCELAR" onPress={() => setEditing(null)} />
            <SmallButton
              label="SALVAR EXERCÍCIO"
              primary
              onPress={() => {
                const trimmed = editing.name.trim();
                if (!trimmed) return;
                actions.updateExercise(editing.id, trimmed, editing.region);
                if (editing.region !== region) {
                  setPicks((p) => {
                    const next = new Set(p);
                    next.delete(editing.id);
                    return next;
                  });
                }
                setEditing(null);
              }}
            />
          </View>
        </View>
      )}

      {!!error && <Text style={styles.error}>{error}</Text>}
      <View style={styles.rowGap}>
        <SmallButton label="CANCELAR" onPress={onClose} />
        <SmallButton
          label={circuit ? 'SALVAR ALTERAÇÕES' : 'SALVAR CIRCUITO'}
          primary
          onPress={saveCircuit}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  agendaHead: { flexDirection: 'row', marginBottom: 4 },
  agendaLabel: { width: 46 },
  agendaPeriod: { color: K.muted, fontFamily: F.bold, fontSize: 11, alignSelf: 'center' },
  agendaDay: { flex: 1, textAlign: 'center', color: K.muted, fontFamily: F.bold, fontSize: 14 },
  agendaRow: { flexDirection: 'row', marginBottom: 3 },
  agendaCell: {
    flex: 1,
    minHeight: 54,
    marginHorizontal: 1,
    padding: 1.5,
    gap: 2,
    backgroundColor: K.panel,
    borderRadius: 4,
  },
  agendaCellNow: { borderWidth: 1, borderColor: K.terracotta },
  block: { borderRadius: 3, paddingHorizontal: 2, paddingVertical: 3, minHeight: 24, justifyContent: 'center' },
  blockSelected: { borderWidth: 1.5, borderColor: K.text },
  blockText: { color: K.ink, fontFamily: F.bold, fontSize: 9, lineHeight: 10, textAlign: 'center' },
  detail: {
    marginTop: 10,
    padding: 12,
    backgroundColor: K.panel,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: K.line,
  },
  detailName: { color: K.text, fontFamily: F.bold, fontSize: 17, marginBottom: 2 },
  rowGap: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  form: {
    marginTop: 12,
    padding: 12,
    backgroundColor: '#1c1811',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: K.line,
  },
  input: {
    color: K.text,
    backgroundColor: K.panel,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: K.line,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 15,
    marginBottom: 8,
  },
  fieldLabel: { color: K.muted, fontFamily: F.bold, fontSize: 13, letterSpacing: 0.8, marginTop: 10, marginBottom: 6 },
  toggles: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pickMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  pickName: { flex: 1, color: K.text, fontSize: 16, fontFamily: F.regular },
  pickIcon: { paddingHorizontal: 10, paddingVertical: 6 },
  pickIconText: { color: K.muted, fontSize: 18 },
  addRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 10 },
  editor: { marginTop: 12, paddingTop: 2, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: K.line },
  error: { color: K.danger, fontSize: 14, marginTop: 10, fontFamily: F.regular },
});
