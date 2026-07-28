package si.pos.zcsbridge

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.text.Layout
import android.util.Base64
import android.util.Log
import com.zcs.sdk.DriverManager
import com.zcs.sdk.SdkResult
import com.zcs.sdk.print.PrnStrFormat
import com.zcs.sdk.print.PrnTextFont
import com.zcs.sdk.print.PrnTextStyle

/**
 * Posrednik med HTTP strežnikom in ZCS vgrajenim tiskalnikom.
 *
 * ZCS SDK zahteva sistemsko knjižnico libSmartPosJni.so ki je del ZCS ROM-a.
 * Knjižnico poskusimo naložiti iz znanih sistemskih poti.
 *
 * Tiskanje: ESC/POS bajti → razčlenjen tekst → ZCS SDK setPrintAppendString → setPrintStart
 */
class ZcsPrinterBridge(private val context: Context) {

    companion object {
        private const val TAG = "ZcsPrinterBridge"
        private const val PRINT_TEXT_SIZE = 24

        // Znane poti za libSmartPosJni.so na ZCS napravah
        private val SMARTPOS_LIB_PATHS = listOf(
            "/system/lib64/libSmartPosJni.so",
            "/system/lib/libSmartPosJni.so",
            "/vendor/lib64/libSmartPosJni.so",
            "/vendor/lib/libSmartPosJni.so",
            "/system/app/SmartPosSDK/lib/arm64/libSmartPosJni.so",
            "/system/app/SmartPosSDK/lib/arm/libSmartPosJni.so",
        )
    }

    private var sdkAvailable = false
    private var driverManager: DriverManager? = null

    fun connect() {
        // 1. Najprej poiščemo in naložimo sistemsko knjižnico
        sdkAvailable = tryLoadNativeLib()

        if (!sdkAvailable) {
            Log.e(TAG, "libSmartPosJni.so ni najdena — tiskanje ne bo delovalo")
            return
        }

        // 2. Inicializiramo DriverManager
        try {
            driverManager = DriverManager.getInstance()
            val status = driverManager?.printer?.printerStatus
            Log.i(TAG, "ZCS SDK inicializiran, status tiskalnika: $status")
            sdkAvailable = true
        } catch (e: Exception) {
            Log.e(TAG, "ZCS DriverManager napaka: ${e.message}", e)
            sdkAvailable = false
        }
    }

    private fun tryLoadNativeLib(): Boolean {
        // Najprej poskus z System.loadLibrary (Android naj bi sam našel)
        try {
            System.loadLibrary("SmartPosJni")
            Log.i(TAG, "libSmartPosJni naložena via loadLibrary")
            return true
        } catch (e: UnsatisfiedLinkError) {
            Log.w(TAG, "loadLibrary('SmartPosJni') ni uspelo: ${e.message}")
        }

        // Poskusimo z absolutnimi potmi
        for (path in SMARTPOS_LIB_PATHS) {
            try {
                System.load(path)
                Log.i(TAG, "libSmartPosJni naložena iz: $path")
                return true
            } catch (e: UnsatisfiedLinkError) {
                // ni na tej poti, nadaljujemo
            }
        }

        // Zapiši vse datoteke v /system/lib64 za diagnostiko
        try {
            val files = java.io.File("/system/lib64").listFiles()
                ?.filter { it.name.contains("zcs", ignoreCase = true) || it.name.contains("smart", ignoreCase = true) }
                ?.joinToString { it.name } ?: "nič"
            Log.w(TAG, "ZCS knjižnice v /system/lib64: $files")
        } catch (_: Exception) {}

        return false
    }

    fun disconnect() {
        // DriverManager ne zahteva eksplicitnega odklopa
    }

    /**
     * Natisni ESC/POS bajte prek ZCS SDK.
     */
    fun print(data: ByteArray): PrintResult {
        if (!sdkAvailable || driverManager == null) {
            return PrintResult.error("ZCS SDK ni na voljo (libSmartPosJni.so ni najdena)")
        }

        return try {
            val printer = driverManager!!.printer
                ?: return PrintResult.error("ZCS Printer ni na voljo")

            val status = printer.printerStatus
            if (status == SdkResult.SDK_PRN_STATUS_PAPEROUT) {
                return PrintResult.error("Papir zmanjka")
            }

            val lines = stripEscPos(data)
            if (lines.isEmpty()) {
                return PrintResult.error("Ni vsebine za tiskanje")
            }

            val format = PrnStrFormat().apply {
                setTextSize(PRINT_TEXT_SIZE)
                setFont(PrnTextFont.MONOSPACE)
                setAli(Layout.Alignment.ALIGN_NORMAL)
            }

            for (line in lines) {
                printer.setPrintAppendString(line, format)
            }

            repeat(3) { printer.setPrintAppendString(" ", format) }

            val result = printer.setPrintStart()
            if (result == SdkResult.SDK_OK || result == 0) {
                Log.i(TAG, "Natisnjeno ${lines.size} vrstic via ZCS SDK")
                PrintResult.ok()
            } else {
                PrintResult.error("ZCS tisk napaka (koda $result)")
            }
        } catch (e: Exception) {
            Log.e(TAG, "ZCS print napaka: ${e.message}", e)
            PrintResult.error("Napaka: ${e.message}")
        }
    }

    /**
     * Natisni besedilne vrstice (UTF-8 Java String) in QR kodo (bitmap) prek ZCS SDK.
     *
     * setPrintBitmap() se izvede TAKOJ (ni v vrsti) — zato najprej natisnemo besedilo
     * s setPrintStart(), šele nato pokličemo setPrintBitmap().
     *
     * SDK pričakuje surove ARGB pikslne bajte (ne PNG format).
     * PNG dekodiramo v Android Bitmap, skaliramo na 300×300 in izvlečemo ARGB bajte.
     *
     * @param qrBase64  base64 PNG QR kode; če null → izpiše qrUrl kot besedilo
     * @param qrUrl     60-cifrna FURS vsebina (rezervno besedilo)
     */
    fun printText(lines: List<String>, formati: List<String>? = null, qrUrl: String?, qrBase64: String? = null): PrintResult {
        if (!sdkAvailable || driverManager == null) {
            return PrintResult.error("ZCS SDK ni na voljo (libSmartPosJni.so ni najdena)")
        }

        return try {
            val printer = driverManager!!.printer
                ?: return PrintResult.error("ZCS Printer ni na voljo")

            val status = printer.printerStatus
            if (status == SdkResult.SDK_PRN_STATUS_PAPEROUT) {
                return PrintResult.error("Papir zmanjka")
            }

            val format = PrnStrFormat().apply {
                setTextSize(PRINT_TEXT_SIZE)
                setFont(PrnTextFont.MONOSPACE)
                setAli(Layout.Alignment.ALIGN_NORMAL)
                setStyle(PrnTextStyle.NORMAL)
            }
            val boldFormat = PrnStrFormat().apply {
                setTextSize(PRINT_TEXT_SIZE)
                setFont(PrnTextFont.MONOSPACE)
                setAli(Layout.Alignment.ALIGN_NORMAL)
                setStyle(PrnTextStyle.BOLD)
            }

            // 1. korak: natisni besedilne vrstice
            // ZCS SDK ima interno mejo bufferja (~45 vrstic). Natisnemo v sklopih po 40.
            val BATCH_SIZE = 40
            var batchStart = 0
            var r1 = 0
            while (batchStart < lines.size) {
                val batchEnd = minOf(batchStart + BATCH_SIZE, lines.size)
                for (i in batchStart until batchEnd) {
                    val isBold = formati != null && i < formati.size && formati[i] == "B"
                    printer.setPrintAppendString(lines[i], if (isBold) boldFormat else format)
                }
                r1 = printer.setPrintStart()
                Log.i(TAG, "printText: sklop ${batchStart + 1}-$batchEnd natisnjeno (koda $r1)")
                batchStart = batchEnd
            }
            Log.i(TAG, "printText: besedilo natisnjeno (${lines.size} vrstic skupaj)")

            // 2. korak: natisni QR kodo (setPrintBitmap je takojšnje, ne čaka v vrsti)
            var qrOk = false
            if (!qrBase64.isNullOrBlank()) {
                try {
                    val pngBytes = Base64.decode(qrBase64, Base64.DEFAULT)
                    // Dekodiraj PNG → Android Bitmap
                    val bmp = BitmapFactory.decodeByteArray(pngBytes, 0, pngBytes.size)
                    if (bmp != null) {
                        // ZCS Z92 58mm papir: 384 tiskalnih točk na vrstico
                        // setPrintBitmap(ByteArray) pričakuje 1-bitne mono bajte:
                        //   1 bajt = 8 pik, MSB prvi, vsaka vrstica = printerWidth/8 bajtov
                        val printerDots = 384
                        val qrSize = 200  // px QR kode (centriran na 384)
                        val xOff = (printerDots - qrSize) / 2
                        val rowBytes = printerDots / 8  // 48 bajtov/vrstico
                        val scaled = Bitmap.createScaledBitmap(bmp, qrSize, qrSize, true)
                            .copy(Bitmap.Config.ARGB_8888, false)
                        val mono = ByteArray(rowBytes * qrSize)
                        for (y in 0 until qrSize) {
                            for (x in 0 until qrSize) {
                                val px = scaled.getPixel(x, y)
                                val r = (px shr 16) and 0xFF
                                val g = (px shr 8) and 0xFF
                                val b = px and 0xFF
                                val gray = (0.299 * r + 0.587 * g + 0.114 * b).toInt()
                                if (gray < 128) {  // temna točka → tiskaj
                                    val dotX = xOff + x
                                    val byteIdx = y * rowBytes + dotX / 8
                                    val bitIdx = 7 - (dotX % 8)  // MSB prvi
                                    mono[byteIdx] = (mono[byteIdx].toInt() or (1 shl bitIdx)).toByte()
                                }
                            }
                        }
                        printer.setPrintBitmap(mono)
                        Log.i(TAG, "printText: QR 1-bit mono ${qrSize}×${qrSize}, ${mono.size} B")
                        qrOk = true
                    } else {
                        Log.w(TAG, "printText: BitmapFactory vrnil null")
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "printText: QR bitmap napaka (${e.message})")
                }
            }

            // Rezervno: izpiši QR vsebino kot besedilo
            if (!qrOk && !qrUrl.isNullOrBlank()) {
                tiskajQrBesedilo(printer, qrUrl, format)
            }

            // 3. korak: odmakni papir po QR kodi
            repeat(4) { printer.setPrintAppendString(" ", format) }
            printer.setPrintStart()

            Log.i(TAG, "printText: zaključeno, qrBitmap=$qrOk")
            PrintResult.ok()
        } catch (e: Exception) {
            Log.e(TAG, "ZCS printText napaka: ${e.message}", e)
            PrintResult.error("Napaka: ${e.message}")
        }
    }

    private fun tiskajQrBesedilo(printer: com.zcs.sdk.Printer, qrUrl: String?, format: PrnStrFormat) {
        if (qrUrl.isNullOrBlank()) return
        val urlFmt = PrnStrFormat().apply {
            setTextSize(18)
            setFont(PrnTextFont.MONOSPACE)
            setAli(Layout.Alignment.ALIGN_CENTER)
        }
        printer.setPrintAppendString("FURS QR:", urlFmt)
        var pos = 0
        while (pos < qrUrl.length) {
            printer.setPrintAppendString(qrUrl.substring(pos, minOf(pos + 30, qrUrl.length)), urlFmt)
            pos += 30
        }
        printer.setPrintStart()
    }

    fun statusText(): String {
        if (!sdkAvailable) return "ZCS SDK ni na voljo (libSmartPosJni.so manjka)"
        return try {
            val printer = driverManager?.printer ?: return "ZCS DriverManager ni inicializiran"
            when (printer.printerStatus) {
                SdkResult.SDK_OK -> "ZCS SDK povezan ✓"
                SdkResult.SDK_PRN_STATUS_PAPEROUT -> "ZCS SDK: papir zmanjka"
                else -> "ZCS SDK: status ${printer.printerStatus}"
            }
        } catch (e: Exception) {
            "ZCS SDK napaka: ${e.message}"
        }
    }

    /**
     * Razčleni ESC/POS tok v seznam besedilnih vrstic.
     *
     * Bajti so kodirani v CP852 (IBM PC852 Latin-2) — enako kot strežnik.
     * Zbiramo surove bajte vsake vrstice in jih dekodiramo z IBM852 naborom znakov,
     * da pravilno pridobimo šumevce (č, š, ž) in ostale ne-ASCII znake.
     *
     * ESC/POS ukazi se preskočijo (ne izpišejo se).
     */
    private fun stripEscPos(data: ByteArray): List<String> {
        val cp852 = charset("windows-1250")
        val lines = mutableListOf<String>()
        val currentBytes = java.io.ByteArrayOutputStream()
        var i = 0

        while (i < data.size) {
            val b = data[i].toInt() and 0xFF

            when {
                // ESC — 1 ali 2 bajta parametra
                b == 0x1B -> {
                    i++
                    if (i < data.size) {
                        val cmd = data[i].toInt() and 0xFF
                        i++
                        when (cmd) {
                            0x40 -> { /* INIT — brez parametrov */ }
                            // 1-bajtni parameter: align, bold, mode, font, feed, code-page
                            0x61, 0x45, 0x21, 0x4D, 0x64, 0x74,
                            0x2D, 0x47, 0x56, 0x70 -> i++
                        }
                    }
                }
                // GS — različni ukazi
                b == 0x1D -> {
                    i++
                    if (i < data.size) {
                        val cmd = data[i].toInt() and 0xFF
                        i++
                        when (cmd) {
                            0x56, 0x21, 0x42 -> i++          // 1-bajtni param
                            0x4C, 0x57 -> i += 2             // 2-bajtni param
                            0x28 -> {                         // GS ( sub pL pH data...
                                // Preskoči pod-ukaz (npr. 0x6B za QR kodo) pred branjem dolžine
                                if (i < data.size) { i++ }
                                if (i + 1 < data.size) {
                                    val len = (data[i].toInt() and 0xFF) +
                                              (data[i + 1].toInt() and 0xFF) * 256
                                    i += 2 + len
                                }
                            }
                        }
                    }
                }
                // FS — kitajski način (preskočimo 1 parameter)
                b == 0x1C -> {
                    i++
                    if (i < data.size) { i++ }
                }
                // LF — konec vrstice: dekodiraj zbrane bajte z IBM852
                b == 0x0A -> {
                    lines.add(currentBytes.toByteArray().toString(cp852))
                    currentBytes.reset()
                    i++
                }
                // CR — preskoči
                b == 0x0D -> i++
                // Tiskalni bajt (ASCII in ne-ASCII, vključno s CP852 šumevci)
                b >= 0x20 -> {
                    currentBytes.write(b)
                    i++
                }
                // Kontrolni znaki < 0x20 (razen zgoraj) — preskoči
                else -> i++
            }
        }

        // Zadnja vrstica brez LF
        if (currentBytes.size() > 0) {
            lines.add(currentBytes.toByteArray().toString(cp852))
        }

        return lines.filter { it.isNotBlank() }
    }
}

data class PrintResult(val ok: Boolean, val error: String? = null) {
    companion object {
        fun ok() = PrintResult(true)
        fun error(msg: String) = PrintResult(false, msg)
    }
}
