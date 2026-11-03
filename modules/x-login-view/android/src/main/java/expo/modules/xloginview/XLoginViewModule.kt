package expo.modules.xloginview

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class XLoginViewModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("XLoginView")

    // O user agent que o login e a leitura do X usam (os dois precisam ser iguais).
    Function("chromeUserAgent") {
      appContext.reactContext?.let { chromeUserAgent(it) }
    }

    View(XLoginView::class) {
      Events("onUrl")
      Prop("url") { view: XLoginView, url: String -> view.want(url) }
      OnViewDidUpdateProps { view: XLoginView -> view.commit() }
      OnViewDestroys { view: XLoginView -> view.destroy() }
    }
  }
}
