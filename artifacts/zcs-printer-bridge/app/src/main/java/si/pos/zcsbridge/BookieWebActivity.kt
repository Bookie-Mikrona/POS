package si.pos.zcsbridge

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.Manifest
import android.content.pm.PackageManager
import android.webkit.CookieManager
import android.content.Context
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.webkit.JavascriptInterface
import android.webkit.GeolocationPermissions
import org.json.JSONObject
import android.webkit.PermissionRequest
import android.nfc.NfcAdapter
import android.nfc.Tag
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
 * Edini JavaScript vmesnik je BookieSpeech (glasovni vnos), samo za dovoljeni naslov; brez dostopa do datotek. Stran lahko zahteva kamero,
 * mikrofon in lokacijo; NFC se pošlje kot dogodek "bookie-nfc".
 */
class BookieWebActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private var pendingWebRequest: PermissionRequest? = null
    private var pendingGeo: Pair<String, GeolocationPermissions.Callback>? = null
    private var pendingPermissions: Array<String> = emptyArray()
    private var recognizer: SpeechRecognizer? = null
    private var speechAfterPermission = false

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
            setGeolocationEnabled(true)
            // Stran je https, lokalni most (http://localhost) pa mora biti dosegljiv.
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            mediaPlaybackRequiresUserGesture = true
        }
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(web, false)
        }

        // Edini JS vmesnik: glasovni vnos prek Androidovega prepoznavanja govora. Deluje samo za dovoljeni naslov.
        web.addJavascriptInterface(object {
            @JavascriptInterface
            fun available(): Boolean = allowedNow() && SpeechRecognizer.isRecognitionAvailable(this@BookieWebActivity)

            @JavascriptInterface
            fun start() { if (allowedNow()) runOnUiThread { startSpeech() } }

            @JavascriptInterface
            fun stop() { runOnUiThread { recognizer?.stopListening() } }
        }, "BookieSpeech")

        web.webChromeClient = object : WebChromeClient() {
            // Kamera, mikrofon in lokacija samo za dovoljeni origin; vse drugo ostane zavrnjeno.
            override fun onPermissionRequest(request: PermissionRequest) {
                val needed = request.resources.map {
                    when (it) {
                        PermissionRequest.RESOURCE_VIDEO_CAPTURE -> Manifest.permission.CAMERA
                        PermissionRequest.RESOURCE_AUDIO_CAPTURE -> Manifest.permission.RECORD_AUDIO
                        else -> null
                    }
                }
                if (needed.any { it == null } || !isAllowedOrigin(request.origin)) {
                    request.deny()
                    return
                }
                runOnUiThread { askAndroid(needed.filterNotNull().toTypedArray(), request, null) }
            }

            override fun onPermissionRequestCanceled(request: PermissionRequest) {
                if (pendingWebRequest === request) pendingWebRequest = null
            }

            override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
                if (!isAllowedOrigin(Uri.parse(origin))) {
                    callback.invoke(origin, false, false)
                    return
                }
                runOnUiThread { askAndroid(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION), null, Pair(origin, callback)) }
            }
        }
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

    private fun allowedNow(): Boolean {
        val current = runCatching { web.url }.getOrNull() ?: return false
        return isAllowedOrigin(Uri.parse(current))
    }

    private fun speechEvent(type: String, text: String? = null) {
        val json = JSONObject().put("type", type).apply { if (text != null) put("text", text) }
        runOnUiThread {
            if (allowedNow()) web.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('bookie-speech',{detail:$json}))", null,
            )
        }
    }

    private fun startSpeech() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            speechAfterPermission = true
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), SPEECH_PERMISSION_REQUEST_CODE)
            return
        }
        recognizer?.destroy()
        val r = SpeechRecognizer.createSpeechRecognizer(this)
        recognizer = r
        r.setRecognitionListener(object : RecognitionListener {
            override fun onBeginningOfSpeech() = speechEvent("activity")
            override fun onResults(results: android.os.Bundle) {
                val text = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                if (!text.isNullOrBlank()) speechEvent("result", text)
                speechEvent("end")
            }
            override fun onError(error: Int) {
                // 7 = ni govora, 6 = časovna omejitev: ni napaka za uporabnika
                if (error != SpeechRecognizer.ERROR_NO_MATCH && error != SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                    speechEvent("error", error.toString())
                }
                speechEvent("end")
            }
            override fun onReadyForSpeech(params: android.os.Bundle?) {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onPartialResults(partialResults: android.os.Bundle?) {}
            override fun onEvent(eventType: Int, params: android.os.Bundle?) {}
        })
        r.startListening(
            Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "sl-SI")
                .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false),
        )
    }

    private fun askAndroid(
        perms: Array<String>,
        request: PermissionRequest?,
        geo: Pair<String, GeolocationPermissions.Callback>?,
    ) {
        if (perms.all { checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }) {
            resolve(perms, request, geo, true)
            return
        }
        pendingWebRequest?.deny()
        pendingGeo?.let { it.second.invoke(it.first, false, false) }
        pendingWebRequest = request
        pendingGeo = geo
        pendingPermissions = perms
        requestPermissions(perms, WEB_PERMISSION_REQUEST_CODE)
    }

    private fun resolve(
        perms: Array<String>,
        request: PermissionRequest?,
        geo: Pair<String, GeolocationPermissions.Callback>?,
        granted: Boolean,
    ) {
        if (request != null) {
            if (granted) {
                request.grant(perms.mapNotNull {
                    when (it) {
                        Manifest.permission.CAMERA -> PermissionRequest.RESOURCE_VIDEO_CAPTURE
                        Manifest.permission.RECORD_AUDIO -> PermissionRequest.RESOURCE_AUDIO_CAPTURE
                        else -> null
                    }
                }.toTypedArray())
            } else request.deny()
        }
        geo?.second?.invoke(geo.first, granted, false)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == SPEECH_PERMISSION_REQUEST_CODE) {
            val ok = grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED
            if (ok && speechAfterPermission) startSpeech() else { speechEvent("error", "not-allowed"); speechEvent("end") }
            speechAfterPermission = false
            return
        }
        if (requestCode != WEB_PERMISSION_REQUEST_CODE) return
        val request = pendingWebRequest
        val geo = pendingGeo
        val perms = pendingPermissions
        pendingWebRequest = null
        pendingGeo = null
        resolve(perms, request, geo, grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED })
    }

    // NFC: ob dotiku kartice/oznake stran dobi dogodek "bookie-nfc" z detail.uid (šestnajstiško).
    // Samo native → stran, brez JavaScript vmesnika; dogodek se pošlje samo dovoljenemu naslovu.
    override fun onResume() {
        super.onResume()
        NfcAdapter.getDefaultAdapter(this)?.enableReaderMode(
            this,
            { tag: Tag ->
                val uid = tag.id.joinToString("") { "%02X".format(it) }
                runOnUiThread {
                    val current = web.url ?: return@runOnUiThread
                    if (isAllowedOrigin(Uri.parse(current))) {
                        web.evaluateJavascript(
                            "window.dispatchEvent(new CustomEvent('bookie-nfc',{detail:{uid:'$uid'}}))", null,
                        )
                    }
                }
            },
            NfcAdapter.FLAG_READER_NFC_A or NfcAdapter.FLAG_READER_NFC_B or
                NfcAdapter.FLAG_READER_NFC_F or NfcAdapter.FLAG_READER_NFC_V or
                NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS,
            null,
        )
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
        NfcAdapter.getDefaultAdapter(this)?.disableReaderMode(this)
        CookieManager.getInstance().flush()
    }

    override fun onDestroy() {
        recognizer?.destroy()
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
        private const val WEB_PERMISSION_REQUEST_CODE = 4101
        private const val SPEECH_PERMISSION_REQUEST_CODE = 4102
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
