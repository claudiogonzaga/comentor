// Preferências do áudio/vídeo no celular (Configurações e tela "No celular"):
// prazo para apagar sozinho e quando pré-baixar ao abrir um vídeo.
import { StyleSheet, View } from 'react-native';

import { PREFETCH_OPTIONS, RETENTION_OPTIONS } from '../services/media';
import { useMediaStore } from '../store/useMediaStore';
import { Chip } from './Chip';

export function RetentionPicker() {
  const retentionHours = useMediaStore((s) => s.retentionHours);
  const setRetention = useMediaStore((s) => s.setRetention);
  return (
    <View style={styles.chips}>
      {RETENTION_OPTIONS.map((o) => (
        <Chip
          key={o.hours}
          label={o.label}
          active={retentionHours === o.hours}
          onPress={() => setRetention(o.hours)}
        />
      ))}
    </View>
  );
}

export function PrefetchPicker() {
  const prefetchMode = useMediaStore((s) => s.prefetchMode);
  const setPrefetch = useMediaStore((s) => s.setPrefetch);
  return (
    <View style={styles.chips}>
      {PREFETCH_OPTIONS.map((o) => (
        <Chip
          key={o.mode}
          label={o.label}
          active={prefetchMode === o.mode}
          onPress={() => setPrefetch(o.mode)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
