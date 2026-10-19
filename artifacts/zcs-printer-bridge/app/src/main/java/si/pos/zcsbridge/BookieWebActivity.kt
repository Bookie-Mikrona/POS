package si.pos.zcsbridge

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

/**
 * Odpre Bookie (POS ali ERP) v WebView-u na celem zaslonu.
 *
 * Varnost: WebView sme naložiti samo https://bookie-erp.replit.app. Vsak drug
 * naslov se v WebView-u ne naloži (https se odpre v sistemskem brskalniku).
 * Brez JavaScript vmesnika, brez dostopa do datotek, brez dovoljenj strani
 * (kamera, lokacija, mikrofon).
 */
class BookieWebActivity : AppCompatActivity() {

    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        supportActionBar?.hide()
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val startUrl = startUrlFrom(intent)
        if (!isAllowedOrigin(Uri.parse(startUrl))) {
            finish()
            return
        }

        web = WebView(this)
        setContentView(web)
        hideSystemBars()

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            @Suppress("DEPRECATION") allowFileAccessFromFileURLs = false
            @Suppress("DEPRECATION") allowUniversalAccessFromFileURLs = false
            setGeolocationEnabled(false)
            // Stran je https, lokalni most (http://localhost) pa mora biti dosegljiv.
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            mediaPlaybackRequiresUserGesture = true
        }
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(web, false)
        }

        web.webChromeClient = WebChromeClient()
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                if (isAllowedOrigin(uri)) return false
                if (uri.scheme == "https") {
                    try { startActivity(Intent(Intent.ACTION_VIEW, uri)) } catch (_: Exception) { }
                } else {
                    Toast.makeText(this@BookieWebActivity, "Povezava ni dovoljena.", Toast.LENGTH_SHORT).show()
                }
                return true
            }
        }

        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl(startUrl)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (::web.isInitialized) web.saveState(outState)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }

    override fun onDestroy() {
        if (::web.isInitialized) {
            (web.parent as? android.view.ViewGroup)?.removeView(web)
            web.destroy()
        }
        super.onDestroy()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (::web.isInitialized && web.canGoBack()) web.goBack() else finish()
    }

    @Suppress("DEPRECATION")
    private fun hideSystemBars() {
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_FULLSCREEN or
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
    }

    companion object {
        const val ALLOWED_HOST = "bookie-erp.replit.app"
        const val EXTRA_TARGET = "target"
        const val TARGET_POS = "pos"
        const val TARGET_ERP = "erp"

        fun isAllowedOrigin(uri: Uri): Boolean =
            uri.scheme == "https" && uri.port == -1 && uri.host.equals(ALLOWED_HOST, ignoreCase = true) &&
                uri.userInfo == null

        fun startUrlFrom(intent: Intent): String =
            if (intent.getStringExtra(EXTRA_TARGET) == TARGET_ERP) "https://$ALLOWED_HOST/"
            else "https://$ALLOWED_HOST/pos/"
    }
}
