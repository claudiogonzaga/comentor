// Peças visuais do Kinesis: a identidade do app do Mac (quase-preto quente, letras
// terracota, GFS Neohellenic) e os controles que lá vinham prontos do HTML.

import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Svg, { ClipPath, Defs, Path, Rect } from 'react-native-svg';

import type { Region } from './store';

export const K = {
  bg: '#16130e',
  panel: '#221d15',
  panelHi: '#2c261b',
  line: 'rgba(223,80,19,0.3)',
  text: '#eceff1',
  muted: '#a79f92',
  terracotta: '#df5013',
  terracottaLight: '#e85a1a',
  terracottaDeep: '#c4430d',
  ink: '#141210',
  danger: '#ef5350',
  indigo: '#3949ab',
  indigoDeep: '#1a237e',
  region: { lower: '#4a9fe0', core: '#c9b23f', upper: '#df5013', full: '#e01e37' } as Record<Region, string>,
};

export const F = {
  regular: 'GFSNeohellenic_400',
  bold: 'GFSNeohellenic_700',
};

export const SOUND_LABELS: Record<string, string> = {
  schoolBell: 'Sino de escola',
  zenBell: 'Sino zen',
  chime: 'Sino simples',
  gong: 'Gongo',
  dingdong: 'Ding-dong',
  whistle: 'Apito',
  alarm: 'Alarme',
  siren: 'Sirene',
  buzzer: 'Buzina',
  gentle: 'Suave',
};

export function SectionTitle({ children }: { children: string }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function SmallButton({
  label,
  onPress,
  primary,
  danger,
  style,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  danger?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.smallButton,
        primary && styles.smallButtonPrimary,
        pressed && { opacity: 0.7 },
        style,
      ]}
    >
      <Text
        style={[
          styles.smallButtonText,
          primary && { color: K.ink },
          danger && { color: K.danger },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Botão de ligar/desligar: dias, períodos, grupos. */
export function Toggle({
  label,
  on,
  onPress,
  accessibilityLabel,
  color,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  color?: string;
}) {
  const active = color ?? K.terracotta;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={[styles.toggle, on && { backgroundColor: active, borderColor: active }]}
    >
      <Text style={[styles.toggleText, on && { color: K.ink }]}>{label}</Text>
    </Pressable>
  );
}

export function Check({ on }: { on: boolean }) {
  return (
    <View style={[styles.check, on && { backgroundColor: K.terracotta, borderColor: K.terracotta }]}>
      {on && (
        <Svg width={14} height={14} viewBox="0 0 24 24">
          <Path d="M4 12.5 L9.5 18 L20 6.5" fill="none" stroke={K.ink} strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      )}
    </View>
  );
}

/** A "caixa de seleção" das configurações de som: mostra a opção, abre a lista. */
export function SelectRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value)?.label ?? value;
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current}`}
        style={styles.selectRow}
      >
        <Text style={styles.selectLabel}>{label}</Text>
        <Text style={styles.selectValue}>{current} ▾</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{label}</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {options.map((o) => (
                <Pressable
                  key={o.value}
                  onPress={() => {
                    setOpen(false);
                    if (o.value !== value) onChange(o.value);
                  }}
                  style={({ pressed }) => [styles.modalOption, pressed && { backgroundColor: K.panelHi }]}
                >
                  <Text style={[styles.modalOptionText, o.value === value && { color: K.terracotta }]}>
                    {o.value === value ? '● ' : '○ '}
                    {o.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

/** Barra de volume horizontal (0–1), como a barrinha do topo no Mac. */
export function VolumeBar({
  value,
  onChange,
  onCommit,
  width = 130,
}: {
  value: number;
  onChange: (v: number) => void;
  onCommit: (v: number) => void;
  width?: number;
}) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const widthRef = useRef(width);
  widthRef.current = width;
  const last = useRef(value);
  const fromX = (x: number) => Math.round((Math.max(0, Math.min(widthRef.current, x)) / widthRef.current) * 20) / 20;
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          last.current = fromX(e.nativeEvent.locationX);
          onChangeRef.current(last.current);
        },
        onPanResponderMove: (e) => {
          last.current = fromX(e.nativeEvent.locationX);
          onChangeRef.current(last.current);
        },
        onPanResponderRelease: () => onCommitRef.current(last.current),
        onPanResponderTerminate: () => onCommitRef.current(last.current),
      }),
    [],
  );
  return (
    <View
      {...pan.panHandlers}
      accessibilityRole="adjustable"
      accessibilityLabel={`Volume ${Math.round(value * 100)}%`}
      style={{ width, height: 32, justifyContent: 'center' }}
    >
      <View pointerEvents="none" style={styles.volumeTrack}>
        <View style={[styles.volumeFill, { width: `${Math.round(value * 100)}%` }]} />
      </View>
      <View pointerEvents="none" style={[styles.volumeThumb, { left: Math.max(0, value * width - 8) }]} />
    </View>
  );
}

// A grega contínua do ícone: dois trilhos e as espirais ligadas, 10 "chaves".
const MEANDER = (() => {
  const H = 16;
  const P = 20;
  const N = 10;
  const W = P * N;
  const parts = [`M0,${H - 1} H${W}`, `M0,1 H${W}`];
  for (let i = 0; i < N; i += 1) {
    const x = i * P;
    parts.push(`M${x + 3},${H - 1} V4 H${x + 16} V${H - 4} H${x + 8} V8 H${x + 12}`);
  }
  return { d: parts.join(' '), W, H };
})();

/** A barra dos segundos: a grega encolhe sobre o próprio fantasma. frac = 0–1. */
export function MeanderBar({ frac, color, height = 26 }: { frac: number; color: string; height?: number }) {
  const { d, W, H } = MEANDER;
  const f = Math.max(0, Math.min(1, frac));
  return (
    <Svg width="100%" height={height} viewBox={`-2 -2 ${W + 4} ${H + 4}`} preserveAspectRatio="none">
      <Defs>
        <ClipPath id="kinesis-meander">
          <Rect x={-2} y={-2} width={(W + 4) * f} height={H + 4} />
        </ClipPath>
      </Defs>
      <Path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0.13} />
      <Path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" clipPath="url(#kinesis-meander)" />
    </Svg>
  );
}

export function SkipIcon({ direction, color, size = 30 }: { direction: 'prev' | 'next'; color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {direction === 'prev' ? (
        <>
          <Rect x={4} y={5} width={2.6} height={14} rx={0.6} fill={color} />
          <Path d="M19 5 L7.5 12 L19 19 Z" fill={color} />
        </>
      ) : (
        <>
          <Path d="M5 5 L16.5 12 L5 19 Z" fill={color} />
          <Rect x={17.4} y={5} width={2.6} height={14} rx={0.6} fill={color} />
        </>
      )}
    </Svg>
  );
}

export function BoltIcon({ color, size = 20 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M13.5 2 L5 13 h5.2 l-1.7 9 L19 10.5 h-5.2 z" fill={color} />
    </Svg>
  );
}

export function Panel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.panel, style]}>{children}</View>;
}

export const textStyles: Record<'muted' | 'hint', TextStyle> = {
  muted: { color: K.muted, fontSize: 14, fontFamily: F.regular },
  hint: { color: K.muted, fontSize: 13, lineHeight: 18, fontFamily: F.regular },
};

const styles = StyleSheet.create({
  sectionTitle: {
    color: K.terracotta,
    fontFamily: F.bold,
    fontSize: 16,
    letterSpacing: 1.2,
    marginTop: 22,
    marginBottom: 10,
  },
  smallButton: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: K.line,
    backgroundColor: K.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallButtonPrimary: { backgroundColor: K.terracotta, borderColor: K.terracotta },
  smallButtonText: { color: K.text, fontFamily: F.bold, fontSize: 14, letterSpacing: 0.6 },
  toggle: {
    minWidth: 40,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: K.line,
    backgroundColor: K.panel,
    alignItems: 'center',
  },
  toggleText: { color: K.text, fontFamily: F.bold, fontSize: 14 },
  check: {
    width: 24,
    height: 24,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: K.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: K.line,
  },
  selectLabel: { color: K.text, fontSize: 15, flexShrink: 1, fontFamily: F.regular },
  selectValue: { color: K.terracotta, fontSize: 15, fontFamily: F.bold },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: K.panel,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: K.line,
    paddingVertical: 12,
  },
  modalTitle: {
    color: K.terracotta,
    fontFamily: F.bold,
    fontSize: 16,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  modalOption: { paddingHorizontal: 16, paddingVertical: 13 },
  modalOptionText: { color: K.text, fontSize: 16, fontFamily: F.regular },
  volumeTrack: { height: 5, borderRadius: 3, backgroundColor: K.panelHi, overflow: 'hidden' },
  volumeFill: { height: 5, backgroundColor: K.terracotta },
  volumeThumb: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: K.terracotta,
    top: 8,
  },
  panel: {
    backgroundColor: K.panel,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: K.line,
    padding: 12,
  },
});
