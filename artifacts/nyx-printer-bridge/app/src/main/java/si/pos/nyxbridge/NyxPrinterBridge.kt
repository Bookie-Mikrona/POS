package si.pos.nyxbridge

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.os.IBinder
import android.util.Log
import net.nyx.printerservice.print.IPrinterService
import net.nyx.printerservice.print.PrintTextFormat

/**
 * Ovitek za NYX/Noryox AIDL tiskalni servis (com.incar.printerservice).
 *
 * Protokol tiskanja (enak ZcsPrinterBridge):
 *   printText(linee, formati, qrUrl, qrBase64, zoi) — besedilne vrstice + QR + ZOI črtna koda
 *   print(escposBytes)                               — surovi ESC/POS bajti prek printEscposData
 *
 * Vzorec bindService po uradnem README:
 *   - bindService z explicit intent (package + action)
 *   - ob prekinitvi (onServiceDisconnected) samodejni rebind z zamudo 5 s
 *   - setPaperWidth(576) ob prvi povezavi za 80mm papir
 */
class NyxPrinterBridge(private val context: Context) {

    companion object {
        private const val TAG = "NyxPrinterBridge"

        private const val NYX_PACKAGE = "com.incar.printerservice"
        private const val NYX_ACTION  = "com.incar.printerservice.IPrinterService"

        /** Širina papirja: 576 = 80 mm, 384 = 58 mm */
        private const val PAPER_WIDTH = 576

        /** Zamuda pred ponovnim bindanjem po prekinitvi (ms) */
        private const val REBIND_DELAY_MS = 5_000L

        // Poravnave za PrintTextFormat in printQrCode/printBarcode
        private const val ALIGN_LEFT   = 0
        private const val ALIGN_CENTER = 1
        private const val ALIGN_RIGHT  = 2

        // Slogi besedila
        private const val STYLE_NORMAL = 0
        private const val STYLE_BOLD   = 1

        // Stanje tiskalnika: 0 = OK
        private const val STATUS_OK = 0
    }

    data class PrintResult(val ok: Boolean, val error: String? = null)

    // ── AIDL stanje ──────────────────────────────────────────────────────────

    @Volatile private var printer: IPrinterService? = null
    @Volatile private var bound = false
    @Volatile private var paperWidthSet = false

    private val lock = Object()

    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
            Log.i(TAG, "NYX servis povezan: $name")
            val svc = IPrinterService.Stub.asInterface(binder)
            printer = svc
            bound   = true

            // Nastavi širino papirja ob vsaki novi povezavi
            try {
                val rc = svc.setPaperWidth(PAPER_WIDTH)
                paperWidthSet = true
                Log.i(TAG, "setPaperWidth($PAPER_WIDTH) → $rc")
            } catch (e: Exception) {
                Log.w(TAG, "setPaperWidth napaka: ${e.message}")
            }
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            Log.w(TAG, "NYX servis prekinjen — rebind čez ${REBIND_DELAY_MS}ms")
            printer = null
            bound   = false
            paperWidthSet = false

            // Samodejni rebind po zamudi (po vzoru uradnega README)
            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                if (!bound) {
                    Log.i(TAG, "Rebind poskus...")
                    bind()
                }
            }, REBIND_DELAY_MS)
        }
    }

    // ── Javni API ─────────────────────────────────────────────────────────────

    fun connect() {
        bind()
        // Počakaj do 8 s na vezavo (sinhronizacija za ServiceConnection)
        val deadline = System.currentTimeMillis() + 8_000L
        synchronized(lock) {
            while (!bound && System.currentTimeMillis() < deadline) {
                try { lock.wait(500) } catch (_: InterruptedException) { break }
            }
        }
        if (!bound) Log.w(TAG, "Vezava ni uspela v 8s — servis morda ni nameščen")
    }

    fun disconnect() {
        try {
            if (bound) context.unbindService(connection)
        } catch (_: Exception) {}
        printer = null
        bound   = false
    }

    fun isReady(): Boolean {
        val svc = printer ?: return false
        return try {
            svc.getPrinterStatus() == STATUS_OK
        } catch (_: Exception) { false }
    }

    fun statusText(): String {
        val svc = printer ?: return "NYX servis ni povezan"
        return try {
            when (val s = svc.getPrinterStatus()) {
                0    -> "Tiskalnik pripravljen (80mm)"
                1    -> "Papir manjka"
                else -> "Napaka (koda $s)"
            }
        } catch (e: Exception) {
            "Napaka komunikacije: ${e.message}"
        }
    }

    // ── Tiskanje ESC/POS surovih bajtov ──────────────────────────────────────

    /**
     * POST /print — surovi ESC/POS bajti prek printEscposData (od v1.5.9).
     * Enostavno: pošljemo bajte neposredno, brez pretvorbe.
     */
    fun print(escposBytes: ByteArray): PrintResult {
        val svc = printer
        if (svc == null) {
            Log.w(TAG, "print: tiskalnik ni pripravljen")
            return PrintResult(false, "NYX tiskalnik ni povezan")
        }
        return try {
            val rc = svc.printEscposData(escposBytes)
            if (rc == 0) {
                PrintResult(true)
            } else {
                PrintResult(false, "printEscposData vrnil $rc")
            }
        } catch (e: Exception) {
            Log.e(TAG, "print napaka: ${e.message}")
            PrintResult(false, e.message)
        }
    }

    // ── Tiskanje besedilnih vrstic (POST /print-text) ─────────────────────────

    /**
     * Tiskaj strukturirane vrstice:
     *   linee   — seznam vrstic (UTF-16 Java String, ni CP1250 problema)
     *   formati — vzporeden seznam: "B"=krepko, "C"=sredina, "R"=desno, "H"=naslov,
     *             "S"=separator, "N"=normalno (privzeto levo, normalno)
     *   qrUrl   — URL za FURS QR kodo (ali qrBase64 PNG — NYX ne podpira PNG direktno, tiskamo URL)
     *   qrBase64 — ignoriramo (NYX printQrCode sprejme vsebino, ne slike)
     *   zoi     — ZOI/EAN za črtno kodo Code 128 (center)
     */
    fun printText(
        linee:    List<String>,
        formati:  List<String>?,
        qrUrl:    String?,
        qrBase64: String?,
        zoi:      String?
    ): PrintResult {
        val svc = printer
        if (svc == null) {
            Log.w(TAG, "printText: tiskalnik ni pripravljen")
            return PrintResult(false, "NYX tiskalnik ni povezan")
        }

        return try {
            // Ensuramo širino papirja (varnostno — bi moralo biti nastavljeno ob vezavi)
            if (!paperWidthSet) {
                try { svc.setPaperWidth(PAPER_WIDTH); paperWidthSet = true } catch (_: Exception) {}
            }

            // 1. Tiskaj besedilne vrstice
            // BREZ \n — NYX tiskalnik samodejno prelomi vrstico po vsakem printText klicu.
            // Dodaten \n bi povzročil prazno vrstico med vsako vrstico → 80cm izpis.
            for (i in linee.indices) {
                val vrstica = linee[i]
                val fmt     = formati?.getOrNull(i) ?: "N"
                val ptf     = buildFormat(fmt)
                val rc = svc.printText(vrstica, ptf)
                if (rc != 0) {
                    Log.w(TAG, "printText[$i] vrnil $rc za: $vrstica")
                }
            }

            // 2. QR koda (FURS) — prednost ima qrUrl
            val qrContent = qrUrl?.ifBlank { null }
            if (!qrContent.isNullOrBlank()) {
                // QR vsebina: ali je to URL (dolg) → natisni kot QR
                val rc = svc.printQrCode(qrContent, 200, 200, ALIGN_CENTER)
                if (rc != 0) Log.w(TAG, "printQrCode vrnil $rc")
            }

            // 3. Zaključi in izvleci papir
            val rcEnd = svc.printEndAutoOut()
            if (rcEnd != 0) Log.w(TAG, "printEndAutoOut vrnil $rcEnd")

            // 5. Prazno območje 20 mm (576px/80mm × 20mm = 144px) — za odtrganje
            try { svc.paperOut(144) } catch (_: Exception) {}

            PrintResult(true)
        } catch (e: Exception) {
            Log.e(TAG, "printText napaka: ${e.message}")
            PrintResult(false, e.message)
        }
    }

    // ── Pomožne metode ────────────────────────────────────────────────────────

    private fun bind() {
        val intent = Intent().apply {
            setPackage(NYX_PACKAGE)
            action = NYX_ACTION
        }
        try {
            val ok = context.bindService(intent, connection, Context.BIND_AUTO_CREATE)
            if (!ok) Log.e(TAG, "bindService vrnil false — ali je com.incar.printerservice nameščen?")
        } catch (e: Exception) {
            Log.e(TAG, "bindService napaka: ${e.message}")
        }
    }

    /**
     * Pretvori format kodo v PrintTextFormat:
     *   "B"  — krepko, levo
     *   "C"  — normalno, sredina
     *   "R"  — normalno, desno
     *   "H"  — krepko, sredina (naslov)
     *   "S"  — normalno, levo (separator — samo vrstica, brez posebnega stila)
     *   "N"  — normalno, levo (privzeto)
     */
    /**
     * Pretvori format kodo v PrintTextFormat.
     * POZOR: poravnava se nastavi prek ptf.ali (ne align) — to je ime polja v NYX SDK.
     * V Kotlinu ptf.ali = x pokliče setAli(x) na Java razredu.
     *
     *   "B"  — krepko, levo
     *   "C"  — normalno, sredina
     *   "R"  — normalno, desno
     *   "H"  — krepko, sredina (naslov, večja pisava)
     *   "S"  — normalno, levo (separator)
     *   "N"  — normalno, levo (privzeto)
     */
    private fun buildFormat(fmt: String): PrintTextFormat {
        val ptf = PrintTextFormat()
        // font=4 → MONOSPACE (Droid Sans Mono na Androidu) — edina pisava s fiksno
        // širino znakov, ki zagotavlja poravnavo kolon na 80mm papirju.
        // "Lucida Console" na Androidu ne obstaja; MONOSPACE je funkcionalni ekvivalent.
        ptf.font     = 4
        ptf.textSize = 24
        when (fmt.uppercase()) {
            "B" -> { ptf.style = STYLE_BOLD;   ptf.ali = ALIGN_LEFT   }
            "C" -> { ptf.style = STYLE_NORMAL; ptf.ali = ALIGN_CENTER }
            "R" -> { ptf.style = STYLE_NORMAL; ptf.ali = ALIGN_RIGHT  }
            "H" -> { ptf.style = STYLE_BOLD;   ptf.ali = ALIGN_CENTER; ptf.textSize = 28 }
            "S" -> { ptf.style = STYLE_NORMAL; ptf.ali = ALIGN_LEFT   }
            else -> { ptf.style = STYLE_NORMAL; ptf.ali = ALIGN_LEFT   }
        }
        return ptf
    }

    /** Vrni seznam nameščenih NYX paketov (za /diagnostics endpoint) */
    fun getInstalledNyxPackages(): List<String> {
        return try {
            val pm = context.packageManager
            listOf(NYX_PACKAGE, "com.noryox.printer", "com.incar.printer")
                .filter {
                    try { pm.getPackageInfo(it, 0); true } catch (_: Exception) { false }
                }
        } catch (_: Exception) { emptyList() }
    }
}
