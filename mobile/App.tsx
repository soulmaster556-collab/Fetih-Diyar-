import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { WEB_URL } from "./config";

// Oyun ilk kez yüklenene kadar native açılış ekranı (splash) açık kalsın.
SplashScreen.preventAutoHideAsync();

const BG = "#101b26";
const GOLD = "#f0b429";

// Geri tuşuna basılınca web tarafındaki köprüyü (client/src/App.tsx
// window.__fetihBack) çağırır: açık bir panel/modal varsa kapatır, yoksa
// native tarafa "kapatılacak bir şey yok" der.
const BACK_JS = `
  (function () {
    var handled = false;
    try { handled = !!(window.__fetihBack && window.__fetihBack()); } catch (e) {}
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: "back", handled: handled }));
  })();
  true;
`;

const ORIGIN = new URL(WEB_URL).origin;

export default function App() {
  const webRef = useRef<WebView>(null);
  const canGoBackRef = useRef(false);
  const lastBackRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  // Android geri tuşu
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (failed || !webRef.current) return false;
      webRef.current.injectJavaScript(BACK_JS);
      return true;
    });
    return () => sub.remove();
  }, [failed]);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    let data: { type?: string; handled?: boolean };
    try {
      data = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (data.type !== "back" || data.handled) return;
    if (canGoBackRef.current) {
      webRef.current?.goBack();
      return;
    }
    // Yanlışlıkla çıkmayı önlemek için: 2 saniye içinde ikinci kez bas.
    const now = Date.now();
    if (now - lastBackRef.current < 2000) {
      BackHandler.exitApp();
    } else {
      lastBackRef.current = now;
      setToast("Çıkmak için tekrar geri tuşuna bas");
      setTimeout(() => setToast(null), 2000);
    }
  }, []);

  const hideSplash = useCallback(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  const retry = () => {
    setFailed(false);
    setLoading(true);
    setReloadKey((k) => k + 1);
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <StatusBar style="light" />
        {failed ? (
          <View style={styles.center}>
            <Image source={require("./assets/splash-icon.png")} style={styles.logo} />
            <Text style={styles.title}>Bağlantı kurulamadı</Text>
            <Text style={styles.sub}>İnternet bağlantını kontrol edip tekrar dene.</Text>
            <Pressable style={styles.btn} onPress={retry}>
              <Text style={styles.btnText}>Tekrar Dene</Text>
            </Pressable>
          </View>
        ) : (
          <WebView
            key={reloadKey}
            ref={webRef}
            source={{ uri: WEB_URL }}
            style={styles.web}
            containerStyle={styles.web}
            originWhitelist={["*"]}
            javaScriptEnabled
            domStorageEnabled // localStorage -> oturum (giriş) kalıcı olsun
            cacheEnabled
            allowFileAccess // profil fotoğrafı yükleme (input type=file)
            mediaPlaybackRequiresUserAction={false}
            setSupportMultipleWindows={false}
            overScrollMode="never"
            bounces={false}
            pullToRefreshEnabled={false}
            textZoom={100} // telefonun yazı boyutu ayarı arayüzü bozmasın
            setBuiltInZoomControls={false}
            onMessage={onMessage}
            onNavigationStateChange={(s) => {
              canGoBackRef.current = s.canGoBack;
            }}
            onShouldStartLoadWithRequest={(req) => {
              const url = req.url;
              if (
                url.startsWith(ORIGIN) ||
                url.startsWith("about:") ||
                url.startsWith("data:") ||
                url.startsWith("blob:")
              ) {
                return true;
              }
              // Oyun dışı linkler (ör. dış site) telefonun tarayıcısında açılsın.
              Linking.openURL(url).catch(() => {});
              return false;
            }}
            onLoadEnd={() => {
              setLoading(false);
              hideSplash();
            }}
            onError={() => {
              setFailed(true);
              hideSplash();
            }}
            onHttpError={(e) => {
              if (e.nativeEvent.statusCode >= 500) {
                setFailed(true);
                hideSplash();
              }
            }}
            onRenderProcessGone={() => retry()}
          />
        )}
        {loading && !failed && (
          <View style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
            <Image source={require("./assets/splash-icon.png")} style={styles.logo} />
            <ActivityIndicator color={GOLD} size="large" />
          </View>
        )}
        {toast && (
          <View style={styles.toast} pointerEvents="none">
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  web: { flex: 1, backgroundColor: BG },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BG,
    padding: 24,
  },
  logo: { width: 180, height: 180, marginBottom: 24, borderRadius: 24 },
  title: { color: GOLD, fontSize: 20, fontWeight: "700", marginBottom: 8 },
  sub: { color: "#c9d6e2", fontSize: 14, textAlign: "center", marginBottom: 24 },
  btn: { backgroundColor: GOLD, paddingHorizontal: 28, paddingVertical: 12, borderRadius: 10 },
  btnText: { color: "#1a1204", fontWeight: "700", fontSize: 16 },
  toast: {
    position: "absolute",
    bottom: 100,
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.8)",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  toastText: { color: "#fff", fontSize: 14 },
});
