package si.pos.nb80printer;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

import fi.iki.elonen.NanoHTTPD;

/**
 * Lokalni HTTP strežnik na portu 8091.
 * Browser (POS spletna aplikacija) pošlje JSON na /print-text;
 * strežnik posreduje podatke PrinterBridge, ki kliče NB80 PrinterService.
 *
 * Encoding: NanoHTTPD bere HTTP telo kot UTF-8 (privzeto).
 * NB80 PrinterService sprejema UTF-8 Java String nativno — brez iconv/CP1250.
 *
 * Podprti endpointi:
 *   GET  /status       — stanje mosta (JSON {ok, status})
 *   GET  /diagnostics  — diagnostika (JSON {binderReady, serviceVersion, printerStatus, printerModel})
 *   POST /print-text   — tiskanje računa (JSON {linee[], formati[], qrUrl, zoi})
 */
public class BridgeHttpServer extends NanoHTTPD {

    private static final String TAG  = "NB80Bridge";
    private static final int    PORT = 8091;

    private final PrinterBridge mBridge;

    public BridgeHttpServer(Context ctx) throws IOException {
        super(PORT);
        mBridge = PrinterBridge.getInstance(ctx);
        start(NanoHTTPD.SOCKET_READ_TIMEOUT, false);
        Log.i(TAG, "HTTP most zagnan na portu " + PORT);
    }

    @Override
    public Response serve(IHTTPSession session) {
        // CORS — browser (Chrome Android) pošlje preflight
        Map<String, String> corsHeaders = new HashMap<>();
        corsHeaders.put("Access-Control-Allow-Origin", "*");
        corsHeaders.put("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        corsHeaders.put("Access-Control-Allow-Headers",
                "Content-Type, X-Requested-With, Access-Control-Request-Private-Network");
        // Chrome lahko zahteva Private Network Access dovoljenje pri klicu
        // iz HTTPS POS strani na lokalni HTTP most.
        corsHeaders.put("Access-Control-Allow-Private-Network", "true");

        if (session.getMethod() == Method.OPTIONS) {
            Response r = newFixedLengthResponse(Response.Status.OK, "text/plain", "");
            for (Map.Entry<String, String> e : corsHeaders.entrySet())
                r.addHeader(e.getKey(), e.getValue());
            return r;
        }

        String uri = session.getUri();
        Response resp;

        try {
            if (uri.equals("/status")) {
                resp = handleStatus();
            } else if (uri.equals("/diagnostics")) {
                resp = handleDiagnostics();
            } else if (uri.equals("/print-text") && session.getMethod() == Method.POST) {
                resp = handlePrintText(session);
            } else {
                resp = newFixedLengthResponse(Response.Status.NOT_FOUND, "application/json",
                        "{\"error\":\"Endpoint ne obstaja\"}");
            }
        } catch (Exception ex) {
            Log.e(TAG, "Nepričakovana napaka", ex);
            resp = newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "application/json",
                    "{\"error\":\"" + escapeJson(ex.getMessage()) + "\"}");
        }

        for (Map.Entry<String, String> e : corsHeaders.entrySet())
            resp.addHeader(e.getKey(), e.getValue());
        return resp;
    }

    // ── GET /status ───────────────────────────────────────────────────────────

    private Response handleStatus() {
        boolean ready = mBridge.isReady();
        String json = ready
                ? "{\"ok\":true,\"status\":\"NB80 PrinterService je inicializiran in pripravljen\"}"
                : "{\"ok\":false,\"status\":\"Čakam na PrinterService (AIDL Binder)\"}";
        return newFixedLengthResponse(
                ready ? Response.Status.OK : Response.Status.SERVICE_UNAVAILABLE,
                "application/json",
                json);
    }

    // ── GET /diagnostics ──────────────────────────────────────────────────────

    private Response handleDiagnostics() {
        PrinterBridge.Diagnostics d = mBridge.getDiagnostics();
        String json = String.format(
                "{\"binderReady\":%b,\"serviceVersion\":%s,\"printerStatus\":%d,\"printerModel\":%s}",
                d.binderReady,
                d.serviceVersion != null ? "\"" + escapeJson(d.serviceVersion) + "\"" : "null",
                d.printerStatus,
                d.printerModel   != null ? "\"" + escapeJson(d.printerModel)   + "\"" : "null"
        );
        return newFixedLengthResponse(Response.Status.OK, "application/json", json);
    }

    // ── POST /print-text ──────────────────────────────────────────────────────

    private Response handlePrintText(IHTTPSession session) {
        try {
            // Preberi telo zahtevka
            Map<String, String> files = new HashMap<>();
            session.parseBody(files);
            String body = files.get("postData");
            if (body == null || body.isEmpty()) {
                return jsonError(Response.Status.BAD_REQUEST, "Prazno telo zahtevka");
            }

            JSONObject obj = new JSONObject(body);

            // linee[]
            JSONArray lineArr = obj.optJSONArray("linee");
            if (lineArr == null) return jsonError(Response.Status.BAD_REQUEST, "Manjka polje 'linee'");
            String[] linee = new String[lineArr.length()];
            for (int i = 0; i < lineArr.length(); i++) linee[i] = lineArr.getString(i);

            // formati[] — opcijsko
            JSONArray fmtArr = obj.optJSONArray("formati");
            String[] formati = null;
            if (fmtArr != null) {
                formati = new String[fmtArr.length()];
                for (int i = 0; i < fmtArr.length(); i++) formati[i] = fmtArr.getString(i);
            }

            String qrUrl = obj.optString("qrUrl", null);
            if ("null".equals(qrUrl)) qrUrl = null;

            String zoi = obj.optString("zoi", null);
            if ("null".equals(zoi)) zoi = null;

            mBridge.printReceipt(linee, formati, qrUrl, zoi);

            return newFixedLengthResponse(Response.Status.OK, "application/json", "{\"ok\":true}");

        } catch (android.os.RemoteException re) {
            Log.e(TAG, "PrinterService RemoteException", re);
            return jsonError(Response.Status.INTERNAL_ERROR,
                    "PrinterService napaka: " + re.getMessage());
        } catch (Exception ex) {
            Log.e(TAG, "handlePrintText napaka", ex);
            return jsonError(Response.Status.INTERNAL_ERROR, ex.getMessage());
        }
    }

    // ── Pomožne metode ────────────────────────────────────────────────────────

    private Response jsonError(Response.Status status, String msg) {
        return newFixedLengthResponse(status, "application/json",
                "{\"error\":\"" + escapeJson(msg) + "\"}");
    }

    private static String escapeJson(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\n", "\\n").replace("\r", "\\r");
    }
}
