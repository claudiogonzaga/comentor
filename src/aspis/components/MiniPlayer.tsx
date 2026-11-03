// O vídeo do YouTube em miniatura, por cima da tela, em vez de baixar o arquivo.
// Usa o player oficial do YouTube. Ao terminar, ele fecha sozinho, antes de a tela
// final oferecer outros vídeos: o Aspis existe para não cair nesse feed.
import { useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMiniPlayer, type MiniPlayerItem } from '../store/useMiniPlayer';
import { colors } from '../theme';

const PLAYER_H = 200; // o YouTube exige pelo menos 200 × 200
const HEADER_H = 32;
// O YouTube recusa o player sem origem: a página carrega com a identidade do app.
const ORIGIN = 'https://com.claudiogonzaga.comentor';

function playerHtml(videoId: string): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;background:#000}#p{width:100%;height:100%}</style></head>
<body><div id="p"></div><script src="https://www.youtube.com/iframe_api"></script><script>
function post(m){window.ReactNativeWebView.postMessage(m)}
function onYouTubeIframeAPIReady(){new YT.Player('p',{width:'100%',height:'100%',videoId:${JSON.stringify(videoId)},
playerVars:{autoplay:1,playsinline:1,rel:0,iv_load_policy:3,origin:${JSON.stringify(ORIGIN)}},
events:{onReady:function(e){e.target.playVideo()},onStateChange:function(e){if(e.data===0)post('ended')},onError:function(e){post('error:'+e.data)}}})}
</script></body></html>`;
}

function MiniPlayer({ item }: { item: MiniPlayerItem }) {
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();
  const close = useMiniPlayer((s) => s.close);
  const markBlocked = useMiniPlayer((s) => s.markBlocked);
  const [error, setError] = useState<string | null>(null);

  const width = Math.min(356, screenW - 16);
  const offset = useRef(new Animated.ValueXY()).current;
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          offset.extractOffset();
        },
        onPanResponderMove: Animated.event([null, { dx: offset.x, dy: offset.y }], {
          useNativeDriver: false,
        }),
        onPanResponderRelease: () => offset.flattenOffset(),
      }),
    [offset],
  );

  const onMessage = (e: WebViewMessageEvent) => {
    const msg = e.nativeEvent.data;
    if (msg === 'ended') {
      close();
    } else if (msg.startsWith('error:')) {
      // 101 e 150: o dono não permite; 100: vídeo removido ou privado.
      const code = msg.slice(6);
      if (code === '101' || code === '150' || code === '153') {
        markBlocked(item.videoId);
        setError('O dono não deixa tocar fora do YouTube. Na síntese, use "Baixar e assistir".');
      } else {
        setError('Este vídeo não pôde tocar agora.');
      }
    }
  };

  return (
    <Animated.View
      style={[
        styles.box,
        { width, right: 8, bottom: insets.bottom + 12, transform: offset.getTranslateTransform() },
      ]}
    >
      <View style={styles.header} {...pan.panHandlers}>
        <Text style={styles.title} numberOfLines={1}>
          {item.title}
        </Text>
        <Pressable
          onPress={close}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Fechar o vídeo"
          style={styles.close}
        >
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>
      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : (
        <WebView
          source={{ html: playerHtml(item.videoId), baseUrl: ORIGIN }}
          style={styles.web}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          allowsFullscreenVideo
          mediaPlaybackRequiresUserAction={false}
          setSupportMultipleWindows={false}
          // Tocar no logo ou no título não pode levar ao site: é a porta do feed.
          onShouldStartLoadWithRequest={(req) =>
            !req.isTopFrame || req.url.startsWith(ORIGIN) || req.url === 'about:blank'
          }
          onMessage={onMessage}
        />
      )}
    </Animated.View>
  );
}

export function MiniPlayerHost() {
  const item = useMiniPlayer((s) => s.item);
  if (!item) return null;
  return <MiniPlayer key={item.videoId} item={item} />;
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.text.primary,
    elevation: 12,
  },
  header: {
    height: HEADER_H,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 10,
    gap: 8,
  },
  title: { flex: 1, color: colors.text.onGold, fontSize: 12.5, fontFamily: 'Inter_500Medium' },
  close: { width: 36, height: HEADER_H, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: colors.text.onGold, fontSize: 15 },
  web: { height: PLAYER_H, backgroundColor: '#000' },
  errorBox: { height: PLAYER_H, padding: 16, justifyContent: 'center' },
  errorText: { color: colors.text.onGold, fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
