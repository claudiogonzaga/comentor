package expo.modules.xloginview

import android.annotation.SuppressLint
import android.app.Dialog
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.os.Message
import android.view.KeyEvent
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

// Endereços que o WebView abre por conta própria; os outros (intent://, twitter://) ficam bloqueados.
private val WEB_SCHEMES = setOf("http", "https", "about", "data", "blob", "javascript")

private fun blocked(request: WebResourceRequest?): Boolean {
  val scheme = request?.url?.scheme ?: return false
  return scheme !in WEB_SCHEMES
}

/**
 * O user agent do Chrome deste aparelho, na forma reduzida que o Chrome envia hoje,
 * com a versão do próprio motor do WebView. O X recusa o WebView "puro".
 */
fun chromeUserAgent(context: Context): String {
  val base = WebSettings.getDefaultUserAgent(context)
  val major = Regex("Chrome/(\\d+)").find(base)?.groupValues?.get(1)
    ?: return base.replace("; wv)", ")").replace(Regex("Version/\\d+\\.\\d+ "), "")
  return "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/$major.0.0.0 Mobile Safari/537.36"
}

/**
 * A página de login do X num WebView próprio. O do react-native-webview manda as
 * janelas novas para o Chrome, e o "Entrar com o Google" do X é uma janela nova que
 * precisa devolver a resposta à página que a abriu: no Chrome, ela fica em branco.
 * Aqui a janela abre por cima, dentro do app, ainda ligada à página do X, e some
 * quando o Google a fecha.
 */
class XLoginView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onUrl by EventDispatcher()
  private val web = newWebView(context)
  private var wanted: String? = null
  private var loaded: String? = null
  private var popup: Dialog? = null

  override val shouldUseAndroidLayout = true

  init {
    web.webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?) = blocked(request)

      override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) = report(url)

      override fun doUpdateVisitedHistory(view: WebView?, url: String?, isReload: Boolean) = report(url)
    }
    web.webChromeClient = object : WebChromeClient() {
      override fun onCreateWindow(
        view: WebView?,
        isDialog: Boolean,
        isUserGesture: Boolean,
        resultMsg: Message?,
      ): Boolean = resultMsg != null && openPopup(resultMsg)
    }
    addView(web, LayoutParams(MATCH_PARENT, MATCH_PARENT))
  }

  // O React Native dá o tamanho desta view, mas não mede o WebView de dentro.
  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    val width = r - l
    val height = b - t
    web.measure(
      MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY),
      MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY),
    )
    web.layout(0, 0, width, height)
  }

  fun want(url: String) {
    wanted = url
  }

  /** Depois das props: carrega o endereço só quando ele muda. */
  fun commit() {
    val url = wanted ?: return
    if (url == loaded) return
    loaded = url
    web.loadUrl(url)
  }

  fun destroy() {
    closePopup()
    CookieManager.getInstance().flush()
    web.destroy()
  }

  override fun onDetachedFromWindow() {
    closePopup()
    super.onDetachedFromWindow()
  }

  private fun report(url: String?) {
    if (url == null) return
    // A sessão vai para o disco já: a leitura do X usa os mesmos cookies.
    CookieManager.getInstance().flush()
    onUrl(mapOf("url" to url))
  }

  private fun openPopup(resultMsg: Message): Boolean {
    val activity = appContext.currentActivity ?: return false
    closePopup()
    val child = newWebView(activity)
    child.webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?) = blocked(request)
    }
    child.webChromeClient = object : WebChromeClient() {
      override fun onCloseWindow(window: WebView?) = closePopup()
    }

    val density = resources.displayMetrics.density
    val pad = (16 * density).toInt()
    val close = TextView(activity).apply {
      text = "✕  Fechar"
      textSize = 16f
      setTextColor(Color.rgb(0x22, 0x22, 0x22))
      setPadding(pad, pad * 3 / 4, pad, pad * 3 / 4)
      setOnClickListener { closePopup() }
    }
    val box = LinearLayout(activity).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(Color.WHITE)
      addView(close, LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT))
      addView(child, LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f))
    }
    // A janela ocupa a tela toda: o conteúdo fica entre as barras do sistema e acima do teclado.
    ViewCompat.setOnApplyWindowInsetsListener(box) { v, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
      v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }

    val dialog = Dialog(activity, android.R.style.Theme_DeviceDefault_Light_NoActionBar)
    dialog.setContentView(box)
    dialog.window?.let { window ->
      window.setLayout(MATCH_PARENT, MATCH_PARENT)
      WindowCompat.getInsetsController(window, box)?.isAppearanceLightStatusBars = true
    }
    dialog.setOnKeyListener { _, keyCode, event ->
      if (keyCode != KeyEvent.KEYCODE_BACK || event.action != KeyEvent.ACTION_UP) return@setOnKeyListener false
      if (child.canGoBack()) child.goBack() else closePopup()
      true
    }
    dialog.setOnDismissListener {
      if (popup === dialog) popup = null
      child.destroy()
    }
    popup = dialog
    dialog.show()

    (resultMsg.obj as WebView.WebViewTransport).webView = child
    resultMsg.sendToTarget()
    return true
  }

  private fun closePopup() {
    val dialog = popup ?: return
    popup = null
    dialog.dismiss()
  }
}

@SuppressLint("SetJavaScriptEnabled")
private fun newWebView(context: Context): WebView = WebView(context).apply {
  settings.javaScriptEnabled = true
  settings.domStorageEnabled = true
  settings.setSupportMultipleWindows(true)
  settings.javaScriptCanOpenWindowsAutomatically = true
  settings.userAgentString = chromeUserAgent(context)
  CookieManager.getInstance().setAcceptCookie(true)
  CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
}
