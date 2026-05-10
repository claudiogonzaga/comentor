import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const REPO = 'claudiogonzaga/comentor';
const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const LAST_CHECK_KEY = 'comentor.lastUpdateCheckAt';
const SKIPPED_VERSION_KEY = 'comentor.skippedVersion';

export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string | null;
  downloadUrl: string | null;
  releaseUrl: string | null;
  notes: string | null;
  publishedAt: string | null;
}

export function getCurrentVersion(): string {
  return (Constants.expoConfig?.version as string | undefined) ?? '1.0.0';
}

function normalize(v: string): string {
  return v.trim().replace(/^v/i, '');
}

function compare(a: string, b: string): number {
  const an = normalize(a).split(/[.+-]/).map((p) => parseInt(p, 10) || 0);
  const bn = normalize(b).split(/[.+-]/).map((p) => parseInt(p, 10) || 0);
  const len = Math.max(an.length, bn.length);
  for (let i = 0; i < len; i++) {
    const ai = an[i] ?? 0;
    const bi = bn[i] ?? 0;
    if (ai > bi) return 1;
    if (ai < bi) return -1;
  }
  return 0;
}

interface GhAsset {
  name: string;
  browser_download_url: string;
  content_type: string;
  size: number;
}

interface GhRelease {
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
  assets: GhAsset[];
}

export async function checkForUpdate(force = false): Promise<UpdateInfo> {
  const current = getCurrentVersion();
  const empty: UpdateInfo = {
    available: false,
    currentVersion: current,
    latestVersion: null,
    downloadUrl: null,
    releaseUrl: null,
    notes: null,
    publishedAt: null,
  };

  if (!force) {
    const last = await AsyncStorage.getItem(LAST_CHECK_KEY);
    if (last && Date.now() - Number(last) < 6 * 60 * 60 * 1000) {
      // throttled (last checked under 6h ago); only proceed when forced
      return empty;
    }
  }

  try {
    const res = await fetch(RELEASES_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) {
      if (res.status === 404) return empty;
      throw new Error(`GitHub API ${res.status}`);
    }
    const release = (await res.json()) as GhRelease;
    if (release.draft || release.prerelease) return empty;

    await AsyncStorage.setItem(LAST_CHECK_KEY, String(Date.now()));

    const apkAsset =
      release.assets.find((a) => a.name.toLowerCase().endsWith('.apk')) ?? null;
    const latest = release.tag_name;
    const isNewer = compare(latest, current) > 0;

    return {
      available: isNewer,
      currentVersion: current,
      latestVersion: normalize(latest),
      downloadUrl: apkAsset?.browser_download_url ?? null,
      releaseUrl: release.html_url,
      notes: release.body || null,
      publishedAt: release.published_at,
    };
  } catch (err) {
    console.warn('update check failed:', err);
    return empty;
  }
}

export async function isVersionSkipped(version: string): Promise<boolean> {
  const skipped = await AsyncStorage.getItem(SKIPPED_VERSION_KEY);
  return skipped === normalize(version);
}

export async function skipVersion(version: string) {
  await AsyncStorage.setItem(SKIPPED_VERSION_KEY, normalize(version));
}

export async function clearSkip() {
  await AsyncStorage.removeItem(SKIPPED_VERSION_KEY);
}
