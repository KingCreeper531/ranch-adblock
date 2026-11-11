package io.github.kingcreeper531.ranchadblock;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URL;
import java.net.UnknownHostException;
import java.util.Scanner;

/**
 * Ranch Ad Blocker for Android: turns on Android's own Private DNS with an
 * ad-blocking DNS service. No VPN, nothing running in the background.
 *
 * Android only lets an app change Private DNS when it has WRITE_SECURE_SETTINGS,
 * which you grant once over USB (adb). Without it, the app walks you through
 * the Private DNS setting instead.
 */
public class MainActivity extends Activity {
    static final String ORIGIN = "https://appassets.androidplatform.net";
    static final String HOME = ORIGIN + "/assets/ui/index.html";
    static final String REPO = "KingCreeper531/ranch-adblock";

    static final String[][] PROVIDERS = {
            // id, name, hostname, note
            {"adguard", "AdGuard DNS", "dns.adguard-dns.com", "Largest ad and tracker list."},
            {"mullvad", "Mullvad DNS", "adblock.dns.mullvad.net", "Keeps no logs. Smaller list."},
    };

    private WebView web;
    private SharedPreferences prefs;
    private volatile JSONObject update; // newer release, if any

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true);
        prefs = getSharedPreferences("adblock", MODE_PRIVATE);

        web = new WebView(this);
        web.setBackgroundColor(0xFF0B100C);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);

        // ES module scripts don't load from file://, so serve the screen from a fake https origin
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        web.addJavascriptInterface(new Native(), "BlockerNative");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (ORIGIN.equals(url.getScheme() + "://" + url.getHost())) return false;
                openUrl(url.toString());
                return true;
            }
        });
        web.loadUrl(HOME);
        new Thread(this::checkForUpdate).start();
    }

    // ------------------------------------------------------------ Private DNS

    boolean canSwitch() {
        return checkSelfPermission(Manifest.permission.WRITE_SECURE_SETTINGS) == PackageManager.PERMISSION_GRANTED;
    }

    String providerId() {
        return prefs.getString("provider", "adguard");
    }

    String[] provider(String id) {
        for (String[] p : PROVIDERS) if (p[0].equals(id)) return p;
        return PROVIDERS[0];
    }

    /** The Private DNS hostname the phone is set to use (strict mode), or null. */
    String activeHost() {
        // What the phone is actually using right now
        try {
            ConnectivityManager cm = getSystemService(ConnectivityManager.class);
            Network n = cm.getActiveNetwork();
            LinkProperties lp = n == null ? null : cm.getLinkProperties(n);
            if (lp != null && lp.getPrivateDnsServerName() != null) return lp.getPrivateDnsServerName();
        } catch (Exception ignored) { }
        // Offline, or not connected yet: fall back to the setting itself
        try {
            String mode = Settings.Global.getString(getContentResolver(), "private_dns_mode");
            if ("hostname".equals(mode)) return Settings.Global.getString(getContentResolver(), "private_dns_specifier");
        } catch (Exception ignored) { }
        return null;
    }

    String providerForHost(String host) {
        if (host == null) return null;
        for (String[] p : PROVIDERS) if (p[2].equalsIgnoreCase(host.trim())) return p[0];
        return null;
    }

    JSONObject state() throws Exception {
        String host = activeHost();
        String activeId = providerForHost(host);
        boolean on = activeId != null;
        JSONObject o = new JSONObject();
        o.put("platform", "android");
        o.put("on", on);
        o.put("provider", on ? activeId : providerId());
        JSONArray list = new JSONArray();
        for (String[] p : PROVIDERS) {
            list.put(new JSONObject().put("id", p[0]).put("name", p[1]).put("host", p[2]).put("note", p[3]));
        }
        o.put("providers", list);
        if (on) o.put("activeName", provider(activeId)[1]);
        boolean can = canSwitch();
        o.put("canSwitch", can);
        o.put("needsSetup", !can);
        o.put("adbCommand", "adb shell pm grant " + getPackageName() + " android.permission.WRITE_SECURE_SETTINGS");
        if (!on && host != null && !host.isEmpty()) {
            o.put("detail", "Private DNS is set to " + host + ", which isn't one of the ad-blocking services here.");
        }
        o.put("version", BuildConfig.VERSION_NAME);
        if (update != null) o.put("update", update);
        return o;
    }

    JSONObject setOn(boolean on, String id) throws Exception {
        if (!canSwitch()) return new JSONObject().put("error", "Use the one-time setup below first.");
        android.content.ContentResolver cr = getContentResolver();
        if (on) {
            // Remember what was there before, so "off" can put it back
            if (providerForHost(activeHost()) == null) {
                prefs.edit()
                        .putString("prevMode", Settings.Global.getString(cr, "private_dns_mode"))
                        .putString("prevHost", Settings.Global.getString(cr, "private_dns_specifier"))
                        .apply();
            }
            String[] p = provider(id == null || id.isEmpty() ? providerId() : id);
            prefs.edit().putString("provider", p[0]).apply();
            Settings.Global.putString(cr, "private_dns_specifier", p[2]);
            Settings.Global.putString(cr, "private_dns_mode", "hostname");
        } else {
            String prevMode = prefs.getString("prevMode", null);
            String prevHost = prefs.getString("prevHost", null);
            if ("hostname".equals(prevMode) && prevHost != null && providerForHost(prevHost) == null) {
                Settings.Global.putString(cr, "private_dns_specifier", prevHost);
                Settings.Global.putString(cr, "private_dns_mode", "hostname");
            } else {
                Settings.Global.putString(cr, "private_dns_mode", "opportunistic"); // Android's default ("Automatic")
            }
        }
        // The network picks the change up within a moment
        for (int i = 0; i < 12; i++) {
            if ((providerForHost(activeHost()) != null) == on) break;
            Thread.sleep(250);
        }
        return state();
    }

    JSONObject setProvider(String id) throws Exception {
        String[] p = provider(id);
        prefs.edit().putString("provider", p[0]).apply();
        // Already on with the other service: switch right away
        if (canSwitch() && providerForHost(activeHost()) != null) return setOn(true, p[0]);
        return state();
    }

    JSONObject test() throws Exception {
        try {
            InetAddress[] all = InetAddress.getAllByName("doubleclick.net");
            for (InetAddress a : all) {
                if (a.isAnyLocalAddress() || a.isLoopbackAddress()) return new JSONObject().put("blocked", true);
            }
            return new JSONObject().put("blocked", false);
        } catch (UnknownHostException e) {
            // No answer for an ad server: blocked (as long as normal sites still resolve)
            try {
                InetAddress.getByName("www.google.com");
                return new JSONObject().put("blocked", true);
            } catch (UnknownHostException e2) {
                return new JSONObject().put("blocked", false).put("detail", "Couldn't look anything up. Are you online?");
            }
        }
    }

    void openPrivateDnsSettings() {
        // There's no public shortcut to the Private DNS screen; try the network settings pages
        String[] actions = {"android.settings.WIRELESS_SETTINGS", Settings.ACTION_WIRELESS_SETTINGS, Settings.ACTION_SETTINGS};
        for (String a : actions) {
            try {
                startActivity(new Intent(a).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                return;
            } catch (Exception ignored) { }
        }
    }

    void openUrl(String url) {
        if (!url.startsWith("https://")) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (Exception ignored) { }
    }

    // ------------------------------------------------------------ updates

    void checkForUpdate() {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL("https://api.github.com/repos/" + REPO + "/releases/latest").openConnection();
            c.setRequestProperty("Accept", "application/vnd.github+json");
            c.setRequestProperty("User-Agent", "RanchAdBlocker");
            c.setConnectTimeout(10000);
            c.setReadTimeout(10000);
            if (c.getResponseCode() != 200) return;
            String body;
            try (InputStream in = c.getInputStream(); Scanner sc = new Scanner(in, "UTF-8").useDelimiter("\\A")) {
                body = sc.hasNext() ? sc.next() : "";
            }
            JSONObject rel = new JSONObject(body);
            String latest = rel.optString("tag_name", "").replaceFirst("^v", "");
            if (!isNewer(latest, BuildConfig.VERSION_NAME)) return;
            String url = rel.optString("html_url");
            JSONArray assets = rel.optJSONArray("assets");
            if (assets != null) {
                for (int i = 0; i < assets.length(); i++) {
                    JSONObject a = assets.getJSONObject(i);
                    if (a.optString("name").matches("Ranch-AdBlock-Android-[0-9.]+\\.apk")) url = a.optString("browser_download_url", url);
                }
            }
            update = new JSONObject().put("version", latest).put("label", "Update to " + latest).put("url", url);
        } catch (Exception ignored) { }
    }

    static boolean isNewer(String a, String b) {
        String[] x = a.split("\\."), y = b.split("\\.");
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            int p = i < x.length ? parse(x[i]) : 0, q = i < y.length ? parse(y[i]) : 0;
            if (p != q) return p > q;
        }
        return false;
    }

    static int parse(String s) {
        try { return Integer.parseInt(s.replaceAll("\\D.*", "")); } catch (Exception e) { return 0; }
    }

    // ------------------------------------------------------------ bridge for the screen

    class Native {
        private String json(Callable c) {
            try { return c.call().toString(); } catch (Exception e) {
                try { return new JSONObject().put("error", String.valueOf(e.getMessage())).toString(); } catch (Exception ignored) { return "{}"; }
            }
        }

        @JavascriptInterface public String state() { return json(MainActivity.this::state); }
        @JavascriptInterface public String setOn(String on, String provider) { return json(() -> MainActivity.this.setOn("1".equals(on), provider)); }
        @JavascriptInterface public String setProvider(String id) { return json(() -> MainActivity.this.setProvider(id)); }
        @JavascriptInterface public String test() { return json(MainActivity.this::test); }

        @JavascriptInterface public String openPrivateDns() {
            runOnUiThread(MainActivity.this::openPrivateDnsSettings);
            return "null";
        }

        @JavascriptInterface public String copy(String text) {
            runOnUiThread(() -> {
                ClipboardManager cb = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                cb.setPrimaryClip(ClipData.newPlainText("Ad Blocker", text));
            });
            return "null";
        }

        @JavascriptInterface public String open(String url) {
            runOnUiThread(() -> openUrl(url));
            return "null";
        }

        @JavascriptInterface public String update() {
            JSONObject u = update;
            if (u != null) runOnUiThread(() -> openUrl(u.optString("url")));
            return json(MainActivity.this::state);
        }
    }

    interface Callable { Object call() throws Exception; }
}
