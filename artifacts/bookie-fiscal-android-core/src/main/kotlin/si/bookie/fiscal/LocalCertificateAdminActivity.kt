package si.bookie.fiscal

import android.app.Activity
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * Non-exported, foreground-only surface for the loopback certificate importer.
 * The caller must complete device credential confirmation before launching it.
 */
class LocalCertificateAdminActivity : Activity() {
    private lateinit var serverHandle: BookieFiscalHttpServer

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        serverHandle = BookieFiscalHttpServer(applicationContext)
        val web = WebView(this)
        web.settings.javaScriptEnabled = true
        web.settings.allowFileAccess = false
        web.settings.allowContentAccess = false
        web.webViewClient = WebViewClient()
        CookieManager.getInstance().setAcceptCookie(true)
        setContentView(web)
        // Do not start a second listener: the foreground print service owns it.
        web.loadUrl(serverHandle.createLocalAdminUrl())
    }

    override fun onDestroy() {
        serverHandle.close()
        super.onDestroy()
    }
}