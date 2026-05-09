import { StyleSheet, Text, View } from 'react-native';
import { ActivityIndicator } from 'react-native';
import { Owl } from '../components/Owl';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors, spacing, typography } from '../theme';

export function SplashScreen() {
  return (
    <ScreenContainer>
      <View style={styles.wrap}>
        <Owl mood="calm" size={180} />
        <Text style={[typography.hero, styles.name]}>CoMentor</Text>
        <Text style={[typography.body, styles.sub]}>sua corujinha de sabedoria</Text>
        <ActivityIndicator color={colors.accent.gold} style={{ marginTop: spacing.xl }} />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  name: {
    color: colors.text.primary,
    marginTop: spacing.lg,
  },
  sub: {
    color: colors.text.secondary,
    marginTop: spacing.xs,
  },
});
