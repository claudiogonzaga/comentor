import { useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  StyleSheet,
  View,
  type DimensionValue,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { colors } from '../theme';

interface Props {
  /** Posição atual 0..1 (tempo atual / duração). */
  progress: number;
  /** Chamado ao soltar a bolinha (ou tocar na barra): fração 0..1 destino. */
  onSeek: (fraction: number) => void;
  /** Avisado quando o usuário começa a arrastar (para pausar o "follow" do tempo). */
  onScrubStart?: () => void;
  disabled?: boolean;
}

/**
 * Barra de progresso ARRASTÁVEL para o "Leia para mim". Mapeia o TEMPO do áudio
 * (não o texto) — arrastar a bolinha = seekTo exato. PanResponder puro (sem
 * dependência nativa). Tocar em qualquer ponto da barra também pula pra lá.
 */
export function AudioScrubber({ progress, onSeek, onScrubStart, disabled }: Props) {
  const widthRef = useRef(0);
  const [dragFrac, setDragFrac] = useState<number | null>(null);

  // Refs com os callbacks/flag MAIS RECENTES. O PanResponder é criado uma vez,
  // mas precisa enxergar o onSeek atual (que captura a duração atual) — senão
  // ele usaria o closure do 1º render (duração 0 → seekTo(0) sempre). Idem disabled.
  const onSeekRef = useRef(onSeek);
  const onScrubStartRef = useRef(onScrubStart);
  const disabledRef = useRef(disabled);
  onSeekRef.current = onSeek;
  onScrubStartRef.current = onScrubStart;
  disabledRef.current = disabled;

  // Fração 0..1 a partir do X do toque. null se a largura ainda não foi medida
  // (antes do 1º onLayout) — aí ignoramos o gesto em vez de pular pro fim.
  const fracFromX = (x: number): number | null => {
    const w = widthRef.current;
    if (w <= 0) return null;
    return Math.max(0, Math.min(1, x / w));
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabledRef.current,
        onMoveShouldSetPanResponder: () => !disabledRef.current,
        onPanResponderGrant: (e: GestureResponderEvent) => {
          const f = fracFromX(e.nativeEvent.locationX);
          if (f == null) return;
          onScrubStartRef.current?.();
          setDragFrac(f);
        },
        onPanResponderMove: (e: GestureResponderEvent) => {
          const f = fracFromX(e.nativeEvent.locationX);
          if (f != null) setDragFrac(f);
        },
        onPanResponderRelease: (e: GestureResponderEvent) => {
          const f = fracFromX(e.nativeEvent.locationX);
          setDragFrac(null);
          if (f != null) onSeekRef.current(f);
        },
        onPanResponderTerminate: () => setDragFrac(null),
      }),
    [],
  );

  const onLayout = (e: LayoutChangeEvent) => {
    widthRef.current = e.nativeEvent.layout.width;
  };

  const shown = dragFrac ?? (Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0);
  const pct = `${(shown * 100).toFixed(2)}%` as DimensionValue;

  return (
    // padding vertical generoso = alvo de toque fácil; a barra fina fica centralizada
    <View style={styles.hit} onLayout={onLayout} {...pan.panHandlers}>
      <View style={styles.track}>
        <View style={[styles.fill, { width: pct }]} />
      </View>
      <View style={[styles.thumb, { left: pct }, dragFrac != null && styles.thumbActive]} />
    </View>
  );
}

const TRACK_H = 4;
const THUMB = 18;

const styles = StyleSheet.create({
  hit: {
    height: 36,
    justifyContent: 'center',
    marginVertical: 4,
  },
  track: {
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    backgroundColor: colors.bg.surfaceStrong,
    overflow: 'hidden',
  },
  fill: {
    height: TRACK_H,
    borderRadius: TRACK_H / 2,
    backgroundColor: colors.accent.gold,
  },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: colors.accent.gold,
    top: (36 - THUMB) / 2,
    marginLeft: -THUMB / 2,
    borderWidth: 2,
    borderColor: colors.bg.primary,
  },
  thumbActive: {
    transform: [{ scale: 1.25 }],
  },
});
