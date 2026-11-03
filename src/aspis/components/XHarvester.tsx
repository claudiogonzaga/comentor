// A página invisível que lê a timeline do X (ver services/x.ts). Só existe enquanto lê.
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { HARVEST_JS, onHarvestMessage, useXStore, X_HOME_URL, X_USER_AGENT } from '../services/x';

export function XHarvester() {
  const harvesting = useXStore((s) => s.harvesting);
  if (!harvesting) return null;
  return (
    <View style={styles.hidden} pointerEvents="none">
      <WebView
        source={{ uri: X_HOME_URL }}
        userAgent={X_USER_AGENT}
        injectedJavaScriptBeforeContentLoaded={HARVEST_JS}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        onMessage={(e) => onHarvestMessage(e.nativeEvent.data)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Com tamanho de celular: fora da tela, mas o site se comporta como numa tela real.
  hidden: { position: 'absolute', left: -2000, top: 0, width: 400, height: 800, opacity: 0 },
});
