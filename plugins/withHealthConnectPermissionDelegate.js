const { withMainActivity } = require('@expo/config-plugins');
const {
  mergeContents,
} = require('@expo/config-plugins/build/utils/generateCode');

/**
 * react-native-health-connect exige que MainActivity registre o
 * ActivityResultLauncher das permissões CHAMANDO
 * `HealthConnectPermissionDelegate.setPermissionDelegate(this)` dentro do
 * onCreate (antes de a Activity chegar em STARTED). Sem isso, o `lateinit
 * requestPermission` da lib nunca é inicializado e a primeira chamada a
 * `requestPermission()` lança UninitializedPropertyAccessException dentro de
 * uma coroutine — um crash nativo NÃO capturável pelo try/catch do JS (o app
 * simplesmente fecha).
 *
 * Em projeto bare você editaria MainActivity.kt à mão (ver README da lib). No
 * fluxo gerenciado do Expo (CNG) não há MainActivity.kt versionado, então
 * injetamos a chamada durante o prebuild com este config plugin.
 */

const DELEGATE_IMPORT =
  'import dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate';
const DELEGATE_CALL =
  '    HealthConnectPermissionDelegate.setPermissionDelegate(this)';

function addImport(src) {
  if (src.includes(DELEGATE_IMPORT)) return src;
  // Insere o import logo após a declaração de package.
  return src.replace(/(^package .+\n)/m, `$1\n${DELEGATE_IMPORT}\n`);
}

function addDelegateCall(src) {
  if (src.includes('HealthConnectPermissionDelegate.setPermissionDelegate')) {
    return src;
  }
  const merged = mergeContents({
    tag: 'health-connect-permission-delegate',
    src,
    newSrc: DELEGATE_CALL,
    // Insere logo depois da linha do super.onCreate(...) dentro do onCreate.
    anchor: /super\.onCreate\([^)]*\)/,
    offset: 1,
    comment: '//',
  });
  return merged.contents;
}

module.exports = function withHealthConnectPermissionDelegate(config) {
  return withMainActivity(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') {
      throw new Error(
        'withHealthConnectPermissionDelegate só suporta MainActivity em Kotlin.',
      );
    }
    let contents = cfg.modResults.contents;
    contents = addImport(contents);
    contents = addDelegateCall(contents);
    cfg.modResults.contents = contents;
    return cfg;
  });
};
