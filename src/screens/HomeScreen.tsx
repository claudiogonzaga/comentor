import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Owl } from '../components/Owl';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { HealthCard } from '../components/HealthCard';
import { GreekIcon } from '../components/GreekIcon';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors, radius, spacing, typography } from '../theme';
import { getDashboardData, markSleepDone, rescheduleAllNotifications } from '../services/coach';
import { useAppStore } from '../store/useAppStore';
import { setSpokenVolume } from '../services/spokenNudges';
import { VerticalVolume } from '../components/VerticalVolume';
import { SequenceCard } from '../components/SequenceCard';
import { InspirationHomeCard } from '../components/InspirationHomeCard';
import { getTodayTodos, type TodoItem } from '../services/todos';
import { confirmMedication, skipMedicationToday, snoozeMedication } from '../services/medications';
import { confirmNudge, skipNudgeToday, snoozeNudge } from '../services/nudges';
import {
  getLastNotification,
  syncLastNotificationFromTray,
  type LastNotification,
} from '../services/lastNotification';
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

  const [data, setData] = useState<Dashboard | null>(null);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [lastNotif, setLastNotif] = useState<LastNotification | null>(null);
  const [marking, setMarking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

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
    try {
      setTodos(await getTodayTodos());
    } catch {
      /* todos optional */
    }
    try {
      // Captura também lembretes que chegaram com o app fechado (bandeja).
      await syncLastNotificationFromTray();
      setLastNotif(await getLastNotification());
    } catch {
      /* last notif optional */
    }
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
      await reload();
    } finally {
      setMarking(false);
    }
  };

  // Painel de lembretes: as três respostas do coach por item pendente.
  const handleTodoAction = async (
    item: TodoItem,
    action: 'done' | 'skip' | 'snooze',
  ) => {
    try {
      if (item.kind === 'med' && item.medId != null) {
        if (action === 'done') await confirmMedication(item.medId);
        else if (action === 'skip') await skipMedicationToday(item.medId);
        else await snoozeMedication(item.medId, 30);
      } else if (item.kind === 'nudge' && item.nudgeType) {
        if (action === 'done') await confirmNudge(item.nudgeType);
        else if (action === 'skip') await skipNudgeToday(item.nudgeType);
        else await snoozeNudge(item.nudgeType, 30);
      }
    } catch {
      /* best-effort */
    }
    try {
      setTodos(await getTodayTodos());
    } catch {
      /* mantém estado */
    }
  };

  const mood = moodForState(data);
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

  const notifTitle = lastNotif ? stripEmoji(lastNotif.title) : '';
  const notifBody = lastNotif ? stripEmoji(lastNotif.body) : '';

  return (
    <ScreenContainer>
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
            </View>
          </View>
        </View>
        {liveVol <= 0 && (
          <Text style={styles.silentHint}>
            Silencioso: avisos só em texto (sem piado nem voz). Arraste a barrinha
            para cima para reativar o som.
          </Text>
        )}

        <View style={styles.owlWrap}>
          <Owl mood={mood} size={180} />
        </View>

        {/* #2 — O card exibido é o último lembrete que apareceu como notificação. */}
        {lastNotif && (notifTitle || notifBody) && (
          <Card style={styles.notifCard}>
            <View style={styles.notifHeader}>
              <GreekIcon name="bell" size={18} color={colors.accent.gold} />
              <Text style={styles.notifLabel}>ÚLTIMO LEMBRETE · {formatRelative(lastNotif.at)}</Text>
            </View>
            {notifTitle ? <Text style={styles.notifTitle}>{notifTitle}</Text> : null}
            {notifBody ? <Text style={styles.notifBody}>{notifBody}</Text> : null}
          </Card>
        )}

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
              {data?.minutesToBedtime !== null && data!.minutesToBedtime < 0 ? 'ATRASADO' : 'PRÓXIMO LEMBRETE'}
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

        {/* Painel de LEMBRETES: cada pendência traz as 3 respostas do coach. */}
        <Card style={styles.todoCard}>
          <Pressable
            style={styles.todoHeader}
            onPress={() => navigation.navigate('Reminders')}
          >
            <View style={styles.todoHeaderLeft}>
              <GreekIcon name="bell" size={18} color={colors.accent.gold} />
              <Text style={styles.todoTitle}>LEMBRETES</Text>
            </View>
            <GreekIcon name="chevronRight" size={18} color={colors.text.tertiary} />
          </Pressable>
          {todos.length === 0 && (
            <Text style={styles.todoEmpty}>
              Nenhum lembrete para hoje. Toque para adicionar.
            </Text>
          )}
          {todos.map((item) => (
            <View key={item.key} style={styles.todoItem}>
              <View style={styles.todoRow}>
                <View style={styles.todoIcon}>
                  <GreekIcon
                    name={item.icon}
                    size={20}
                    color={item.done ? colors.text.tertiary : colors.text.primary}
                  />
                </View>
                <View style={styles.todoTextWrap}>
                  <Text
                    style={[styles.todoItemTitle, item.done && styles.todoDoneText]}
                    numberOfLines={1}
                  >
                    {item.title}
                  </Text>
                  <Text style={styles.todoItemMeta} numberOfLines={1}>
                    {item.time}
                    {item.subtitle ? ` · ${item.subtitle}` : ''}
                  </Text>
                </View>
                {item.done && (
                  <Text style={[styles.todoStatus, item.skipped && styles.todoStatusSkip]}>
                    {item.skipped ? 'Não hoje' : '✓ Feito'}
                  </Text>
                )}
              </View>
              {!item.done && (
                <View style={styles.todoActions}>
                  <Pressable
                    style={[styles.actBtn, styles.actDone]}
                    onPress={() => handleTodoAction(item, 'done')}
                    hitSlop={4}
                  >
                    <Text style={styles.actDoneText}>Já fiz</Text>
                  </Pressable>
                  <Pressable
                    style={styles.actBtn}
                    onPress={() => handleTodoAction(item, 'snooze')}
                    hitSlop={4}
                  >
                    <Text style={styles.actText}>Mais tempo</Text>
                  </Pressable>
                  <Pressable
                    style={styles.actBtn}
                    onPress={() => handleTodoAction(item, 'skip')}
                    hitSlop={4}
                  >
                    <Text style={styles.actText}>Não hoje</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ))}
        </Card>

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
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing.xl,
    // Desce o conteúdo abaixo da faixa superior do meandro (greca), para a
    // engrenagem/volume não ficarem sobrepostos à borda grega.
    paddingTop: spacing.lg,
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
  notifCard: {
    marginBottom: spacing.lg,
  },
  notifHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  notifLabel: {
    ...typography.label,
    color: colors.accent.gold,
    textTransform: 'uppercase',
    marginLeft: spacing.xs,
  },
  notifTitle: {
    ...typography.bodyMedium,
    color: colors.text.primary,
    marginBottom: 2,
  },
  notifBody: {
    ...typography.body,
    color: colors.text.secondary,
    lineHeight: 22,
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
  todoCard: {
    marginBottom: spacing.lg,
  },
  todoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  todoHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  todoEmpty: {
    ...typography.small,
    color: colors.text.secondary,
    paddingBottom: spacing.sm,
  },
  todoTitle: {
    ...typography.label,
    color: colors.accent.gold,
    textTransform: 'uppercase',
    marginLeft: spacing.xs,
  },
  todoItem: {
    paddingVertical: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  todoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  todoStatus: {
    ...typography.small,
    color: colors.accent.gold,
    marginLeft: spacing.sm,
  },
  todoStatusSkip: { color: colors.text.tertiary },
  todoActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
    paddingLeft: 36,
  },
  actBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actText: { ...typography.small, color: colors.text.secondary },
  actDone: { borderColor: colors.accent.gold, backgroundColor: 'rgba(244,197,83,0.15)' },
  actDoneText: { ...typography.small, color: colors.accent.gold },
  todoIcon: {
    width: 28,
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  todoTextWrap: {
    flex: 1,
  },
  todoItemTitle: {
    ...typography.bodyMedium,
    color: colors.text.primary,
  },
  todoDoneText: {
    color: colors.text.tertiary,
    textDecorationLine: 'line-through',
  },
  todoItemMeta: {
    ...typography.small,
    color: colors.text.tertiary,
    marginTop: 1,
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
