import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radius, spacing, typography } from '../theme';
import { AiTaskTable } from './AiTaskTable';
import {
  CLAUDE_EFFORTS,
  CLAUDE_MODELS,
  DEFAULT_CLAUDE_MODEL,
  claudeEffort,
  deleteClaudeKey,
  getClaudeKey,
  saveClaudeKey,
  testClaudeKey,
} from '../services/claude';
import type { AIProvider } from '../types';

// Quem "pensa" quando a inteligência é por API: Gemini (Google) ou Claude
// (Anthropic), na Comentora e no Aspis. Tudo aqui salva na hora. A voz neural é
// sempre a do Gemini — o Claude só gera texto —, então a chave do Gemini continua
// valendo para a voz.

interface Props {
  provider: AIProvider;
  claudeModel: string;
  claudeEffort: string;
  onClaudeEffortChange: (id: string) => void | Promise<void>;
  onProviderChange: (p: AIProvider) => void | Promise<void>;
  onClaudeModelChange: (id: string) => void | Promise<void>;
  /** Avisa a tela se há chave do Claude guardada (para liberar o "Salvar"). */
  onKeyState?: (hasKey: boolean) => void;
  /** Mostra o modelo e o raciocínio de cada tarefa, em vez de um modelo só para tudo. */
  perTask?: boolean;
}

export function AiProviderPanel({
  provider,
  claudeModel,
  claudeEffort: effortProp,
  onProviderChange,
  onClaudeModelChange,
  onClaudeEffortChange,
  onKeyState,
  perTask = false,
}: Props) {
  const [hasKey, setHasKey] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    void getClaudeKey().then((k) => setHasKey(!!k));
  }, []);
  useEffect(() => {
    onKeyState?.(hasKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasKey]);

  const model = claudeModel || DEFAULT_CLAUDE_MODEL;
  const key = input.trim();

  /** Testa a chave digitada e, se valer, guarda. */
  const saveKey = async () => {
    if (!key || busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const r = await testClaudeKey(key, model);
      if (!r.ok) {
        setStatus({ ok: false, msg: r.error ?? 'chave recusada' });
        return;
      }
      await saveClaudeKey(key);
      setHasKey(true);
      setInput('');
      setStatus({ ok: true, msg: 'chave válida e salva' });
    } catch {
      setStatus({ ok: false, msg: 'não consegui salvar a chave' });
    } finally {
      setBusy(false);
    }
  };

  const removeKey = () => {
    Alert.alert('Remover a chave do Claude?', 'Sem ela, a inteligência volta a usar o Gemini (se houver chave do Gemini).', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Remover',
        style: 'destructive',
        onPress: async () => {
          await deleteClaudeKey();
          setHasKey(false);
          setStatus(null);
        },
      },
    ]);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Provedor</Text>
      <View style={styles.chips}>
        {(['gemini', 'claude'] as const).map((p) => (
          <Pressable
            key={p}
            accessibilityRole="radio"
            accessibilityState={{ selected: provider === p }}
            onPress={() => void onProviderChange(p)}
            style={[styles.chip, provider === p && styles.chipOn]}
          >
            <Text style={[styles.chipText, provider === p && styles.chipTextOn]}>
              {p === 'gemini' ? 'Gemini (Google)' : 'Claude (Anthropic)'}
            </Text>
          </Pressable>
        ))}
      </View>

      {provider === 'claude' ? (
        <View>
          {perTask ? (
            <AiTaskTable />
          ) : (
            <View>
              <Text style={[styles.label, { marginTop: spacing.md }]}>Modelo Claude</Text>
              {CLAUDE_MODELS.map((m) => {
                const on = m.id === model;
                return (
                  <Pressable
                    key={m.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    onPress={() => void onClaudeModelChange(m.id)}
                    style={[styles.row, on && styles.rowOn]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[typography.bodyMedium, { color: colors.text.primary }]}>{m.label}</Text>
                      <Text style={[typography.small, { color: colors.text.secondary }]}>{m.sub}</Text>
                    </View>
                    <View style={[styles.radio, on && styles.radioOn]} />
                  </Pressable>
                );
              })}

              <Text style={[styles.label, { marginTop: spacing.md }]}>Raciocínio</Text>
              <View style={styles.chips}>
                {CLAUDE_EFFORTS.map((e) => {
                  const on = e.id === claudeEffort(effortProp);
                  return (
                    <Pressable
                      key={e.id}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`Raciocínio ${e.label}: ${e.sub}`}
                      onPress={() => void onClaudeEffortChange(e.id)}
                      style={[styles.chip, on && styles.chipOn]}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{e.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.note}>
                {CLAUDE_EFFORTS.find((e) => e.id === claudeEffort(effortProp))?.sub}. Quanto mais alto, melhor a resposta —
                e mais lenta e mais cara.
              </Text>

            </View>
          )}

          <Text style={[styles.label, { marginTop: spacing.md }]}>Chave da Anthropic</Text>
          {hasKey ? (
            <View style={styles.keyRow}>
              <Text style={[typography.body, { color: colors.text.primary }]}>✓ Chave salva e criptografada</Text>
              <Pressable onPress={removeKey} hitSlop={6}>
                <Text style={styles.danger}>Remover</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={styles.warn}>
              Nenhuma chave do Claude. Enquanto não houver, a inteligência usa o Gemini (se houver chave do Gemini).
            </Text>
          )}
          <TextInput
            value={input}
            onChangeText={(v) => {
              setInput(v);
              setStatus(null);
            }}
            placeholder={hasKey ? 'nova chave (substitui a atual)' : 'cole aqui a chave sk-ant-…'}
            placeholderTextColor={colors.text.tertiary}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          <View style={styles.actions}>
            <Pressable onPress={() => void saveKey()} disabled={!key || busy} style={[styles.btn, (!key || busy) && { opacity: 0.5 }]}>
              {busy ? (
                <ActivityIndicator color={colors.accent.gold} size="small" />
              ) : (
                <Text style={styles.btnText}>Testar e salvar</Text>
              )}
            </Pressable>
            {status ? (
              <Text style={[styles.status, { color: status.ok ? colors.accent.gold : colors.accent.danger }]} numberOfLines={2}>
                {status.ok ? '✓' : '✗'} {status.msg}
              </Text>
            ) : null}
          </View>
          <Pressable onPress={() => void Linking.openURL('https://console.anthropic.com/settings/keys')}>
            <Text style={styles.link}>Criar uma chave no console da Anthropic →</Text>
          </Pressable>
          <Text style={styles.note}>
            O Claude cuida do TEXTO: chat, cobranças, entrevista e argumentos da Comentora, e a análise de vídeos do
            Escudo. Ele não gera áudio nem assiste vídeo: a voz neural continua sendo a do Gemini, e um vídeo sem legenda
            só é assistido com a chave do Gemini. O uso do Claude é cobrado pela Anthropic na sua conta.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.lg },
  label: { ...typography.bodyMedium, color: colors.text.primary, marginBottom: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.bg.surfaceStrong,
  },
  chipOn: { borderColor: colors.accent.gold, backgroundColor: 'rgba(244,197,83,0.12)' },
  chipText: { ...typography.small, color: colors.text.secondary },
  chipTextOn: { color: colors.accent.gold },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: spacing.xs,
  },
  rowOn: { borderColor: colors.accent.gold, backgroundColor: 'rgba(244,197,83,0.08)' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.text.tertiary },
  radioOn: { borderColor: colors.accent.gold, backgroundColor: colors.accent.gold },
  keyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  danger: { ...typography.small, color: colors.accent.danger },
  warn: { ...typography.small, color: colors.accent.danger, marginBottom: spacing.sm, lineHeight: 17 },
  input: {
    ...typography.body,
    color: colors.text.primary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 6,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
  btn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.accent.gold,
    minWidth: 130,
    alignItems: 'center',
  },
  btnText: { ...typography.bodyMedium, color: colors.accent.gold },
  status: { ...typography.small, flex: 1 },
  link: { ...typography.small, color: colors.accent.gold, marginTop: spacing.sm },
  note: { ...typography.small, color: colors.text.tertiary, marginTop: spacing.sm, lineHeight: 17 },
});
