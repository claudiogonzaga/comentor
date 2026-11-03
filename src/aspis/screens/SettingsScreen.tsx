// Configurações: conta Google + Drive, provedor de IA (Gemini ou Claude, o mesmo
// painel de Cérebro e Voz), chave Gemini (SecureStore), modelo, voz da leitura (Gemini TTS), pilares (CRUD), regras extras da IA e defaults
// de exibição.
import { ReactNode, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Switch,
} from 'react-native';
import { getNightGateEnabled, setNightGateEnabled } from '../bootstrap';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Chip } from '../components/Chip';
import { PeriodSegment } from '../components/PeriodSegment';
import { PrefetchPicker, RetentionPicker } from '../components/RetentionPicker';
import { TranscriptionSettings } from '../components/TranscriptionSettings';
import { ScreenContainer } from '../components/ScreenContainer';
import { StarsRuler } from '../components/StarsRuler';
import { MODEL_PRESETS } from '../constants/defaults';
import * as db from '../services/db';
import { neuralStats, resetNeural } from '../services/neural';
import { useXStore } from '../services/x';
import type { ChannelPref } from '../services/db';
import { GEMINI_VOICES } from '../services/geminiTTS';
import { MEDIA_SUPPORTED } from '../services/media';
import { TRANSCRIPTION_SUPPORTED } from '../services/transcription';
import { useReadAloud } from '../hooks/useReadAloud';
import { useAppStore } from '../store/useAppStore';
import { AiProviderPanel } from '../../components/AiProviderPanel';
import { useAppStore as useRootStore } from '../../store/useAppStore';
import type { RootStackParamList } from '../navigation/types';
import { colors, radius, spacing, typography } from '../theme';

const VOICE_SAMPLE =
  'Esta é a voz que vai ler os resumos dos seus vídeos em voz alta.';

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>;

function Section({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <Card style={styles.section}>
      <Text style={styles.secTitle}>{title}</Text>
      {sub ? <Text style={styles.secSub}>{sub}</Text> : null}
      {children}
    </Card>
  );
}

export function SettingsScreen({ navigation }: Props) {
  const rootConfig = useRootStore((s) => s.config);
  const setRootConfig = useRootStore((s) => s.setConfig);
  const {
    user,
    channel,
    geminiKey,
    model,
    pillars,
    rules,
    minStars,
    period,
    ttsVoice,
    noteLang,
    learnedPrefs,
    setGeminiKey,
    setModel,
    setRules,
    setMinStars,
    setPeriod,
    setTtsVoice,
    setNoteLang,
    setLearnedPrefs,
    runLearning,
    googleSignIn,
    googleSignOut,
    feedVersion,
  } = useAppStore();

  const [keyDraft, setKeyDraft] = useState('');
  const [keySaved, setKeySaved] = useState(false);
  const [modelDraft, setModelDraft] = useState(model);
  const [rulesDraft, setRulesDraft] = useState(rules);
  const [rulesSaved, setRulesSaved] = useState(false);
  const sample = useReadAloud();


  // Aprendizado / feedback
  const [muted, setMuted] = useState<ChannelPref[]>([]);
  const [skipCount, setSkipCount] = useState(0);
  const [learning, setLearning] = useState(false);
  const [learnError, setLearnError] = useState<string | null>(null);

  useEffect(() => {
    setMuted(db.getMutedChannels());
    setSkipCount(db.countSkips());
  }, [feedVersion]);

  const handleLearn = async () => {
    setLearning(true);
    setLearnError(null);
    try {
      await runLearning();
    } catch (e) {
      setLearnError(e instanceof Error ? e.message : String(e));
    } finally {
      setLearning(false);
    }
  };

  const unmute = (c: ChannelPref) => {
    db.setChannelState(c.channel_id, c.channel, 'allowed');
    setMuted(db.getMutedChannels());
  };

  const [nightGate, setNightGate] = useState(true);
  useEffect(() => {
    void getNightGateEnabled().then(setNightGate);
  }, []);

  const maskedKey = geminiKey
    ? `••••••••${geminiKey.slice(-4)}`
    : 'nenhuma chave configurada';

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.topbar}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
            <Text style={styles.back}>‹ Voltar</Text>
          </Pressable>
          <Text style={styles.title}>Configurações</Text>
          <View style={{ width: 60 }} />
        </View>

        <Section
          title="Conta Google"
          sub="Inscrições do YouTube (somente leitura) e notas no Drive."
        >
          {user ? (
            <View>
              <View style={styles.userRow}>
                {channel?.thumb ? (
                  <Image source={{ uri: channel.thumb }} style={styles.avatar} />
                ) : user.photo ? (
                  <Image source={{ uri: user.photo }} style={styles.avatar} />
                ) : null}
                <View style={{ flex: 1 }}>
                  <Text style={styles.userName}>{channel?.title || user.name}</Text>
                  {channel ? (
                    <Text style={styles.channelMeta}>
                      ▶ Canal do YouTube{channel.handle ? ` · ${channel.handle}` : ''}
                    </Text>
                  ) : null}
                  <Text style={styles.userEmail}>{user.email}</Text>
                </View>
              </View>
              <Text style={styles.driveStatus}>
                ✓ Notas salvas em Drive › Aspis (sincronize essa pasta com o vault do desktop).
              </Text>
              <Button
                label="Sair da conta"
                variant="secondary"
                onPress={googleSignOut}
                style={{ marginTop: spacing.lg }}
              />
            </View>
          ) : (
            <Button label="Conectar conta Google" onPress={() => googleSignIn()} />
          )}
        </Section>

        <XAccountSection onConnect={() => navigation.navigate('XLogin')} onDisconnect={() => navigation.navigate('XLogin', { logout: true })} />

        <Section
          title="Inteligência"
          sub="Gemini ou Claude, para o Aspis e para a Comentora. No Claude, cada tarefa tem o seu modelo e o seu raciocínio."
        >
          <AiProviderPanel
            provider={rootConfig?.aiProvider ?? 'gemini'}
            claudeModel={rootConfig?.claudeModel ?? ''}
            claudeEffort={rootConfig?.claudeEffort ?? 'medium'}
            onProviderChange={(p) => setRootConfig({ aiProvider: p })}
            onClaudeModelChange={(id) => setRootConfig({ claudeModel: id })}
            onClaudeEffortChange={(id) => setRootConfig({ claudeEffort: id })}
            perTask
          />
        </Section>

        <Section
          title="Chave Gemini"
          sub="A análise roda no aparelho com a SUA chave (fica no Keystore do Android, nunca em texto plano). É também a chave da voz e de assistir vídeos."
        >
          <Text style={styles.masked}>{maskedKey}</Text>
          <TextInput
            style={styles.input}
            value={keyDraft}
            onChangeText={(t) => {
              setKeyDraft(t);
              setKeySaved(false);
            }}
            placeholder="Cole a chave aqui (AIza…)"
            placeholderTextColor={colors.text.tertiary}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          <View style={styles.rowGap}>
            <Button
              label={keySaved ? '✓ Salva' : 'Salvar chave'}
              fullWidth={false}
              onPress={async () => {
                await setGeminiKey(keyDraft);
                setKeyDraft('');
                setKeySaved(true);
              }}
              disabled={!keyDraft.trim()}
            />
            <Pressable onPress={() => Linking.openURL('https://aistudio.google.com/apikey')}>
              <Text style={styles.link}>obter uma chave →</Text>
            </Pressable>
          </View>
        </Section>

        <Section
          title="Modelo do Gemini"
          sub="Vale com o Gemini como provedor e ao assistir um vídeo sem legenda. Edite se quiser outro modelo."
        >
          <View style={styles.chips}>
            {MODEL_PRESETS.map((m) => (
              <Chip
                key={m}
                label={m}
                active={modelDraft === m}
                onPress={() => {
                  setModelDraft(m);
                  setModel(m);
                }}
              />
            ))}
          </View>
          <TextInput
            style={[styles.input, { marginTop: spacing.md }]}
            value={modelDraft}
            onChangeText={setModelDraft}
            onEndEditing={() => modelDraft.trim() && setModel(modelDraft.trim())}
            placeholder="nome exato do modelo"
            placeholderTextColor={colors.text.tertiary}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Section>

        <Section
          title="Voz da leitura"
          sub="Voz do Gemini que lê os resumos em voz alta. Toque para escolher e ouvir uma amostra."
        >
          <View style={styles.chips}>
            {GEMINI_VOICES.map((v) => (
              <Chip
                key={v.name}
                label={`${v.label} · ${v.gender === 'female' ? '♀' : '♂'}`}
                active={ttsVoice === v.name}
                onPress={() => setTtsVoice(v.name)}
              />
            ))}
          </View>
          <Text style={styles.voiceDesc}>
            {GEMINI_VOICES.find((v) => v.name === ttsVoice)?.description ?? ''}
          </Text>
          <Pressable
            onPress={() => sample.toggle(VOICE_SAMPLE, ttsVoice, geminiKey)}
            style={({ pressed }) => [styles.sampleBtn, pressed && { opacity: 0.7 }]}
          >
            {sample.status === 'loading' ? (
              <ActivityIndicator size="small" color={colors.accent.gold} />
            ) : (
              <Text style={styles.sampleLabel}>
                {sample.status === 'playing' ? '■ Parar amostra' : '▶ Ouvir amostra'}
              </Text>
            )}
          </Pressable>
          {sample.error && <Text style={styles.voiceErr}>{sample.error}</Text>}
        </Section>

        <Section
          title="Idioma das notas"
          sub="Em que idioma a IA escreve resumo, pontos-chave, evidências e citações."
        >
          <View style={styles.chips}>
            <Chip
              label="Português (pt-BR)"
              active={noteLang === 'pt-BR'}
              onPress={() => setNoteLang('pt-BR')}
            />
            <Chip
              label="Idioma original do vídeo"
              active={noteLang === 'original'}
              onPress={() => setNoteLang('original')}
            />
          </View>
          <Text style={styles.voiceDesc}>
            {noteLang === 'pt-BR'
              ? 'Vídeos em outro idioma são traduzidos para o português.'
              : 'Cada nota fica no idioma original do vídeo (igual ao desktop).'}
          </Text>
        </Section>

        <Section
          title="Pilares"
          sub="Os seus objetivos de vida — a IA classifica e pontua cada vídeo por eles."
        >
          {pillars.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => navigation.navigate('PillarEdit', { pillarId: p.id })}
              style={({ pressed }) => [styles.pillarRow, pressed && { opacity: 0.7 }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.pillarName}>{p.nome}</Text>
                <Text style={styles.pillarDesc} numberOfLines={1}>
                  {p.descricao}
                </Text>
              </View>
              <Text style={styles.pillarPeso}>peso {p.peso}</Text>
              <Text style={styles.chev}>›</Text>
            </Pressable>
          ))}
          <Button
            label="+ Adicionar pilar"
            variant="secondary"
            onPress={() => navigation.navigate('PillarEdit', {})}
            style={{ marginTop: spacing.lg }}
          />
        </Section>

        <Section
          title="Critérios extras da IA"
          sub="Texto livre injetado no prompt (cada linha vira uma regra)."
        >
          <TextInput
            style={[styles.input, styles.multiline]}
            value={rulesDraft}
            onChangeText={(t) => {
              setRulesDraft(t);
              setRulesSaved(false);
            }}
            multiline
            placeholderTextColor={colors.text.tertiary}
          />
          <Button
            label={rulesSaved ? '✓ Salvas' : 'Salvar regras'}
            fullWidth={false}
            onPress={async () => {
              await setRules(rulesDraft);
              setRulesSaved(true);
            }}
            style={{ marginTop: spacing.md }}
          />
        </Section>

        <Section
          title="Hora de dormir"
          sub="O feed fecha da sua hora de dormir até as 6h, com a opção de abrir mesmo assim. Compartilhar um vídeo para o Aspis continua funcionando."
        >
          <View style={styles.versionRow}>
            <Text style={styles.versionValue}>Fechar o feed à noite</Text>
            <Switch
              value={nightGate}
              onValueChange={(v) => {
                setNightGate(v);
                void setNightGateEnabled(v);
              }}
            />
          </View>
        </Section>

        {MEDIA_SUPPORTED && (
          <Section
            title="Áudio e vídeo no celular"
            sub="“Ouvir áudio” e “Assistir vídeo” baixam o arquivo só para este celular e tocam no Aspis. Apagar sozinho depois de:"
          >
            <RetentionPicker />
            <Text style={[styles.voiceDesc, { marginBottom: spacing.sm }]}>
              Pré-baixar ao abrir um vídeo (áudio e vídeo ficam prontos antes de você tocar):
            </Text>
            <PrefetchPicker />
            <Pressable onPress={() => navigation.navigate('Media')} style={{ marginTop: spacing.md }}>
              <Text style={styles.link}>Ver o que está baixado ›</Text>
            </Pressable>
          </Section>
        )}

        {TRANSCRIPTION_SUPPORTED && (
          <Section
            title="Transcrição no celular"
            sub="Vídeos sem legenda são transcritos no próprio celular com o modelo NVIDIA Parakeet (ótimo em português, sem internet para transcrever) — e a triagem é refeita com o conteúdo real do vídeo."
          >
            <TranscriptionSettings />
          </Section>
        )}

        <Section title="Exibição" sub="Estrelas mínimas para um vídeo aparecer e período padrão.">
          <StarsRuler value={minStars} onChange={setMinStars} />
          <View style={{ marginTop: spacing.lg, alignItems: 'flex-start' }}>
            <PeriodSegment value={period} onChange={setPeriod} />
          </View>
        </Section>

        <Section
          title="Algoritmo & feedback"
          sub="O Aspis aprende com o que você pula (👎) e salva. Quanto mais você usa, melhor o ranqueamento."
        >
          <NeuralCard feedVersion={feedVersion} />

          <Text style={styles.fbStat}>
            {skipCount} vídeo{skipCount === 1 ? '' : 's'} pulado{skipCount === 1 ? '' : 's'} até agora
          </Text>

          {learnedPrefs ? (
            <View style={styles.learnedBox}>
              <Text style={styles.learnedTitle}>Perfil aprendido</Text>
              <Text style={styles.learnedText}>{learnedPrefs}</Text>
              <Pressable onPress={() => setLearnedPrefs('')}>
                <Text style={styles.learnedClear}>limpar perfil</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={styles.fbHint}>
              Ainda sem perfil. Pule e salve alguns vídeos, depois toque abaixo para o Aspis
              destilar o seu gosto e passar a usá-lo na pontuação.
            </Text>
          )}

          <Button
            label={learning ? 'Aprendendo…' : 'Aprender com meu feedback'}
            onPress={handleLearn}
            disabled={learning}
            style={{ marginTop: spacing.md }}
          />
          {learnError && <Text style={styles.fbErr}>{learnError}</Text>}

          <Text style={[styles.fbStat, { marginTop: spacing.lg }]}>
            Canais silenciados ({muted.length})
          </Text>
          {muted.length === 0 ? (
            <Text style={styles.fbHint}>Nenhum. Canais que você pula muito são silenciados sozinhos.</Text>
          ) : (
            muted.map((c) => (
              <View key={c.channel_id} style={styles.mutedRow}>
                <Text style={styles.mutedName} numberOfLines={1}>
                  {c.channel || c.channel_id}
                </Text>
                <Pressable onPress={() => unmute(c)} hitSlop={8}>
                  <Text style={styles.mutedAction}>reativar</Text>
                </Pressable>
              </View>
            ))
          )}
        </Section>

      </ScrollView>
    </ScreenContainer>
  );
}

/** A conta do X: a timeline dela entra no feed como uma segunda fonte. */
function XAccountSection({ onConnect, onDisconnect }: { onConnect: () => void; onDisconnect: () => void }) {
  const connected = useXStore((s) => s.connected);
  useEffect(() => {
    useXStore.getState().load();
  }, []);
  return (
    <Section
      title="Conta do X"
      sub="A sua timeline do X entra no feed, na aba X, ranqueada pelos mesmos pilares. A senha fica na página do X; o app guarda só a sessão, neste aparelho."
    >
      <Text style={styles.fbStat}>{connected ? 'Conectado.' : 'Não conectado.'}</Text>
      <Button
        label={connected ? 'Desconectar o X' : 'Conectar o X'}
        onPress={connected ? onDisconnect : onConnect}
        style={{ marginTop: spacing.md }}
      />
    </Section>
  );
}

/** A rede local: o que já aprendeu, o quanto pesa na nota e como zerá-la. */
function NeuralCard({ feedVersion }: { feedVersion: number }) {
  const [stats, setStats] = useState(neuralStats());
  useEffect(() => {
    setStats(neuralStats());
    const id = setInterval(() => setStats(neuralStats()), 2000);
    return () => clearInterval(id);
  }, [feedVersion]);
  const text =
    stats.labels === 0
      ? 'Rede neural local: ainda sem marcações. Dê 👍 ou 👎 nos vídeos do feed: ela treina aqui no aparelho, sem nuvem.'
      : stats.weightPct === 0
        ? `Rede neural local: ${stats.labels} marcações. A partir de 5 ela começa a influir no alinhamento.`
        : `Rede neural local: ${stats.labels} marcações, pesa ${stats.weightPct}% no alinhamento.` +
          (stats.total > 0 ? ` Acertou ${stats.hits} das últimas ${stats.total} antes de você marcar.` : '');
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text style={styles.fbStat}>{stats.training ? `${text} Treinando…` : text}</Text>
      {stats.labels > 0 && (
        <Pressable
          onPress={() =>
            Alert.alert('Zerar a rede neural?', 'Ela esquece tudo o que aprendeu e as marcações saem daqui.', [
              { text: 'Cancelar', style: 'cancel' },
              {
                text: 'Zerar',
                style: 'destructive',
                onPress: () => {
                  resetNeural();
                  setStats(neuralStats());
                },
              },
            ])
          }
        >
          <Text style={styles.learnedClear}>zerar a rede</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.lg },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  back: { ...typography.body, color: colors.accent.gold, minWidth: 60 },
  title: { ...typography.subtitle, color: colors.text.primary },
  section: { gap: 2 },
  secTitle: { ...typography.subtitle, fontSize: 16, color: colors.text.primary },
  secSub: { ...typography.small, color: colors.text.secondary, marginBottom: spacing.md },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  userName: { ...typography.bodyMedium, color: colors.text.primary },
  channelMeta: { ...typography.label, color: colors.accent.danger, textTransform: 'none', letterSpacing: 0, marginTop: 1 },
  userEmail: { ...typography.small, color: colors.text.secondary, marginTop: 1 },
  driveStatus: { ...typography.small, color: colors.accent.success, marginTop: spacing.md },
  masked: { ...typography.small, color: colors.text.secondary, marginBottom: spacing.sm },
  input: {
    ...typography.small,
    color: colors.text.primary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
  },
  multiline: { minHeight: 116, textAlignVertical: 'top' },
  rowGap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  link: { ...typography.small, color: colors.accent.gold },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  voiceDesc: { ...typography.small, color: colors.text.secondary, marginTop: spacing.sm },
  fbStat: { ...typography.small, color: colors.text.primary, fontFamily: 'Inter_600SemiBold' },
  fbHint: { ...typography.small, color: colors.text.secondary, marginTop: spacing.xs, lineHeight: 18 },
  fbErr: { ...typography.small, color: colors.accent.danger, marginTop: spacing.sm },
  learnedBox: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg.surface,
  },
  learnedTitle: { ...typography.label, color: colors.accent.gold, marginBottom: 4 },
  learnedText: { ...typography.small, color: colors.text.primary, lineHeight: 19 },
  learnedClear: { ...typography.label, textTransform: 'none', letterSpacing: 0, color: colors.text.tertiary, marginTop: spacing.sm },
  mutedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  mutedName: { ...typography.small, color: colors.text.primary, flex: 1 },
  mutedAction: { ...typography.small, color: colors.accent.gold },
  versionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  versionLabel: { ...typography.small, color: colors.text.secondary },
  versionValue: { ...typography.bodyMedium, color: colors.text.primary },
  updateBox: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent.gold,
    backgroundColor: colors.bg.surface,
  },
  updateTitle: { ...typography.bodyMedium, color: colors.text.primary },
  updateNotes: {
    ...typography.small,
    color: colors.text.secondary,
    marginTop: spacing.sm,
    lineHeight: 18,
  },
  upToDate: { ...typography.small, color: colors.accent.success, marginTop: spacing.md },
  sampleBtn: {
    alignSelf: 'flex-start',
    marginTop: spacing.md,
    paddingVertical: 7,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.accent.gold,
    minWidth: 140,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sampleLabel: { ...typography.small, fontFamily: 'Inter_600SemiBold', color: colors.text.primary },
  voiceErr: { ...typography.small, color: colors.accent.danger, marginTop: spacing.sm },
  pillarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  pillarName: { ...typography.bodyMedium, fontSize: 15, color: colors.text.primary },
  pillarDesc: { ...typography.small, color: colors.text.secondary },
  pillarPeso: { ...typography.label, color: colors.text.tertiary },
  chev: { fontSize: 20, color: colors.text.tertiary },
});
