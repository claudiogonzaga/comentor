import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radius, spacing, typography } from '../theme';
import { GEMINI_VOICES } from '../services/geminiTTS';
import {
  LANGUAGE_GROUPS,
  listLibraryVoices,
  rememberVoice,
  type CatalogVoice,
  type VoiceFilters,
  type VoiceGender,
} from '../services/geminiVoices';
import { previewGeminiVoice, stopSpeaking } from '../services/voice';

// Seletor das vozes do Gemini 3.8: as 30 vozes padrão (falam qualquer idioma) e a
// biblioteca estendida (2.000+), com filtros de IDIOMA e GÊNERO e busca. O filtro
// de idioma e o de gênero valem para as duas listas (a padrão é multilíngue, então
// só o gênero a restringe).

interface Props {
  /** Id da voz escolhida (nome da padrão ou id da biblioteca). */
  value: string;
  /** Rótulo da voz escolhida, para mostrar quando ela não está nas listas filtradas. */
  valueLabel: string;
  /** A biblioteca estendida só existe nos modelos 3.8. */
  libraryAvailable: boolean;
  hasApiKey: boolean;
  onChange: (voice: CatalogVoice) => void;
}

const GENDERS: { key: VoiceGender | null; label: string }[] = [
  { key: null, label: 'Todas' },
  { key: 'female', label: 'Femininas' },
  { key: 'male', label: 'Masculinas' },
  { key: 'neutral', label: 'Neutras' },
];

const GENDER_LABEL: Record<VoiceGender, string> = {
  female: 'feminina',
  male: 'masculina',
  neutral: 'neutra',
};

const PREBUILT: CatalogVoice[] = GEMINI_VOICES.map((v) => ({
  id: v.name,
  label: v.label,
  gender: v.gender,
  languages: [],
  accent: null,
  description: v.description.replace(/^(feminina|masculina), /, ''),
  source: 'prebuilt',
}));

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={[styles.chip, on && styles.chipOn]}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

export function GeminiVoicePicker({ value, valueLabel, libraryAvailable, hasApiKey, onChange }: Props) {
  const [language, setLanguage] = useState<string | null>('pt');
  const [gender, setGender] = useState<VoiceGender | null>(null);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [library, setLibrary] = useState<CatalogVoice[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [showPrebuilt, setShowPrebuilt] = useState(false);
  // Descarta respostas de uma consulta que já foi substituída por outra.
  const queryId = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 450);
    return () => clearTimeout(t);
  }, [search]);

  const filters: VoiceFilters = useMemo(
    () => ({ language, gender, search: debounced }),
    [language, gender, debounced],
  );

  const load = useCallback(
    async (token: string | null) => {
      const id = ++queryId.current;
      setLoading(true);
      setError(null);
      try {
        const r = await listLibraryVoices(filters, token);
        if (id !== queryId.current) return;
        setLibrary((prev) => (token ? [...prev, ...r.voices] : r.voices));
        setNext(r.next);
      } catch (e) {
        if (id !== queryId.current) return;
        if (!token) setLibrary([]);
        setNext(null);
        setError(e instanceof Error ? e.message : 'Não consegui carregar a biblioteca.');
      } finally {
        if (id === queryId.current) setLoading(false);
      }
    },
    [filters],
  );

  useEffect(() => {
    if (!libraryAvailable || !hasApiKey) return;
    void load(null);
  }, [load, libraryAvailable, hasApiKey]);

  const prebuilt = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    return PREBUILT.filter(
      (v) =>
        (!gender || v.gender === gender) &&
        (!q || v.label.toLowerCase().includes(q) || (v.description ?? '').toLowerCase().includes(q)),
    );
  }, [gender, debounced]);

  const choose = (v: CatalogVoice) => {
    if (v.source === 'library') void rememberVoice(v);
    onChange(v);
  };

  const preview = async (id: string) => {
    setPreviewError(null);
    if (previewing === id) {
      await stopSpeaking();
      setPreviewing(null);
      return;
    }
    setPreviewing(id);
    try {
      await previewGeminiVoice(id);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : 'falhou ao gerar áudio');
    } finally {
      // Deixa o indicador por alguns segundos e depois zera (a fala pode demorar).
      setTimeout(() => setPreviewing((c) => (c === id ? null : c)), 8000);
    }
  };

  const renderRow = (v: CatalogVoice) => {
    const selected = v.id === value;
    const sub = [
      v.gender ? GENDER_LABEL[v.gender] : null,
      v.languages.length ? v.languages.slice(0, 3).join(', ') : v.source === 'prebuilt' ? 'qualquer idioma' : null,
      v.accent,
      v.description,
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <View key={`${v.source}:${v.id}`} style={[styles.row, selected && styles.rowSelected]}>
        <Pressable style={styles.rowMain} onPress={() => choose(v)}>
          <Text style={styles.rowTitle}>{v.label}</Text>
          {sub ? <Text style={styles.rowSub} numberOfLines={2}>{sub}</Text> : null}
        </Pressable>
        <Pressable
          onPress={() => void preview(v.id)}
          style={[styles.playBtn, previewing === v.id && styles.playBtnActive]}
          hitSlop={6}
          disabled={!hasApiKey}
        >
          {previewing === v.id ? (
            <ActivityIndicator color={colors.accent.gold} size="small" />
          ) : (
            <Text style={[styles.playText, !hasApiKey && { opacity: 0.4 }]}>ouvir</Text>
          )}
        </Pressable>
        <Pressable onPress={() => choose(v)} hitSlop={6}>
          <View style={[styles.radio, selected && styles.radioActive]} />
        </Pressable>
      </View>
    );
  };

  const inLists = library.some((v) => v.id === value) || PREBUILT.some((v) => v.id === value);

  return (
    <View>
      <Text style={styles.label}>Voz</Text>
      {!inLists ? (
        <View style={[styles.row, styles.rowSelected]}>
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle}>{valueLabel}</Text>
            <Text style={styles.rowSub}>voz atual (fora do filtro)</Text>
          </View>
          <View style={[styles.radio, styles.radioActive]} />
        </View>
      ) : null}

      <Text style={styles.filterLabel}>Idioma</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Chip label="Todos" on={language === null} onPress={() => setLanguage(null)} />
        {LANGUAGE_GROUPS.map((g) => (
          <Chip key={g.key} label={g.label} on={language === g.key} onPress={() => setLanguage(g.key)} />
        ))}
      </ScrollView>

      <Text style={styles.filterLabel}>Gênero</Text>
      <View style={styles.chipsWrap}>
        {GENDERS.map((g) => (
          <Chip key={g.label} label={g.label} on={gender === g.key} onPress={() => setGender(g.key)} />
        ))}
      </View>

      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Buscar por nome, sotaque ou estilo…"
        placeholderTextColor={colors.text.tertiary}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.search}
      />

      {libraryAvailable ? (
        <View style={{ marginTop: spacing.sm }}>
          <Text style={styles.groupTitle}>
            Biblioteca ({library.length}
            {next ? '+' : ''} {library.length === 1 ? 'voz' : 'vozes'})
          </Text>
          {!hasApiKey ? (
            <Text style={styles.note}>Precisa da chave da API para listar as vozes da biblioteca.</Text>
          ) : null}
          {library.map(renderRow)}
          {loading ? <ActivityIndicator color={colors.accent.gold} style={{ marginVertical: spacing.sm }} /> : null}
          {error ? <Text style={styles.err}>{error}</Text> : null}
          {!loading && !error && hasApiKey && library.length === 0 ? (
            <Text style={styles.note}>Nenhuma voz da biblioteca com esses filtros.</Text>
          ) : null}
          {next && !loading ? (
            <Pressable onPress={() => void load(next)} style={styles.more}>
              <Text style={styles.moreText}>Carregar mais</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <Text style={styles.note}>
          A biblioteca com mais de 2.000 vozes, idiomas e sotaques só funciona nos modelos 3.8. Escolha o Flash-Lite
          ou o Flash acima para vê-la.
        </Text>
      )}

      <Pressable onPress={() => setShowPrebuilt((s) => !s)} style={styles.groupHeader}>
        <Text style={styles.groupTitle}>
          Vozes padrão ({prebuilt.length}) · falam qualquer idioma {showPrebuilt ? '▾' : '▸'}
        </Text>
      </Pressable>
      {showPrebuilt ? prebuilt.map(renderRow) : null}
      {showPrebuilt && prebuilt.length === 0 ? <Text style={styles.note}>Nenhuma voz padrão com esses filtros.</Text> : null}

      {previewError ? <Text style={styles.err}>{previewError}</Text> : null}
      <Text style={styles.hint}>
        Cada &quot;ouvir&quot; e cada fala fazem uma chamada à API. A biblioteca filtra por idioma e gênero no servidor
        do Google; as vozes padrão falam qualquer idioma, então só o gênero e a busca as restringem.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { ...typography.bodyMedium, color: colors.text.primary, marginBottom: spacing.sm },
  filterLabel: { ...typography.small, color: colors.text.secondary, marginTop: spacing.sm, marginBottom: 4 },
  chips: { gap: spacing.xs, paddingRight: spacing.md },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.bg.surfaceStrong,
  },
  chipOn: { borderColor: colors.accent.gold, backgroundColor: 'rgba(244,197,83,0.12)' },
  chipText: { ...typography.small, color: colors.text.secondary },
  chipTextOn: { color: colors.accent.gold },
  search: {
    ...typography.body,
    color: colors.text.primary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: 6,
    marginTop: spacing.md,
  },
  groupHeader: { marginTop: spacing.md },
  groupTitle: { ...typography.bodyMedium, color: colors.accent.gold, marginBottom: spacing.xs },
  note: { ...typography.small, color: colors.text.secondary, marginVertical: spacing.xs, lineHeight: 17 },
  more: { alignSelf: 'center', paddingVertical: spacing.sm },
  moreText: { ...typography.bodyMedium, color: colors.accent.gold },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: spacing.xs,
    gap: spacing.sm,
  },
  rowSelected: { borderColor: colors.accent.gold, backgroundColor: 'rgba(244,197,83,0.08)' },
  rowMain: { flex: 1 },
  rowTitle: { ...typography.bodyMedium, color: colors.text.primary },
  rowSub: { ...typography.small, color: colors.text.secondary, marginTop: 2 },
  playBtn: {
    width: 56,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.accent.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtnActive: { backgroundColor: 'rgba(244,197,83,0.18)' },
  playText: { ...typography.small, color: colors.accent.gold, fontSize: 12 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.text.tertiary },
  radioActive: { borderColor: colors.accent.gold, backgroundColor: colors.accent.gold },
  err: { ...typography.small, color: '#FF8A80', marginTop: spacing.xs },
  hint: { ...typography.small, color: colors.text.tertiary, marginTop: spacing.md, lineHeight: 17 },
});
