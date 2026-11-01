import { StyleSheet, Text, View } from 'react-native';

import { colors, pillarColor, radius } from '../theme';

interface Props {
  label: string;
  pillarIndex: number; // índice na lista de pilares; -1 = "nenhum"
}

// Pill do pilar na sub-linha do vídeo (port do .pill da UI do desktop:
// fundo translúcido na cor do pilar + texto na cor).
export function PillarPill({ label, pillarIndex }: Props) {
  if (pillarIndex < 0) {
    return (
      <View style={[styles.pill, styles.none]}>
        <Text style={[styles.label, { color: colors.text.tertiary }]}>—</Text>
      </View>
    );
  }
  const color = pillarColor(pillarIndex);
  return (
    <View style={[styles.pill, { backgroundColor: `${color}26` }]}>
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingVertical: 1.5,
    paddingHorizontal: 8,
    borderRadius: radius.pill,
  },
  none: {
    backgroundColor: 'transparent',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  label: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    lineHeight: 15,
  },
});
