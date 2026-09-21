package com.bookievivabridge

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject

open class MainActivity : Activity() {
  private val allowedVivaPackages = setOf(
    "com.vivawallet.spoc.payapp",
    "com.vivawallet.spoc.payapp.demo",
  )

  override fun onCreate(savedInstanceState: Bundle?) {
    setTheme(R.style.AppTheme)
    super.onCreate(savedInstanceState)
    handleIntent(intent)
  }

  override fun onNewIntent(newIntent: Intent) {
    super.onNewIntent(newIntent)
    intent = newIntent
    handleIntent(newIntent)
  }

  private fun handleIntent(sourceIntent: Intent?) {
    val incoming = sourceIntent?.data
    if (incoming == null) {
      showMessage("Bookie Viva Bridge", "Most je pripravljen.")
      return
    }

    try {
      require(incoming.scheme == "bookie-viva-bridge")
      val host = incoming.host
      require(host == "pay" || host == "result")
      val encodedState = incoming.pathSegments.firstOrNull()
        ?: throw IllegalArgumentException("Manjka kontekst plačila.")
      val state = decodeState(encodedState)

      if (host == "pay") {
        openViva(incoming, encodedState)
      } else {
        returnToBookie(incoming, state)
      }
    } catch (error: Exception) {
      showMessage(
        "Povezava ni uspela",
        error.message ?: "Bookie Viva zahtevka ni bilo mogoče obdelati.",
      )
    }
  }

  private fun decodeState(encodedState: String): BridgeState {
    val padding = "=".repeat((4 - encodedState.length % 4) % 4)
    val decoded = Base64.decode(
      encodedState + padding,
      Base64.URL_SAFE or Base64.NO_WRAP,
    ).toString(Charsets.UTF_8)
    val json = JSONObject(decoded)
    require(json.optInt("v") == 1)
    val returnUrl = json.getString("returnUrl")
    val clientTransactionId = json.getString("clientTransactionId")
    require(clientTransactionId.isNotBlank())
    require(isAllowedReturnUrl(returnUrl))
    return BridgeState(returnUrl, clientTransactionId)
  }

  private fun isAllowedReturnUrl(value: String): Boolean {
    val url = Uri.parse(value)
    if (url.scheme != "https" || !url.path.orEmpty().endsWith("/pos/blagajna")) return false
    val hostname = url.host.orEmpty().lowercase()
    return hostname == "bookie-erp.replit.app"
      || hostname.endsWith(".replit.app")
      || hostname.endsWith(".replit.dev")
  }

  private fun openViva(incoming: Uri, encodedState: String) {
    val target = incoming.getQueryParameter("target")
      ?: throw IllegalArgumentException("Manjka Viva zahtevek.")
    val vivaIntent = Intent.parseUri(target, Intent.URI_INTENT_SCHEME)
    val vivaUrl = vivaIntent.data
      ?: throw IllegalArgumentException("Viva zahtevek nima naslova.")
    require(vivaUrl.scheme == "vivapayclient")
    require(vivaUrl.host == "pay" && vivaUrl.path == "/v1")
    require(vivaIntent.`package` in allowedVivaPackages)
    require(
      vivaUrl.getQueryParameter("callback")
        == "bookie-viva-bridge://result/$encodedState",
    )

    // Ostani živ pod Viva Terminalom, da lahko ista singleTask aktivnost
    // prejme custom-URI callback. Zapri se šele po predaji rezultata POS-u.
    vivaIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS)
    startActivity(vivaIntent)
  }

  private fun returnToBookie(incoming: Uri, state: BridgeState) {
    val callbackClientId = incoming.getQueryParameter("clientTransactionId").orEmpty()
    require(callbackClientId.isNotBlank() && callbackClientId == state.clientTransactionId)

    val status = incoming.getQueryParameter("status").orEmpty()
    val transactionId = incoming.getQueryParameter("transactionId").orEmpty()
    val returnUrl = Uri.parse(state.returnUrl).buildUpon()
      .appendQueryParameter("vivaTapToPay", "1")
      .appendQueryParameter("clientTransactionId", callbackClientId)

    if (status == "success" && transactionId.isNotBlank()) {
      returnUrl
        .appendQueryParameter("status", "success")
        .appendQueryParameter("transactionId", transactionId)
    } else {
      returnUrl.appendQueryParameter("status", status.ifBlank { "unknown" })
      incoming.getQueryParameter("errorCode")?.let {
        returnUrl.appendQueryParameter("errorCode", it)
      }
      incoming.getQueryParameter("message")?.let {
        returnUrl.appendQueryParameter("message", it)
      }
    }

    val returnIntent = Intent(Intent.ACTION_VIEW, returnUrl.build()).apply {
      // Prepreči nov brskalniški task; nameščeni POS PWA nato callback prek
      // launch_handler=navigate-existing odpre v obstoječem oknu.
      addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK or
          Intent.FLAG_ACTIVITY_CLEAR_TOP or
          Intent.FLAG_ACTIVITY_SINGLE_TOP,
      )
    }
    startActivity(returnIntent)
    finishAndRemoveTask()
  }

  private fun showMessage(title: String, message: String) {
    val density = resources.displayMetrics.density
    val padding = (24 * density).toInt()
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setPadding(padding, padding, padding, padding)
      setBackgroundColor(Color.WHITE)
    }
    root.addView(TextView(this).apply {
      text = title
      textSize = 24f
      setTextColor(Color.rgb(20, 24, 32))
      gravity = Gravity.CENTER
    })
    root.addView(TextView(this).apply {
      text = message
      textSize = 16f
      setTextColor(Color.rgb(82, 90, 105))
      gravity = Gravity.CENTER
      setPadding(0, (16 * density).toInt(), 0, 0)
    })
    setContentView(root)
  }

  private data class BridgeState(
    val returnUrl: String,
    val clientTransactionId: String,
  )
}