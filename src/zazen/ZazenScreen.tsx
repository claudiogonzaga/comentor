// A aba do Zazen: um timer de meditação na tradição Sōtō, minimalista de verdade.
// Parado: o ensō inteiro, a duração dentro dele, os poucos controles em texto
// miúdo e o selo para começar. Na sessão: só o ensō sendo pintado, o tempo e um
// "encerrar" discreto. Os sinos são do motor nativo: tocam com a tela apagada.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useKinesis } from '../kinesis/store';
import { Enso, type EnsoModo } from './Enso';
import { Hanko, Inscricao, PALETA, SERIFA, Washi } from './arte';
import { andamento, AVISOS, DURACOES, PREPAROS, SOM_DO_AVISO, type AvisoModo, type AvisoSom } from './sessao';
import { kinesisRodando, minutosDeHoje, useZazen } from './store';

const P = PALETA;

type Modo = 'parado' | 'preparando' | 'sentado' | 'gassho';

const ROTULO_PREPARO: Record<number, string> = { 0: '0', 15: '15 s', 30: '30 s', 60: '1 min' };
const ROTULO_AVISO: Record<AvisoModo, string> = { nenhum: 'nenhum', '5': '5', '10': '10', '15': '15 min', metade: 'metade' };
const ROTULO_SOM: Record<AvisoSom, string> = { taku: 'claves', sino: 'sino' };

export function ZazenScreen() {
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const loaded = useZazen((s) => s.loaded);
  const prefs = useZazen((s) => s.prefs);
  const sessao = useZazen((s) => s.sessao);
  const gasshoAte = useZazen((s) => s.gasshoAte);
  const dias = useZazen((s) => s.dias);
  const actions = useZazen.getState();

  const [area, setArea] = useState({ w: 0, h: 0 });
  const [agora, setAgora] = useState(Date.now());

  const anda = sessao ? andamento(sessao, agora) : null;
  const fase = anda?.fase ?? null;
  const modo: Modo = sessao
    ? fase === 'preparando'
      ? 'preparando'
      : 'sentado'
    : gasshoAte > agora
      ? 'gassho'
      : 'parado';

  // O relógio da tela: só bate com a aba à vista e algo acontecendo. Na
  // preparação, 4 vezes por segundo (a contagem é curta); sentado, uma.
  useEffect(() => {
    if (!focused) return;
    const beat = () => {
      useZazen.getState().tick();
      setAgora(Date.now());
    };
    beat();
    if (!sessao && !gasshoAte) return;
    const id = setInterval(beat, fase === 'preparando' ? 250 : 1000);
    return () => clearInterval(id);
  }, [focused, sessao, gasshoAte, fase]);

  // O ensō troca de forma (inteiro → gota → traço) devagar; fechar-se não pisca.
  const tipo: EnsoModo = modo === 'preparando' ? 'ponto' : modo === 'sentado' ? 'pintando' : 'inteiro';
  const surgir = useRef(new Animated.Value(1)).current;
  const tipoAntes = useRef(tipo);
  useEffect(() => {
    const de = tipoAntes.current;
    tipoAntes.current = tipo;
    if (de === tipo || (de === 'pintando' && tipo === 'inteiro')) return;
    surgir.setValue(0);
    Animated.timing(surgir, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [tipo, surgir]);

  // Os controles só existem parado: somem e voltam devagar, sem mexer no ensō.
  const parado = modo === 'parado';
  const controles = useRef(new Animated.Value(parado ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(controles, {
      toValue: parado ? 1 : 0,
      duration: parado ? 900 : 450,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [parado, controles]);

  const comecar = () => {
    if (kinesisRodando()) {
      Alert.alert('Zazen', 'O timer do Kinesis está rodando. Parar e começar o zazen?', [
        { text: 'Não', style: 'cancel' },
        {
          text: 'Parar e começar',
          onPress: () => {
            useKinesis.getState().stop();
            useZazen.getState().start();
          },
        },
      ]);
      return;
    }
    actions.start();
  };

  const encerrar = () => {
    // Na preparação nada começou ainda: encerra direto.
    if (modo === 'preparando') {
      actions.stop();
      return;
    }
    Alert.alert('Encerrar o zazen?', 'Para em silêncio, sem o sino.', [
      { text: 'Continuar', style: 'cancel' },
      { text: 'Encerrar', style: 'destructive', onPress: () => useZazen.getState().stop() },
    ]);
  };

  const ensoSize = Math.max(180, Math.min(area.w - 84, 300, area.h * 0.42 || 300));
  const hoje = minutosDeHoje(dias, agora);

  return (
    <View
      style={styles.root}
      onLayout={(e) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      <Washi width={area.w} height={area.h} />
      {loaded && area.w > 0 && (
        <ScrollView
          style={StyleSheet.absoluteFill}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 18 }]}
          scrollEnabled={parado}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.cabeca}>
            <Inscricao />
          </View>

          <View style={{ width: ensoSize, height: ensoSize }}>
            <Animated.View style={{ opacity: surgir }}>
              <Enso size={ensoSize} modo={tipo} frac={anda?.frac ?? 1} />
            </Animated.View>
            <View style={[StyleSheet.absoluteFill, styles.centro]} pointerEvents="box-none">
              {modo === 'parado' && (
                <View style={styles.duracao}>
                  <Pressable
                    onPress={() => actions.bumpMinutos(-1)}
                    hitSlop={16}
                    accessibilityRole="button"
                    accessibilityLabel="Um minuto a menos"
                    style={({ pressed }) => pressed && styles.premido}
                  >
                    <Text allowFontScaling={false} style={styles.ajuste}>−</Text>
                  </Pressable>
                  <View style={styles.tempo}>
                    <Text allowFontScaling={false} style={styles.numero}>{prefs.minutos}</Text>
                    <Text allowFontScaling={false} style={styles.unidade}>min</Text>
                  </View>
                  <Pressable
                    onPress={() => actions.bumpMinutos(1)}
                    hitSlop={16}
                    accessibilityRole="button"
                    accessibilityLabel="Um minuto a mais"
                    style={({ pressed }) => pressed && styles.premido}
                  >
                    <Text allowFontScaling={false} style={styles.ajuste}>+</Text>
                  </Pressable>
                </View>
              )}
              {modo === 'preparando' && anda && (
                <Text allowFontScaling={false} style={styles.preparo}>{anda.segundosDePreparo}</Text>
              )}
              {modo === 'sentado' && anda && (
                <View style={styles.tempo}>
                  <Text allowFontScaling={false} style={[styles.numero, styles.numeroSentado]}>{anda.minutosRestantes}</Text>
                  <Text allowFontScaling={false} style={styles.unidade}>min</Text>
                </View>
              )}
              {modo === 'gassho' && <Gassho />}
            </View>
          </View>

          <Animated.View style={[styles.controles, { opacity: controles }]} pointerEvents={parado ? 'auto' : 'none'}>
            <Opcoes
              itens={DURACOES.map((m) => ({ id: String(m), rotulo: String(m) }))}
              escolhido={String(prefs.minutos)}
              onEscolher={(id) => actions.setMinutos(Number(id))}
              largo
            />
            <Grupo rotulo="preparação">
              <Opcoes
                itens={PREPAROS.map((s) => ({ id: String(s), rotulo: ROTULO_PREPARO[s] }))}
                escolhido={String(prefs.preparo)}
                onEscolher={(id) => actions.patchPrefs({ preparo: Number(id) })}
              />
            </Grupo>
            <Grupo rotulo="avisos">
              <Opcoes
                itens={AVISOS.map((a) => ({ id: a, rotulo: ROTULO_AVISO[a] }))}
                escolhido={prefs.avisos}
                onEscolher={(id) => actions.patchPrefs({ avisos: id as AvisoModo })}
              />
            </Grupo>
            {prefs.avisos !== 'nenhum' && (
              <Grupo rotulo="som do aviso">
                <Opcoes
                  itens={(['taku', 'sino'] as AvisoSom[]).map((s) => ({ id: s, rotulo: ROTULO_SOM[s] }))}
                  escolhido={prefs.avisoSom}
                  onEscolher={(id) => {
                    actions.patchPrefs({ avisoSom: id as AvisoSom });
                    actions.preview(SOM_DO_AVISO[id as AvisoSom]);
                  }}
                />
              </Grupo>
            )}
            <Text allowFontScaling={false} style={styles.nota}>o volume dos sinos é o do Kinesis</Text>
          </Animated.View>

          <View style={styles.espaco} />

          <View style={styles.rodape}>
            {parado && (
              <Pressable
                onPress={comecar}
                accessibilityRole="button"
                accessibilityLabel="Começar o zazen"
                hitSlop={10}
                style={({ pressed }) => pressed && styles.premido}
              >
                <Hanko size={60} />
              </Pressable>
            )}
            {(modo === 'preparando' || modo === 'sentado') && (
              <Pressable onPress={encerrar} accessibilityRole="button" hitSlop={18}>
                <Text allowFontScaling={false} style={styles.encerrar}>encerrar</Text>
              </Pressable>
            )}
            {(parado || modo === 'gassho') && hoje > 0 && (
              <Text allowFontScaling={false} style={styles.hoje}>hoje · {hoje} min</Text>
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

/** 合掌: as mãos juntas, ao fim. Surge devagar dentro do ensō fechado. */
function Gassho() {
  const surgir = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(surgir, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [surgir]);
  return (
    <Animated.View style={[styles.tempo, { opacity: surgir }]}>
      <Text allowFontScaling={false} style={styles.gassho}>合掌</Text>
      <Text allowFontScaling={false} style={styles.gasshoLatim}>gasshō</Text>
    </Animated.View>
  );
}

function Grupo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <View style={styles.grupo}>
      <Text allowFontScaling={false} style={styles.rotulo}>{rotulo}</Text>
      {children}
    </View>
  );
}

/** Opções em texto, sem caixas: a escolhida em tinta, com um risco de pincel embaixo. */
function Opcoes({
  itens,
  escolhido,
  onEscolher,
  largo,
}: {
  itens: { id: string; rotulo: string }[];
  escolhido: string;
  onEscolher: (id: string) => void;
  largo?: boolean;
}) {
  return (
    <View style={styles.opcoes}>
      {itens.map((it, i) => {
        const on = it.id === escolhido;
        return (
          <View key={it.id} style={styles.opcaoLinha}>
            {i > 0 && !largo && <Text style={styles.ponto}>·</Text>}
            <Pressable
              onPress={() => onEscolher(it.id)}
              hitSlop={{ top: 10, bottom: 10, left: largo ? 6 : 4, right: largo ? 6 : 4 }}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={largo ? styles.opcaoLarga : styles.opcao}
            >
              <Text allowFontScaling={false} style={[styles.opcaoTexto, on && styles.opcaoOn]}>{it.rotulo}</Text>
              {on && <View style={styles.risco} />}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: P.papel },
  content: { flexGrow: 1, alignItems: 'center', paddingTop: 18 },
  cabeca: { alignSelf: 'stretch', alignItems: 'flex-end', paddingRight: 22, height: 64, marginBottom: 2 },
  centro: { alignItems: 'center', justifyContent: 'center' },
  duracao: { flexDirection: 'row', alignItems: 'center' },
  tempo: { alignItems: 'center', minWidth: 96 },
  numero: {
    fontFamily: SERIFA,
    fontWeight: '300',
    fontSize: 50,
    lineHeight: 58,
    color: P.tinta,
    opacity: 0.86,
    includeFontPadding: false,
  },
  numeroSentado: { fontSize: 44, lineHeight: 52, opacity: 0.8 },
  unidade: { fontFamily: SERIFA, fontSize: 12, letterSpacing: 3, color: P.lavado, marginTop: 2 },
  ajuste: { fontFamily: SERIFA, fontSize: 26, color: P.lavado, paddingHorizontal: 6 },
  preparo: { fontFamily: SERIFA, fontWeight: '300', fontSize: 26, color: P.lavado },
  gassho: { fontFamily: SERIFA, fontSize: 30, lineHeight: 38, color: P.tinta, opacity: 0.86, letterSpacing: 4 },
  gasshoLatim: { fontFamily: SERIFA, fontStyle: 'italic', fontSize: 12, letterSpacing: 2, color: P.lavado, marginTop: 4 },
  controles: { alignItems: 'center', marginTop: 22, paddingHorizontal: 20 },
  grupo: { alignItems: 'center', marginTop: 16 },
  rotulo: { fontFamily: SERIFA, fontSize: 10.5, letterSpacing: 2.5, color: P.lavado, marginBottom: 5 },
  opcoes: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' },
  opcaoLinha: { flexDirection: 'row', alignItems: 'center' },
  opcao: { paddingHorizontal: 2, paddingVertical: 3, alignItems: 'center' },
  opcaoLarga: { paddingHorizontal: 8, paddingVertical: 3, alignItems: 'center' },
  opcaoTexto: { fontFamily: SERIFA, fontSize: 14.5, color: P.lavado },
  opcaoOn: { color: P.tinta },
  ponto: { fontFamily: SERIFA, fontSize: 14, color: P.lavado, marginHorizontal: 7 },
  risco: {
    position: 'absolute',
    bottom: 0,
    height: 1.6,
    width: '72%',
    borderRadius: 1,
    backgroundColor: P.tinta,
    opacity: 0.7,
    transform: [{ rotate: '-2deg' }],
  },
  nota: { fontFamily: SERIFA, fontStyle: 'italic', fontSize: 10.5, color: P.lavado, marginTop: 18, opacity: 0.8 },
  espaco: { flex: 1, minHeight: 20 },
  rodape: { alignItems: 'center', justifyContent: 'flex-end', minHeight: 92 },
  encerrar: { fontFamily: SERIFA, fontSize: 13, letterSpacing: 2, color: P.lavado, paddingVertical: 6 },
  hoje: { fontFamily: SERIFA, fontSize: 11, letterSpacing: 1.5, color: P.lavado, marginTop: 14, opacity: 0.85 },
  premido: { opacity: 0.6 },
});
