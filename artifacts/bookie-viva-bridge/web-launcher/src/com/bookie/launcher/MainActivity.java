package com.bookie.launcher;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** Odpre spletno aplikacijo Bookie na celem zaslonu. Naslov je v AndroidManifest (meta-data START_URL). */
public class MainActivity extends Activity {
  private WebView web;
  private String startUrl;

  @Override
  protected void onCreate(Bundle state) {
    super.onCreate(state);
    try {
      startUrl = getPackageManager().getActivityInfo(getComponentName(), android.content.pm.PackageManager.GET_META_DATA)
          .metaData.getString("START_URL");
    } catch (Exception e) {
      throw new IllegalStateException("Manjka START_URL", e);
    }
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    web = new WebView(this);
    setContentView(web);
    hideSystemBars();

    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setDatabaseEnabled(true);
    s.setMediaPlaybackRequiresUserGesture(false);
    s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    CookieManager cookies = CookieManager.getInstance();
    cookies.setAcceptCookie(true);
    cookies.setAcceptThirdPartyCookies(web, true);

    web.setWebChromeClient(new WebChromeClient());
    web.setWebViewClient(new WebViewClient() {
      @Override
      public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        Uri uri = request.getUrl();
        String scheme = uri.getScheme();
        if ("http".equals(scheme) || "https".equals(scheme)) return false;
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) { }
        return true;
      }

      @Override
      public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (request.isForMainFrame()) {
          view.loadData("<html><body style='font-family:sans-serif;padding:24px'><h2>Ni povezave</h2>"
              + "<p>Preverite internet in poskusite znova.</p>"
              + "<button style='font-size:20px;padding:12px 24px' onclick='location.href=\"" + startUrl + "\"'>Poskusi znova</button>"
              + "</body></html>", "text/html", "UTF-8");
        }
      }
    });

    if (state != null) web.restoreState(state); else web.loadUrl(startUrl);
  }

  @Override
  protected void onSaveInstanceState(Bundle out) {
    super.onSaveInstanceState(out);
    web.saveState(out);
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) hideSystemBars();
  }

  private void hideSystemBars() {
    getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_FULLSCREEN
        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
  }

  @Override
  public void onBackPressed() {
    if (web.canGoBack()) web.goBack(); // zadnja stran: ostane odprto, aplikacija se ne zapre po naključju
  }

  @Override
  protected void onPause() { super.onPause(); CookieManager.getInstance().flush(); }
}
