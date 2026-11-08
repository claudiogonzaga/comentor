import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Owl } from '../components/Owl';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { HealthCard } from '../components/HealthCard';
import { GreekIcon } from '../components/GreekIcon';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors, radius, spacing, typography } from '../theme';
import {
  getDashboardData,
  markSleepDone,
  rearmSleepReminders,
  rescheduleAllNotifications,
} from '../services/coach';
import { useAppStore } from '../store/useAppStore';
import {
  setSpokenVolume,
  setSpokenHeadphonesOnly,
  isHeadphonesConnected,
} from '../services/spokenNudges';
import { VerticalVolume } from '../components/VerticalVolume';
import { SequenceCard } from '../components/SequenceCard';
import { InspirationHomeCard } from '../components/InspirationHomeCard';
import { AspisHomeCard } from '../aspis/components/AspisHomeCard';
import { HabitsTodaySection } from '../components/HabitsTodaySection';
import { useSnackbar } from '../components/Snackbar';
import { checkExerciseEvidence } from '../services/exerciseDetection';
import type { OwlMood } from '../types';
import { cancelSleepEscalationReminders } from '../services/notifications';
import { checkForUpdate, type UpdateInfo } from '../services/updateChecker';

interface Dashboard {
  config: { bedtime: string; name: string | null };
  minutesToBedtime: number | null;
  todayLog: { completed: boolean } | null;
  sleepHabit: { id: number } | null;
}

function formatCountdown(mins: number): { value: string; unit: string } {
  if (mins < 0) {
    const late = Math.abs(mins);
    if (late < 60) return { value: `${late}`, unit: 'min atrasado' };
    return { value: `${Math.floor(late / 60)}h${late % 60}`, unit: 'atrasado' };
  }
  if (mins < 60) return { value: `${mins}`, unit: 'min até dormir' };
  return { value: `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}`, unit: 'até dormir' };
}

/** Remove emojis coloridos do texto da notificação para manter a estética. */
function stripEmoji(s: string): string {
  return s
    .replace(
      /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{200D}]/gu,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMin = Math.round((Date.now() - then) / 60000);
  if (!Number.isFinite(diffMin)) return '';
  if (diffMin < 1) return 'agora mesmo';
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;
  const diffD = Math.round(diffH / 24);
  return `há ${diffD}d`;
}

function moodForState(d: Dashboard | null): OwlMood {
  if (!d) return 'calm';
  if (d.todayLog?.completed) return 'sleeping';
  if (d.minutesToBedtime !== null && d.minutesToBedtime < -30) return 'serious';
  if (d.minutesToBedtime !== null && d.minutesToBedtime < 0) return 'worried';
  return 'calm';
}

export function HomeScreen() {
  const navigation = useNavigation<any>();
  const { config: storeConfig, setConfig } = useAppStore();
  // Volume dos avisos/nudges (0–1). `volLive` reflete o arraste em tempo real.
  const [volLive, setVolLive] = useState<number | null>(null);
  const liveVol = volLive ?? storeConfig?.nudgeVolume ?? 1;

  // Persiste o volume ao soltar a barra: salva, espelha no nativo e — só quando
  // cruza a fronteira do mudo — reagenda tudo p/ trocar o canal (silencioso/com som).
  const commitVolume = useCallback(
    async (v: number) => {
      const silentNext = v <= 0;
      const silentPrev = storeConfig?.silentMode ?? false;
      try {
        await setConfig({ nudgeVolume: v, silentMode: silentNext });
        setSpokenVolume(v);
        if (silentNext !== silentPrev) await rescheduleAllNotifications();
      } catch (err) {
        console.warn('commitVolume failed:', err);
      } finally {
        setVolLive(null);
      }
    },
    [storeConfig?.silentMode, setConfig],
  );

  // "Só com fone": meio-termo entre o volume normal e o mudo — os avisos
  // continuam falando, mas só quando houver fone conectado. É a MESMA
  // configuração de "Sons e Voz"; aqui ela fica à mão, junto do volume.
  const headphonesOnly = storeConfig?.spokenHeadphonesOnly ?? false;

  // O aviso do modo fone é PASSAGEIRO: explica a mudança no instante em que ela
  // acontece e some. Quem indica o estado de forma permanente é o próprio botão
  // (dourado quando ligado) — deixar o texto fixo só roubava a tela.
  const [foneHint, setFoneHint] = useState<string | null>(null);
  const foneHintOpacity = useRef(new Animated.Value(0)).current;
  const foneHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showFoneHint = useCallback(
    (msg: string) => {
      if (foneHintTimer.current) clearTimeout(foneHintTimer.current);
      setFoneHint(msg);
      foneHintOpacity.setValue(1);
      foneHintTimer.current = setTimeout(() => {
        Animated.timing(foneHintOpacity, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished) setFoneHint(null);
        });
      }, 4500);
    },
    [foneHintOpacity],
  );

  // Sem isto, alternar e sair da tela deixaria o timer disparando num
  // componente já desmontado.
  useEffect(
    () => () => {
      if (foneHintTimer.current) clearTimeout(foneHintTimer.current);
    },
    [],
  );

  const toggleHeadphonesOnly = useCallback(async () => {
    const next = !headphonesOnly;
    try {
      await setConfig({ spokenHeadphonesOnly: next });
      setSpokenHeadphonesOnly(next); // espelha pro nativo, que lê no disparo
      showFoneHint(
        next
          ? 'Só com fone: os avisos só falam se houver fone conectado.'
          : 'Som normal: os avisos voltam a falar pelo alto-falante.',
      );
      if (next && !isHeadphonesConnected()) {
        Alert.alert(
          'Sem fone agora',
          'Enquanto não houver fone conectado, os avisos ficarão só como notificação (sem voz). Ao conectar um fone, a Comentora volta a falar — pelo fone.',
        );
      }
    } catch (err) {
      console.warn('toggle headphones-only failed:', err);
    }
  }, [headphonesOnly, setConfig, showFoneHint]);

  const [data, setData] = useState<Dashboard | null>(null);
  const [marking, setMarking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  // A seção de hábitos relê junto com a Home (foco e a cada 30 s).
  const [habitsKey, setHabitsKey] = useState(0);
  // Dia perfeito (todos os hábitos em formação feitos): a coruja comemora.
  const [perfectDay, setPerfectDay] = useState(false);
  // O aviso curto do pé da tela ("Feito: … · Desfazer").
  const snackbar = useSnackbar();

  useEffect(() => {
    // Throttled background check (only fires if 6h+ since last check).
    checkForUpdate(false).then((info) => {
      if (info.available) setUpdateInfo(info);
    });
  }, []);

  const reload = useCallback(async () => {
    const d = await getDashboardData();
    setData({
      config: { bedtime: d.config.bedtime, name: d.config.name },
      minutesToBedtime: d.minutesToBedtime,
      todayLog: d.todayLog ? { completed: d.todayLog.completed } : null,
      sleepHabit: d.sleepHabit ? { id: d.sleepHabit.id } : null,
    });
    // Treino gravado no relógio confirma o hábito de exercício (no máx. uma
    // leitura a cada 10 min); a seção de hábitos relê depois, já atualizada.
    await checkExerciseEvidence().catch(() => []);
    setHabitsKey((k) => k + 1);
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
      const interval = setInterval(reload, 30_000);
      return () => clearInterval(interval);
    }, [reload]),
  );

  useEffect(() => {
    reload();
  }, [reload]);

  const handleMarkDone = async () => {
    if (!data?.sleepHabit) return;
    setMarking(true);
    try {
      await markSleepDone(data.sleepHabit.id);
      // Só encerra a corrente de lembretes do sono desta noite — preserva
      // os nudges de inspiração, de conscientização e os diários.
      await cancelSleepEscalationReminders();
      // …e arma as noites seguintes (a desta noite fica de fora: já foi dormir).
      await rearmSleepReminders().catch(() => {});
      await reload();
    } finally {
      setMarking(false);
    }
  };

  // A coruja: dormindo depois de "Vou dormir agora"; comemorando no dia
  // perfeito; senão, o humor da hora de dormir.
  const mood: OwlMood = data?.todayLog?.completed ? 'sleeping' : perfectDay ? 'celebrating' : moodForState(data);
  const countdown = data?.minutesToBedtime !== null && data?.minutesToBedtime !== undefined
    ? formatCountdown(data.minutesToBedtime)
    : null;
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 6) return 'Boa madrugada';
    if (h < 12) return 'Bom dia';
    if (h < 18) return 'Boa tarde';
    return 'Boa noite';
  })();

  return (
    <ScreenContainer edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {updateInfo?.available && updateInfo.latestVersion && (
          <Pressable
            onPress={() => {
              const url = updateInfo.downloadUrl ?? updateInfo.releaseUrl;
              if (url) Linking.openURL(url);
            }}
            style={styles.updateBanner}
          >
            <GreekIcon name="sparkle" size={18} color={colors.accent.gold} />
            <Text style={styles.updateBannerText}>
              Atualização: v{updateInfo.latestVersion} disponível — toque para baixar
            </Text>
          </Pressable>
        )}
        <View style={styles.header}>
          <Text style={[typography.body, { color: colors.text.secondary }]}>
            {greeting}{data?.config.name ? `, ${data.config.name}` : ''}
          </Text>
          <View style={styles.headerRight}>
            <Pressable onPress={() => navigation.navigate('Settings')} hitSlop={10}>
              <GreekIcon name="settings" size={24} color={colors.text.secondary} />
            </Pressable>
            {/* Barra de volume dos avisos/nudges — desce até mudo. */}
            <View style={styles.volWrap}>
              <GreekIcon
                name={liveVol <= 0 ? 'mute' : 'sound'}
                size={16}
                color={liveVol <= 0 ? colors.text.tertiary : colors.text.secondary}
              />
              <VerticalVolume
                value={liveVol}
                height={84}
                onChange={(v) => {
                  setVolLive(v);
                  setSpokenVolume(v); // nativo já passa a usar no próximo aviso
                }}
                onCommit={commitVolume}
              />
              {/* Logo abaixo da barra: restringe a voz ao fone, sem precisar
                  zerar o volume. Ligado = dourado. */}
              <Pressable
                onPress={toggleHeadphonesOnly}
                hitSlop={10}
                accessibilityRole="switch"
                accessibilityState={{ checked: headphonesOnly }}
                accessibilityLabel="Falar somente com fone de ouvido"
                style={[styles.foneBtn, headphonesOnly && styles.foneBtnOn]}
              >
                <GreekIcon
                  name="headphones"
                  size={16}
                  color={headphonesOnly ? colors.text.onGold : colors.text.tertiary}
                />
              </Pressable>
            </View>
          </View>
        </View>
        {liveVol <= 0 && (
          <Text style={styles.silentHint}>
            Silencioso: avisos só em texto (sem piado nem voz). Arraste a barrinha
            para cima para reativar o som.
          </Text>
        )}
        {foneHint && (
          <Animated.Text style={[styles.silentHint, { opacity: foneHintOpacity }]}>
            {foneHint}
          </Animated.Text>
        )}

        <View style={styles.owlWrap}>
          <Owl mood={mood} size={180} />
        </View>

        {/* HÁBITOS (v1.130): o que é para hoje, logo abaixo da coruja. Substitui o
            antigo cartão "Hábitos saudáveis e lembretes" e os dois cartões de
            último/próximo lembrete — a seção já traz os hábitos do dia e, separados,
            os lembretes (remédios, suplementos, jejum). O resto da Home segue abaixo. */}
        <HabitsTodaySection refreshKey={habitsKey} snack={snackbar.show} onPerfectDay={setPerfectDay} />

        {data?.todayLog?.completed ? (
          <Card style={styles.bigCard}>
            <View style={styles.centerRow}>
              <GreekIcon name="moon" size={22} color={colors.accent.gold} />
              <Text style={[typography.subtitle, { color: colors.accent.gold, marginLeft: spacing.sm }]}>
                Boa noite!
              </Text>
            </View>
            <Text style={[typography.body, styles.cardBody]}>
              Você marcou que dormiu hoje. Vai bem, descanse fundo. A gente se vê amanhã.
            </Text>
          </Card>
        ) : countdown ? (
          <Card style={styles.bigCard}>
            <Text style={[typography.label, styles.label]}>
              {data?.minutesToBedtime !== null && data!.minutesToBedtime < 0 ? 'HORA DE DORMIR · ATRASADO' : 'HORA DE DORMIR'}
            </Text>
            <View style={styles.countdownRow}>
              <Text
                style={[
                  styles.countdownValue,
                  data?.minutesToBedtime !== null && data!.minutesToBedtime < 0 && {
                    color: colors.accent.warning,
                  },
                ]}
              >
                {countdown.value}
              </Text>
              <Text style={[typography.body, { color: colors.text.secondary, marginLeft: spacing.sm }]}>
                {countdown.unit}
              </Text>
            </View>
            <Text style={[typography.small, { color: colors.text.tertiary, textAlign: 'center' }]}>
              horário-alvo: {data?.config.bedtime}
            </Text>
          </Card>
        ) : null}

        {/* Painel de INSPIRAÇÃO (separado do de lembretes). */}
        <InspirationHomeCard />

        {/* O Aspis (o escudo): só o melhor de hoje; o resto mora na seção dele. */}
        <AspisHomeCard />

        <HealthCard />

        <View style={styles.actions}>
          {/* A Comentora conduz: abre o chat já comentando saúde/hábitos do dia. */}
          <Button
            label="Chat com Comentora"
            onPress={() => navigation.navigate('Chat')}
          />
          {!data?.todayLog?.completed && (
            <>
              <View style={{ height: spacing.sm }} />
              <Button
                label="Exercício de respiração"
                variant="secondary"
                onPress={() => navigation.navigate('Breathing')}
              />
              <View style={{ height: spacing.sm }} />
              <Button
                label="Vou dormir agora"
                variant="secondary"
                onPress={handleMarkDone}
                loading={marking}
              />
            </>
          )}
        </View>

        <View style={styles.secondaryActions}>
          <Button
            label="Leia para mim"
            variant="secondary"
            onPress={() => navigation.navigate('ReadAloud')}
          />
          <View style={{ height: spacing.sm }} />
          <Button
            label="Ioga Nidra"
            variant="secondary"
            onPress={() => navigation.navigate('YogaNidra')}
          />
        </View>

        {/* Playlist: tocar respiração + ioga nidra + leia para mim em sequência. */}
        <SequenceCard />

        <Pressable onPress={() => navigation.navigate('History')} style={styles.historyLink}>
          <Text style={[typography.bodyMedium, { color: colors.accent.gold }]}>
            Ver estatísticas →
          </Text>
        </Pressable>
      </ScrollView>
      {/* "Feito: … · Desfazer" — fica no pé da tela, por cima do que rola. */}
      {snackbar.node}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing.xl,
    // Desce o conteúdo abaixo da faixa superior do meandro (greca), para a
    // engrenagem/volume não ficarem sobrepostos à borda grega.
    paddingTop: spacing.xs,
    paddingBottom: spacing.xxl,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.md,
  },
  headerRight: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  volWrap: {
    alignItems: 'center',
    gap: 4,
  },
  foneBtn: {
    marginTop: 2,
    padding: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.bg.surfaceStrong,
  },
  foneBtnOn: {
    backgroundColor: colors.accent.gold,
    borderColor: colors.accent.gold,
  },
  silentHint: {
    ...typography.small,
    color: colors.accent.gold,
    marginTop: spacing.sm,
    lineHeight: 17,
  },
  owlWrap: {
    alignItems: 'center',
    marginVertical: spacing.lg,
  },
  centerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigCard: {
    marginBottom: spacing.lg,
    paddingVertical: spacing.xl,
  },
  cardBody: {
    color: colors.text.secondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.8,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
  },
  checkboxDone: {
    backgroundColor: colors.text.primary,
    borderColor: colors.text.primary,
  },
  label: {
    color: colors.text.tertiary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  countdownRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  countdownValue: {
    ...typography.hero,
    color: colors.accent.gold,
    fontSize: 48,
    lineHeight: 56,
  },
  actions: {
    marginBottom: spacing.xl,
  },
  secondaryActions: {
    marginBottom: spacing.sm,
  },
  historyLink: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  updateBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
    backgroundColor: 'rgba(244,197,83,0.18)',
    borderColor: colors.accent.gold,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
  },
  updateBannerText: {
    ...typography.bodyMedium,
    color: colors.accent.gold,
    textAlign: 'center',
  },
});
