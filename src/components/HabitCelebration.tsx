// Comemoração de um MARCO (7, 21, 30, 66, 100, 200, 365 dias feitos) ou de um
// hábito formado. Recompensa LEVE de propósito: a coruja feliz, uma frase, uma
// vibração — sem pontos, sem níveis. O que se celebra é a repetição, que é o
// que forma o hábito, não um placar.

import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Owl } from './Owl';
import { Button } from './Button';
import { colors, radius, spacing, typography } from '../theme';

/** A frase de cada marco: o que aquele número significa, sem exagero. */
export function milestoneText(n: number, title: string): { title: string; text: string } {
  const t = `"${title}"`;
  switch (n) {
    case 7:
      return { title: '7 dias', text: `Uma semana de ${t}. O começo é a parte mais difícil — e ela já passou.` };
    case 21:
      return { title: '21 dias', text: `${t} já tem três semanas de repetições. A deixa e a ação estão se colando.` };
    case 30:
      return { title: '30 dias', text: `Um mês de ${t}. Cada repetição deixa o próximo dia um pouco mais leve.` };
    case 66:
      return {
        title: '66 dias',
        text: `66 dias: a mediana que a pesquisa encontrou para um hábito ficar automático. ${t} está chegando lá.`,
      };
    case 100:
      return { title: '100 dias', text: `Cem dias de ${t}. Isso já é parte de quem você é.` };
    case 200:
      return { title: '200 dias', text: `Duzentos dias de ${t}. Constância de verdade.` };
    case 365:
      return { title: '365 dias', text: `Um ano inteiro de ${t}. A coruja está orgulhosa.` };
    default:
      return { title: `${n} dias`, text: `${n} dias feitos de ${t}.` };
  }
}

export function HabitCelebration({
  visible,
  title,
  text,
  onClose,
}: {
  visible: boolean;
  title: string;
  text: string;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Fechar">
        <Pressable style={styles.card} onPress={() => {}}>
          <View style={styles.owl}>
            <Owl mood="celebrating" size={130} />
          </View>
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          <Text style={styles.text}>{text}</Text>
          <View style={{ height: spacing.lg }} />
          <Button label="Seguir" onPress={onClose} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.bg.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.bg.primary,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    alignItems: 'center',
  },
  owl: { marginBottom: spacing.md },
  title: { ...typography.title, color: colors.text.primary, textAlign: 'center' },
  text: { ...typography.body, color: colors.text.secondary, textAlign: 'center', marginTop: spacing.sm },
});
