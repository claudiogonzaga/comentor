import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ScreenContainer } from '../components/ScreenContainer';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { TimePickerInput } from '../components/TimePickerInput';
import { OwlSoundPicker } from '../components/OwlSoundPicker';
import { BreathingSoundPicker } from '../components/BreathingSoundPicker';
import { BreathingDurationPicker } from '../components/BreathingDurationPicker';
import { colors, radius, spacing, typography } from '../theme';
import { useAppStore } from '../store/useAppStore';
import { rescheduleAllNotifications } from '../services/coach';
import {
  sendTestNotification,
  openDndAccessSettings,
  openOwlChannelSettings,
} from '../services/notifications';
import { scheduleSleepAwarenessNotifications } from '../services/sleepAwareness';
import { scheduleInspirationNotifications } from '../services/inspiration';
import { scheduleAllMedications } from '../services/medications';
import {
  spokenNudgesAvailable,
  isExactAlarmAllowed,
  openExactAlarmSettings,
  isIgnoringBatteryOptimizations,
  requestIgnoreBatteryOptimizations,
  scheduleSpokenTest,
  cancelAllSpoken,
  setSpokenHeadphonesOnly,
  isHeadphonesConnected,
  setSpokenQuietHours,
} from '../services/spokenNudges';
import {
  listBreathingCustomSounds,
  createBreathingCustomSound,
  renameBreathingCustomSound,
  deleteBreathingCustomSound,
} from '../services/database';
import type { BreathingCustomSound, OwlSpeciesId } from '../types';

/**
 * "Configurar Sons e Notificações" — reúne TUDO de áudio e avisos numa tela:
 * o canto da coruja, sons/duração da respiração, a voz da Comentora e (vindo
 * de Configurações) o bloco de notificações: chat com voz, falar notificações,
 * lembretes do dia, modo inspiração, avisos falados (fone/horário silencioso),
 * teste, Não Perturbe e volume. Tudo salva automaticamente.
 */
export function SoundsVoiceScreen() {
  const navigation = useNavigation<any>();
  const { config, setConfig } = useAppStore();
  const [customSounds, setCustomSounds] = useState<BreathingCustomSound[]>([]);
  const [testingSpoken, setTestingSpoken] = useState(false);
  const [testingNotif, setTestingNotif] = useState(false);

  const voiceEnabled = config?.voiceModeEnabled ?? false;
  const voiceNudges = config?.voiceNudgesEnabled ?? false;
  const awarenessEnabled = config?.sleepAwarenessEnabled ?? true;
  const notifPerDay = config?.notificationsPerDay ?? 4;
  const inspirationMode = config?.inspirationModeEnabled ?? false;
  const inspPerDay = config?.inspirationPerDay ?? 6;
  const spokenNudges = config?.spokenNudgesEnabled ?? false;
  const headphonesOnly = config?.spokenHeadphonesOnly ?? false;
  const dndBypass = config?.dndBypassEnabled ?? false;

  const reloadCustomSounds = useCallback(async () => {
    try {
      setCustomSounds(await listBreathingCustomSounds());
    } catch {
      /* lista opcional */
    }
  }, []);

  useEffect(() => {
    reloadCustomSounds();
  }, [reloadCustomSounds]);

  const handleTestNotification = async () => {
    setTestingNotif(true);
    try {
      const { granted, scheduledCount, channel } = await sendTestNotification();
      if (!granted) {
        Alert.alert(
          'Notificações desligadas',
          'O Android está bloqueando as notificações da Comentora. Vá em Configurações do Android → Apps → Comentor → Notificações e ative tudo.',
        );
        return;
      }
      let diag = '';
      if (channel) {
        const soundLabel =
          channel.sound === null
            ? 'SEM SOM (silencioso)'
            : channel.sound === 'custom'
              ? 'canto da coruja'
              : 'som padrão';
        const importanceOk = channel.importance >= 4;
        diag =
          `\n\nDiagnóstico do canal:\n` +
          `• Som: ${soundLabel}\n` +
          `• Importância: ${channel.importance}/5 ${importanceOk ? '(ok)' : '(baixa)'}\n` +
          `• Atravessa Não Perturbe: ${channel.bypassDnd ? 'sim' : 'não'}\n` +
          `• Visível na tela bloqueada/relógio: ${channel.lockscreenVisibility === 1 ? 'sim' : 'restrito'}` +
          (channel.sound === null
            ? `\n\nO canal está SILENCIOSO. Toque em "Ajustar volume / som" e ative o som, ou apague os dados do app para recriar o canal.`
            : '');
      }
      Alert.alert(
        'Teste enviado',
        `Uma notificação deve aparecer em ~3 segundos.\n\n` +
          `${scheduledCount} lembrete(s) já agendado(s) para os próximos dias.` +
          diag +
          `\n\nSe a notificação NÃO aparecer, o problema é a permissão ou a otimização de bateria do aparelho.`,
      );
    } finally {
      setTestingNotif(false);
    }
  };

  const stepper = (value: number, min: number, max: number, onChange: (n: number) => void) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <Pressable
        onPress={() => onChange(Math.max(min, value - 1))}
        hitSlop={8}
        style={styles.stepBtn}
      >
        <Text style={styles.stepBtnText}>−</Text>
      </Pressable>
      <Text
        style={[
          typography.subtitle,
          { color: colors.text.primary, minWidth: 26, textAlign: 'center' },
        ]}
      >
        {value}
      </Text>
      <Pressable
        onPress={() => onChange(Math.min(max, value + 1))}
        hitSlop={8}
        style={styles.stepBtn}
      >
        <Text style={styles.stepBtnText}>+</Text>
      </Pressable>
    </View>
  );

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.back}>‹ Voltar</Text>
        </Pressable>
        <Text style={[typography.subtitle, { color: colors.text.primary }]}>
          Sons e Notificações
        </Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[typography.small, { color: colors.text.secondary, marginBottom: spacing.md }]}>
          Escolha o canto da coruja, os sons da respiração e como você quer ser
          avisado — tudo salva automaticamente. (A VOZ da Comentora fica em
          &quot;Cérebro e Voz da Comentora&quot;.)
        </Text>

        <OwlSoundPicker
          value={(config?.owlSpecies ?? 'buraqueira') as OwlSpeciesId}
          onChange={async (species: OwlSpeciesId) => {
            await setConfig({ owlSpecies: species });
            await rescheduleAllNotifications();
          }}
        />

        <BreathingSoundPicker
          value={config?.breathingSoundId ?? 'cello'}
          customSounds={customSounds}
          onSelect={async (id: string) => {
            await setConfig({ breathingSoundId: id });
          }}
          onAddSound={async (name: string, uri: string) => {
            const created = await createBreathingCustomSound({ name, uri });
            await reloadCustomSounds();
            await setConfig({ breathingSoundId: `custom:${created.id}` });
          }}
          onRename={async (id: number, name: string) => {
            await renameBreathingCustomSound(id, name);
            await reloadCustomSounds();
          }}
          onDelete={async (id: number) => {
            await deleteBreathingCustomSound(id);
            // se o excluído era o selecionado, volta para o som padrão.
            if (config?.breathingSoundId === `custom:${id}`) {
              await setConfig({ breathingSoundId: 'cello' });
            }
            await reloadCustomSounds();
          }}
        />

        <BreathingDurationPicker
          value={config?.breathingDurationMinutes ?? 16}
          onChange={async (minutes: number) => {
            await setConfig({ breathingDurationMinutes: minutes });
          }}
        />

        {/* A VOZ da Comentora agora mora em "Cérebro e Voz da Comentora". */}

        {/* ——— Notificações e avisos (veio de Configurações) ——— */}
        <Card style={styles.card}>
          <Text style={styles.section}>Notificações e avisos</Text>

          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={[typography.bodyMedium, { color: colors.text.primary }]}>
                Abrir o chat com voz ligada
              </Text>
              <Text style={[typography.small, { color: colors.text.secondary }]}>
                Por padrão a coruja só escreve. Ligando aqui, as conversas já
                começam com a leitura em voz alta — e você ainda pode
                silenciar pelo botão dentro do chat.
              </Text>
            </View>
            <Switch
              value={voiceEnabled}
              onValueChange={async (next) => {
                try {
                  await setConfig({ voiceModeEnabled: next });
                } catch (err) {
                  console.warn('toggle voice mode failed:', err);
                }
              }}
              trackColor={{ false: colors.bg.surfaceStrong, true: colors.accent.gold }}
              thumbColor={voiceEnabled ? colors.text.onGold : colors.text.tertiary}
            />
          </View>

          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={[typography.bodyMedium, { color: colors.text.primary }]}>
                Falar as notificações em voz alta
              </Text>
              <Text style={[typography.small, { color: colors.text.secondary }]}>
                Alternativa ao som: a coruja lê a notificação em voz alta (usa a
                voz escolhida acima) — útil se você não escuta o piado. Não fala
                por cima de uma chamada: se Teams/Meet/WhatsApp estiver em uso,
                esse app fica em primeiro plano e a Comentora não fala. Por
                limite do Android, a leitura em voz só funciona com o app aberto
                em primeiro plano — com a tela bloqueada quem te avisa é o piado
                da coruja.
              </Text>
            </View>
            <Switch
              value={voiceNudges}
              onValueChange={async (next) => {
                try {
                  await setConfig({ voiceNudgesEnabled: next });
                } catch (err) {
                  console.warn('toggle voice nudges failed:', err);
                }
              }}
              trackColor={{ false: colors.bg.surfaceStrong, true: colors.accent.gold }}
              thumbColor={voiceNudges ? colors.text.onGold : colors.text.tertiary}
            />
          </View>

          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={[typography.bodyMedium, { color: colors.text.primary }]}>
                Lembretes da Comentora
              </Text>
              <Text style={[typography.small, { color: colors.text.secondary }]}>
                Pequenas notificações ao longo do dia com fatos sobre a
                importância do sono, em horários variados.
              </Text>
            </View>
            <Switch
              value={awarenessEnabled}
              onValueChange={async (next) => {
                try {
                  await setConfig({ sleepAwarenessEnabled: next });
                  await scheduleSleepAwarenessNotifications();
                } catch (err) {
                  console.warn('toggle sleep awareness failed:', err);
                }
              }}
              trackColor={{ false: colors.bg.surfaceStrong, true: colors.accent.gold }}
              thumbColor={awarenessEnabled ? colors.text.onGold : colors.text.tertiary}
            />
          </View>

          {awarenessEnabled && (
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={[typography.bodyMedium, { color: colors.text.primary }]}>
                  Quantos por dia
                </Text>
                <Text style={[typography.small, { color: colors.text.secondary }]}>
                  Número de lembretes por dia. A frequência dobra depois do
                  pôr do sol (~18h), conforme a hora de dormir se aproxima.
                </Text>
              </View>
              {stepper(notifPerDay, 1, 12, async (n) => {
                try {
                  await setConfig({ notificationsPerDay: n });
                  await scheduleSleepAwarenessNotifications();
                } catch (err) {
                  console.warn('set notifications per day failed:', err);
                }
              })}
            </View>
          )}

          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={[typography.bodyMedium, { color: colors.text.primary }]}>
                Modo inspiração
              </Text>
              <Text style={[typography.small, { color: colors.text.secondary }]}>
                Ao longo do dia (8h–21h) a Comentora te manda mensagens curtas de
                otimismo, persistência e inspiração. Escolha quantas você quer
                receber logo abaixo.
              </Text>
            </View>
            <Switch
              value={inspirationMode}
              onValueChange={async (next) => {
                try {
                  await setConfig({ inspirationModeEnabled: next });
                  await scheduleInspirationNotifications();
                } catch (err) {
                  console.warn('toggle inspiration mode failed:', err);
                }
              }}
              trackColor={{ false: colors.bg.surfaceStrong, true: colors.accent.gold }}
              thumbColor={inspirationMode ? colors.text.onGold : colors.text.tertiary}
            />
          </View>

          {inspirationMode && (
            <Pressable
              onPress={() => navigation.navigate('InspirationLibrary')}
              style={styles.libraryRow}
            >
              <View style={{ flex: 1 }}>
                <Text style={[typography.bodyMedium, { color: colors.text.primary }]}>
                  Frases inspiradoras (biblioteca)
                </Text>
                <Text style={[typography.small, { color: colors.text.secondary }]}>
                  Escolha os pacotes, exclua/restaure cards, importe planilhas e
                  exporte o seu baralho.
                </Text>
              </View>
              <Text style={{ color: colors.accent.gold, fontSize: 20 }}>›</Text>
            </Pressable>
          )}

          {inspirationMode && (
            <View style={styles.toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={[typography.bodyMedium, { color: colors.text.primary }]}>
                  Quantas por dia
                </Text>
                <Text style={[typography.small, { color: colors.text.secondary }]}>
                  Mensagens de inspiração espalhadas ao longo do dia (8h–21h).
                </Text>
              </View>
              {stepper(inspPerDay, 1, 14, async (n) => {
                try {
                  await setConfig({ inspirationPerDay: n });
                  await scheduleInspirationNotifications();
                } catch (err) {
                  console.warn('set inspiration per day failed:', err);
                }
              })}
            </View>
          )}

          {spokenNudgesAvailable() && (
            <>
              <View style={styles.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[typography.bodyMedium, { color: colors.text.primary }]}>
                    Falar em voz alta
                  </Text>
                  <Text style={[typography.small, { color: colors.text.secondary }]}>
                    A Comentora FALA em voz alta os avisos inspiradores E os seus
                    lembretes (remédio, hábitos), mesmo com a tela apagada ou o app
                    fechado. Usa a voz escolhida acima (a voz do Gemini é preparada
                    uma vez e reaproveitada; sem voz/cota, cai na voz do sistema).
                  </Text>
                </View>
                <Switch
                  value={spokenNudges}
                  onValueChange={async (next) => {
                    try {
                      await setConfig({ spokenNudgesEnabled: next });
                      if (next) {
                        await scheduleInspirationNotifications();
                        // re-sincroniza as versões faladas dos lembretes também
                        await scheduleAllMedications();
                        if (!isExactAlarmAllowed()) {
                          Alert.alert(
                            'Permita alarmes exatos',
                            'Para falar na hora certa mesmo com o app fechado, o Android precisa da permissão de "alarmes e lembretes".',
                            [
                              { text: 'Agora não', style: 'cancel' },
                              { text: 'Abrir ajustes', onPress: () => openExactAlarmSettings() },
                            ],
                          );
                        }
                        if (!isIgnoringBatteryOptimizations()) {
                          Alert.alert(
                            'Desative a economia de bateria',
                            'Em alguns celulares (Xiaomi, Samsung…) a economia de bateria pode impedir a Comentora de falar. Recomendo liberar a execução sem restrição.',
                            [
                              { text: 'Agora não', style: 'cancel' },
                              {
                                text: 'Abrir ajustes',
                                onPress: () => requestIgnoreBatteryOptimizations(),
                              },
                            ],
                          );
                        }
                      } else {
                        await cancelAllSpoken();
                      }
                    } catch (err) {
                      console.warn('toggle spoken nudges failed:', err);
                    }
                  }}
                  trackColor={{ false: colors.bg.surfaceStrong, true: colors.accent.gold }}
                  thumbColor={spokenNudges ? colors.text.onGold : colors.text.tertiary}
                />
              </View>

              {spokenNudges && (
                <View style={[styles.toggleRow, { marginTop: spacing.sm }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[typography.bodyMedium, { color: colors.text.primary }]}>
                      Só falar com fone de ouvido
                    </Text>
                    <Text style={[typography.small, { color: colors.text.secondary }]}>
                      Quando ligado, a Comentora só fala se houver fone conectado
                      (com fio, Bluetooth ou USB). De qualquer forma, com fone
                      conectado o som SEMPRE sai pelo fone — nunca no alto-falante.
                    </Text>
                  </View>
                  <Switch
                    value={headphonesOnly}
                    onValueChange={async (next) => {
                      try {
                        await setConfig({ spokenHeadphonesOnly: next });
                        setSpokenHeadphonesOnly(next); // espelha pro nativo (lê no disparo)
                        if (next && !isHeadphonesConnected()) {
                          Alert.alert(
                            'Sem fone agora',
                            'Enquanto não houver fone conectado, os avisos ficarão só como notificação (sem voz). Ao conectar um fone, a Comentora volta a falar — pelo fone.',
                          );
                        }
                      } catch (err) {
                        console.warn('toggle headphones-only failed:', err);
                      }
                    }}
                    trackColor={{ false: colors.bg.surfaceStrong, true: colors.accent.gold }}
                    thumbColor={headphonesOnly ? colors.text.onGold : colors.text.tertiary}
                  />
                </View>
              )}

              {spokenNudges && (
                <View style={{ marginTop: spacing.md }}>
                  <View style={styles.toggleRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={[typography.bodyMedium, { color: colors.text.primary }]}>
                        Horário silencioso (sem voz)
                      </Text>
                      <Text style={[typography.small, { color: colors.text.secondary }]}>
                        Nos horários e dias escolhidos, os avisos NÃO falam em voz
                        alta — só notificam. Ex.: trabalho, audiências, academia.
                        Com FONE conectado a voz toca normalmente (sai pelo fone).
                      </Text>
                    </View>
                    <Switch
                      value={config?.spokenQuietEnabled ?? false}
                      onValueChange={async (next) => {
                        await setConfig({ spokenQuietEnabled: next });
                        setSpokenQuietHours({
                          spokenQuietEnabled: next,
                          spokenQuietStart: config?.spokenQuietStart ?? '09:00',
                          spokenQuietEnd: config?.spokenQuietEnd ?? '18:00',
                          spokenQuietDays: config?.spokenQuietDays ?? 127,
                        });
                      }}
                      trackColor={{ false: colors.bg.surfaceStrong, true: colors.accent.gold }}
                      thumbColor={
                        (config?.spokenQuietEnabled ?? false)
                          ? colors.text.onGold
                          : colors.text.tertiary
                      }
                    />
                  </View>

                  {(config?.spokenQuietEnabled ?? false) && (
                    <View style={{ marginTop: spacing.sm }}>
                      <View style={styles.quietTimesRow}>
                        <View style={{ flex: 1 }}>
                          <TimePickerInput
                            label="Início"
                            value={config?.spokenQuietStart ?? '09:00'}
                            onChange={async (hhmm) => {
                              await setConfig({ spokenQuietStart: hhmm });
                              setSpokenQuietHours({
                                spokenQuietEnabled: true,
                                spokenQuietStart: hhmm,
                                spokenQuietEnd: config?.spokenQuietEnd ?? '18:00',
                                spokenQuietDays: config?.spokenQuietDays ?? 127,
                              });
                            }}
                          />
                        </View>
                        <View style={{ width: spacing.md }} />
                        <View style={{ flex: 1 }}>
                          <TimePickerInput
                            label="Fim"
                            value={config?.spokenQuietEnd ?? '18:00'}
                            onChange={async (hhmm) => {
                              await setConfig({ spokenQuietEnd: hhmm });
                              setSpokenQuietHours({
                                spokenQuietEnabled: true,
                                spokenQuietStart: config?.spokenQuietStart ?? '09:00',
                                spokenQuietEnd: hhmm,
                                spokenQuietDays: config?.spokenQuietDays ?? 127,
                              });
                            }}
                          />
                        </View>
                      </View>

                      <Text style={styles.quietDaysLabel}>Dias</Text>
                      <View style={styles.quietDaysRow}>
                        {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((lbl, idx) => {
                          const mask = config?.spokenQuietDays ?? 127;
                          const on = ((mask >> idx) & 1) === 1;
                          return (
                            <Pressable
                              key={lbl}
                              onPress={async () => {
                                const nextMask = mask ^ (1 << idx);
                                await setConfig({ spokenQuietDays: nextMask });
                                setSpokenQuietHours({
                                  spokenQuietEnabled: true,
                                  spokenQuietStart: config?.spokenQuietStart ?? '09:00',
                                  spokenQuietEnd: config?.spokenQuietEnd ?? '18:00',
                                  spokenQuietDays: nextMask,
                                });
                              }}
                              style={[styles.quietDayChip, on && styles.quietDayChipOn]}
                            >
                              <Text style={[styles.quietDayText, on && styles.quietDayTextOn]}>
                                {lbl}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      <Text style={styles.quietHint}>
                        Dica: para o horário de trabalho, deixe Seg–Sex marcados.
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {spokenNudges && (
                <Pressable
                  onPress={async () => {
                    setTestingSpoken(true);
                    try {
                      const r = await scheduleSpokenTest(60);
                      if (r.ok) {
                        Alert.alert(
                          'Teste agendado ✓',
                          'Em 1 minuto a Comentora vai falar. Pode trancar a tela ou até fechar o app — você deve ouvir a voz mesmo assim.',
                        );
                      } else {
                        Alert.alert('Não consegui agendar o teste', r.reason ?? 'erro desconhecido');
                      }
                    } finally {
                      setTestingSpoken(false);
                    }
                  }}
                  disabled={testingSpoken}
                  style={[styles.testSpokenBtn, testingSpoken && { opacity: 0.6 }]}
                >
                  <Text style={[typography.small, { color: colors.accent.gold }]}>
                    {testingSpoken ? 'Gerando áudio…' : '▶ Testar agora (fala em 1 min)'}
                  </Text>
                </Pressable>
              )}
            </>
          )}

          <View style={{ height: spacing.md }} />
          <Button
            label="Testar notificação agora"
            variant="secondary"
            onPress={handleTestNotification}
            loading={testingNotif}
          />
          <Text style={[typography.small, { color: colors.text.tertiary, marginTop: spacing.sm }]}>
            Não está recebendo lembretes? Toque acima — se a notificação de teste
            não aparecer, o Android está bloqueando (permissão ou bateria).
          </Text>

          <View style={{ height: spacing.md }} />
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={[typography.bodyMedium, { color: colors.text.primary }]}>
                Atravessar o Não Perturbe
              </Text>
              <Text style={[typography.small, { color: colors.text.secondary }]}>
                No modo Não Perturbe a coruja ainda te alcança — só que sem
                som: ela apenas vibra, no padrão do canto da coruja. Você
                precisa liberar o &quot;acesso ao Não Perturbe&quot; do Android.
              </Text>
            </View>
            <Switch
              value={dndBypass}
              onValueChange={async (next) => {
                try {
                  await setConfig({ dndBypassEnabled: next });
                  await rescheduleAllNotifications();
                  if (next) await openDndAccessSettings();
                } catch (err) {
                  console.warn('toggle dnd bypass failed:', err);
                }
              }}
              trackColor={{ false: colors.bg.surfaceStrong, true: colors.accent.gold }}
              thumbColor={dndBypass ? colors.text.onGold : colors.text.tertiary}
            />
          </View>

          {dndBypass && (
            <Button
              label="Liberar acesso ao Não Perturbe"
              variant="secondary"
              onPress={openDndAccessSettings}
            />
          )}

          <View style={{ height: spacing.sm }} />
          <Button
            label="Ajustar volume / som das notificações"
            variant="secondary"
            onPress={openOwlChannelSettings}
          />
          <Text style={[typography.small, { color: colors.text.tertiary, marginTop: spacing.sm }]}>
            O Android não permite que o app mude o volume da notificação — quem
            controla é o sistema. Este botão abre a tela onde você ajusta
            volume, som e importância da coruja.
          </Text>
        </Card>

        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  back: {
    ...typography.bodyMedium,
    color: colors.accent.gold,
    minWidth: 60,
  },
  scroll: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  card: {
    marginTop: spacing.lg,
  },
  section: {
    ...typography.subtitle,
    color: colors.text.primary,
    marginBottom: spacing.sm,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  libraryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent.gold,
  },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.accent.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: {
    color: colors.accent.gold,
    fontSize: 22,
    lineHeight: 24,
  },
  testSpokenBtn: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.accent.gold,
  },
  quietTimesRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  quietDaysLabel: {
    ...typography.small,
    color: colors.text.secondary,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  quietDaysRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  quietDayChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  quietDayChipOn: {
    borderColor: colors.accent.gold,
    backgroundColor: colors.bg.surfaceStrong,
  },
  quietDayText: {
    ...typography.small,
    color: colors.text.secondary,
  },
  quietDayTextOn: {
    color: colors.accent.gold,
  },
  quietHint: {
    ...typography.small,
    color: colors.text.tertiary,
    marginTop: spacing.sm,
  },
});
