const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');

/**
 * Requisito do Android 14+ (API 34) para o Health Connect: o app precisa
 * declarar uma Activity que trate o intent "ver uso da permissão", marcada com
 * a categoria HEALTH_PERMISSIONS. SEM isso, em Android 14+ a chamada
 * `requestPermission()` retorna imediatamente com resultado vazio e NENHUMA
 * tela de permissão aparece — exatamente o sintoma "clico em conectar e nada
 * acontece".
 *
 * O plugin do próprio react-native-health-connect só adiciona a ação pré-14
 * `androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE` na MainActivity, que NÃO
 * cobre o Android 14+ (onde o Health Connect faz parte do sistema). Este plugin
 * acrescenta o `<activity-alias>` exigido, apontando para a MainActivity.
 *
 * Doc oficial: https://developer.android.com/health-and-fitness/guides/health-connect/develop/get-started#show-privacy-policy
 */
const ALIAS_NAME = 'ViewPermissionUsageActivity';

module.exports = function withHealthConnectRationale(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app['activity-alias'] = app['activity-alias'] || [];

    const already = app['activity-alias'].some(
      (a) => a.$ && a.$['android:name'] === ALIAS_NAME,
    );
    if (!already) {
      app['activity-alias'].push({
        $: {
          'android:name': ALIAS_NAME,
          'android:exported': 'true',
          'android:targetActivity': '.MainActivity',
          'android:permission': 'android.permission.START_VIEW_PERMISSION_USAGE',
        },
        'intent-filter': [
          {
            action: [
              { $: { 'android:name': 'android.intent.action.VIEW_PERMISSION_USAGE' } },
            ],
            category: [
              { $: { 'android:name': 'android.intent.category.HEALTH_PERMISSIONS' } },
            ],
          },
        ],
      });
    }

    return cfg;
  });
};
