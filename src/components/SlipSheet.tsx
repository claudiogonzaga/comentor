// O DESLIZE num hábito de parar. Não é confissão: é coleta de dado. Onde, como
// estava e o que puxou — com o tempo, o mapa de gatilhos (no detalhe do hábito)
// mostra o padrão, e o padrão é o que dá para mudar. A mensagem final é de
// autocompaixão de propósito: culpa depois de um deslize aumenta a chance do
// próximo (o efeito "já que estraguei, tanto faz"); acolhimento diminui.

import { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { Chip, ChipRow, FieldLabel, fieldStyles } from './habitShared';
import { colors, spacing, typography } from '../theme';
import { addSlipContext, dismissSlipContext, logSlip } from '../services/habitos';
import type { HabitDef } from '../types/habits';

export const SLIP_PLACES = ['casa', 'trabalho', 'rua', 'carro', 'restaurante', 'outro'];
export const SLIP_EMOTIONS = ['tédio', 'estresse', 'cansaço', 'fome', 'ansiedade', 'social', 'celebração', 'outro'];

/** Para a frase final: "Quando vier o tédio de novo…". */
const EMOTION_PHRASE: Record<string, string> = {
  tédio: 'o tédio',
  estresse: 'o estresse',
  cansaço: 'o cansaço',
  fome: 'a fome',
  ansiedade: 'a ansiedade',
  social: 'a pressão do grupo',
  celebração: 'a vontade de comemorar',
};

export function SlipSheet({
  visible,
  habit,
  onClose,
  onSaved,
  mode = 'slip',
}: {
  visible: boolean;
  habit: HabitDef | null;
  onClose: () => void;
  onSaved?: () => void;
  /**
   * 'slip': registra o deslize agora (logSlip marca o dia). 'context': o deslize
   * já foi marcado pela notificação da noite ("Escorreguei"); aqui só se anota o
   * contexto, sem marcar de novo (addSlipContext).
   */
  mode?: 'slip' | 'context';
}) {
  const [place, setPlace] = useState<string | null>(null);
  const [emotion, setEmotion] = useState<string | null>(null);
  const [trigger, setTrigger] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (visible) {
      setPlace(null);
      setEmotion(null);
      setTrigger('');
      setNote('');
      setSaved(false);
    }
  }, [visible]);

  if (!habit) return null;

  const save = async () => {
    setBusy(true);
    try {
      const ctx = { place, emotion, trigger: trigger.trim() || null, note: note.trim() || null };
      if (mode === 'context') await addSlipContext(habit.type, ctx);
      else await logSlip(habit.type, ctx);
      setSaved(true);
      onSaved?.();
    } catch (err) {
      console.warn('logSlip:', err);
      Alert.alert('Não consegui salvar agora', 'Tente de novo em instantes.');
    } finally {
      setBusy(false);
    }
  };

  if (saved) {
    return (
      <BottomSheet visible={visible} onClose={onClose} title="Anotado">
        <Text style={styles.warm}>
          Um deslize é dado, não veredito. O que esse gatilho ensina?
        </Text>
        <Text style={styles.warmSmall}>
          {emotion && EMOTION_PHRASE[emotion]
            ? `Quando vier ${EMOTION_PHRASE[emotion]} de novo, tenha o plano à mão${habit.planB ? `: ${habit.planB}` : ''}.`
            : habit.planB
              ? `Seu plano continua de pé: ${habit.planB}.`
              : 'Amanhã é um dia limpo novo. O que conta é voltar.'}
        </Text>
        <View style={{ height: spacing.lg }} />
        <Button label="Fechar" onPress={onClose} />
      </BottomSheet>
    );
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={mode === 'context' ? 'Como foi o deslize?' : 'Escorreguei'}
      subtitle={
        mode === 'context'
          ? `${habit.title} · você marcou na notificação. Anotar o contexto mostra o padrão.`
          : `${habit.title} · tudo opcional, um toque basta`
      }
    >
      <FieldLabel>Onde?</FieldLabel>
      <ChipRow>
        {SLIP_PLACES.map((p) => (
          <Chip key={p} label={p} selected={place === p} onPress={() => setPlace(place === p ? null : p)} />
        ))}
      </ChipRow>
      <FieldLabel>Como você estava?</FieldLabel>
      <ChipRow>
        {SLIP_EMOTIONS.map((e) => (
          <Chip key={e} label={e} selected={emotion === e} onPress={() => setEmotion(emotion === e ? null : e)} />
        ))}
      </ChipRow>
      <FieldLabel>O que puxou?</FieldLabel>
      <TextInput
        value={trigger}
        onChangeText={setTrigger}
        placeholder="Ex.: vi o pacote em cima da mesa"
        placeholderTextColor={colors.text.tertiary}
        style={fieldStyles.input}
        maxLength={160}
      />
      <FieldLabel>Nota</FieldLabel>
      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder="Qualquer coisa que queira lembrar"
        placeholderTextColor={colors.text.tertiary}
        style={[fieldStyles.input, fieldStyles.multiline]}
        multiline
        maxLength={300}
      />
      <View style={{ height: spacing.lg }} />
      <Button label={mode === 'context' ? 'Anotar' : 'Registrar'} onPress={save} loading={busy} />
      <View style={{ height: spacing.sm }} />
      <Button
        label={mode === 'context' ? 'Agora não' : 'Cancelar'}
        variant="ghost"
        onPress={() => {
          // "Agora não" no contexto: some da Home (o deslize em si já está marcado).
          if (mode === 'context') dismissSlipContext(habit.type).catch(() => {}).finally(() => onSaved?.());
          onClose();
        }}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  warm: { ...typography.subtitle, color: colors.text.primary, marginTop: spacing.lg },
  warmSmall: { ...typography.body, color: colors.text.secondary, marginTop: spacing.md },
});
