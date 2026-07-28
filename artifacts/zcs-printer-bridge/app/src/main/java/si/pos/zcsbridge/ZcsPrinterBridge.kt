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
 * Strategije (po vrstnem redu):
 *  A. Neposreden datotečni dostop — /dev/stprinter ali podobno (brez SDK)
 *  B. ZCS SDK prek DriverManager.getInstance() (zahteva libSmartPosJni.so)
 *
 * Strategija A NE zahteva nobene SDK knjižnice — piše surove ESC/POS bajte
 * neposredno na Linux device datoteko, ki jo ZCS ROM izpostavi.
 */
class ZcsPrinterBridge(private val context: Context) {

    companion object {
        private const val TAG = "ZcsPrinterBridge"
        private const val PRINT_TEXT_SIZE = 24

        // ZCS naprave pogosto izpostavijo tiskalnik kot device datoteko
        private val DEVICE_FILE_PATHS = listOf(
            "/dev/stprinter",
            "/dev/thermal_printer",
            "/dev/printer",
            "/dev/prn",
            "/dev/ttyS1",
            "/dev/ttyS2",
            "/dev/bt_printer",
            "/dev/zcs_printer",
        )

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
    private var deviceFilePath: String? = null   // /dev/stprinter ali podobno

    fun connect() {
        // Strategija A: neposreden datotečni dostop (ne zahteva SDK)
        deviceFilePath = tryFindDeviceFile()
        if (deviceFilePath != null) {
            Log.i(TAG, "Strategija A: tiskalnik dosegljiv prek $deviceFilePath")
            sdkAvailable = true
            return
        }

        // Strategija B1: DriverManager brez ročnega nalaganja knjižnice
        if (tryInitDriverManager()) return

        // Strategija B2: Ročno naložimo knjižnico, nato inicializiramo DriverManager
        if (tryLoadNativeLib()) {
            if (tryInitDriverManager()) return
        }

        // Strategija B3: Ekstrakcija libSmartPosJni.so iz nameščenih APK-jev
        if (tryExtractAndLoadFromInstalledApk()) {
            if (tryInitDriverManager()) return
        }

        Log.e(TAG, "Nobena strategija ni uspela — tiskanje ne bo delovalo")
        logDiagnostics()
    }

    /**
     * Poišče dostopno device datoteko tiskalnika.
     * Testira pisanje — samo na res dostopne datoteke.
     */
    private fun tryFindDeviceFile(): String? {
        // Najprej poišči katere device datoteke OBSTAJAJO
        val candidates = DEVICE_FILE_PATHS.filter { java.io.File(it).exists() }
        Log.i(TAG, "Device datoteke, ki obstajajo: ${candidates.ifEmpty { listOf("nobena") }}")

        for (path in candidates) {
            try {
                // Poskusi odpreti za pisanje
                java.io.FileOutputStream(path, true).use {
                    Log.i(TAG, "Dostop do device datoteke: $path ✓")
                }
                return path
            } catch (e: Exception) {
                Log.w(TAG, "Ni dostopa do $path: ${e.message}")
            }
        }
        return null
    }

    /** Poskusi inicializirati DriverManager; vrne true ob uspehu. */
    private fun tryInitDriverManager(): Boolean {
        return try {
            driverManager = DriverManager.getInstance()
            val status = driverManager?.printer?.printerStatus
            Log.i(TAG, "ZCS SDK inicializiran, status tiskalnika: $status")
            sdkAvailable = true
            true
        } catch (e: Throwable) {
            Log.w(TAG, "ZCS DriverManager ni uspelo: ${e.message}")
            driverManager = null
            false
        }
    }

    private fun tryLoadNativeLib(): Boolean {
        try {
            System.loadLibrary("SmartPosJni")
            Log.i(TAG, "libSmartPosJni naložena via loadLibrary")
            return true
        } catch (e: UnsatisfiedLinkError) {
            Log.w(TAG, "loadLibrary('SmartPosJni') ni uspelo: ${e.message}")
        }

        for (path in SMARTPOS_LIB_PATHS) {
            try {
                System.load(path)
                Log.i(TAG, "libSmartPosJni naložena iz: $path")
                return true
            } catch (e: UnsatisfiedLinkError) {
                // ni na tej poti
            }
        }
        return false
    }

    /**
     * Poišče libSmartPosJni.so v vseh nameščenih APK-jih in jo ekstrahira.
     */
    private fun tryExtractAndLoadFromInstalledApk(): Boolean {
        val soNames = listOf("libSmartPosJni.so", "libEmvCoreJni.so")
        val outDir = java.io.File(context.filesDir, "native_libs").also { it.mkdirs() }

        // Preveri že ekstrahirane SO datoteke
        for (soName in soNames) {
            val cached = java.io.File(outDir, soName)
            if (cached.exists() && cached.length() > 0) {
                try {
                    System.load(cached.absolutePath)
                    Log.i(TAG, "Naloženo iz predpomnilnika: ${cached.absolutePath}")
                    return true
                } catch (e: UnsatisfiedLinkError) {
                    Log.w(TAG, "Predpomnilnik ni uporaben: ${e.message}")
                    cached.delete()
                }
            }
        }

        val pm = context.packageManager
        val allPackages = try {
            pm.getInstalledApplications(0).sortedWith(
                compareByDescending<android.content.pm.ApplicationInfo> { info ->
                    listOf("zcs", "smartpos", "pos", "print").any {
                        info.packageName.contains(it, ignoreCase = true)
                    }
                }
            )
        } catch (e: Exception) {
            Log.w(TAG, "Ni mogoče pridobiti seznama paketov: ${e.message}")
            return false
        }

        Log.i(TAG, "Iščem libSmartPosJni.so v ${allPackages.size} paketih...")

        for (appInfo in allPackages) {
            val pkg = appInfo.packageName
            if (pkg == context.packageName) continue

            try {
                val apkPath = appInfo.publicSourceDir ?: continue
                var found = false

                java.util.zip.ZipFile(apkPath).use { zip ->
                    zip.entries().asSequence()
                        .filter { entry ->
                            soNames.any { entry.name.endsWith(it) } &&
                            (entry.name.contains("arm64") || entry.name.contains("arm"))
                        }
                        .forEach { entry ->
                            val soName = java.io.File(entry.name).name
                            val outFile = java.io.File(outDir, soName)
                            try {
                                if (!outFile.exists() || outFile.length() != entry.size) {
                                    zip.getInputStream(entry).use { inp ->
                                        outFile.outputStream().use { out -> inp.copyTo(out) }
                                    }
                                    Log.i(TAG, "Ekstrahirano $soName iz $pkg (${outFile.length()} B)")
                                }
                                System.load(outFile.absolutePath)
                                Log.i(TAG, "Naloženo: $soName iz $pkg")
                                found = true
                            } catch (e: UnsatisfiedLinkError) {
                                Log.w(TAG, "$soName iz $pkg ni naložljiva: ${e.message}")
                                outFile.delete()
                            }
                        }
                }
                if (found) return true
            } catch (_: java.util.zip.ZipException) {
            } catch (_: Exception) {
            }
        }

        val zcsPackages = allPackages
            .filter {
                it.packageName.contains("zcs", ignoreCase = true) ||
                it.packageName.contains("smartpos", ignoreCase = true)
            }
            .map { it.packageName }
        Log.w(TAG, "libSmartPosJni.so ni bila najdena. ZCS paketi: ${zcsPackages.ifEmpty { listOf("nobeden") }}")
        return false
    }

    private fun logDiagnostics() {
        try {
            val lib64 = java.io.File("/system/lib64").listFiles()
                ?.filter { it.name.contains("zcs", ignoreCase = true) || it.name.contains("smart", ignoreCase = true) }
                ?.joinToString { it.name } ?: "nič"
            Log.w(TAG, "ZCS knjižnice v /system/lib64: $lib64")
        } catch (_: Exception) {}

        try {
            val devFiles = java.io.File("/dev").listFiles()
                ?.filter { it.name.contains("print", ignoreCase = true) || it.name.contains("stpr", ignoreCase = true) }
                ?.joinToString { it.name } ?: "nič"
            Log.w(TAG, "Tiskalniške device datoteke v /dev: $devFiles")
        } catch (_: Exception) {}
    }

    /** Vrne seznam ZCS/SmartPos paketov nameščenih na napravi (za diagnostiko). */
    fun getInstalledZcsPackages(): List<String> {
        return try {
            context.packageManager.getInstalledApplications(0)
                .filter {
                    it.packageName.contains("zcs", ignoreCase = true) ||
                    it.packageName.contains("smartpos", ignoreCase = true)
                }
                .map { it.packageName }
        } catch (e: Exception) { emptyList() }
    }

    fun disconnect() {
        // brez eksplicitnega odklopa
    }

    /**
     * Natisni ESC/POS bajte — prek device datoteke ali ZCS SDK.
     */
    fun print(data: ByteArray): PrintResult {
        if (!sdkAvailable) {
            return PrintResult.error("ZCS tiskalnik ni na voljo")
        }

        // Strategija A: neposredno pisanje na device datoteko
        deviceFilePath?.let { path ->
            return try {
                java.io.FileOutputStream(path, true).use { it.write(data) }
                Log.i(TAG, "Natisnjeno ${data.size} B na $path")
                PrintResult.ok()
            } catch (e: Exception) {
                Log.e(TAG, "Napaka pri pisanju na $path: ${e.message}")
                PrintResult.error("Napaka: ${e.message}")
            }
        }

        // Strategija B: ZCS SDK
        if (driverManager == null) {
            return PrintResult.error("ZCS SDK ni inicializiran")
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
     * Natisni besedilne vrstice (UTF-8) in QR kodo prek ZCS SDK ali device datoteke.
     *
     * @param qrBase64  base64 PNG QR kode; če null → izpiše qrUrl kot besedilo
     * @param qrUrl     60-cifrna FURS vsebina (rezervno besedilo)
     */
    fun printText(lines: List<String>, formati: List<String>? = null, qrUrl: String?, qrBase64: String? = null): PrintResult {
        if (!sdkAvailable) {
            return PrintResult.error("ZCS tiskalnik ni na voljo")
        }

        // Strategija A: napiši ESC/POS bajte neposredno na device datoteko
        deviceFilePath?.let { path ->
            return printTextViaDeviceFile(path, lines, formati, qrUrl, qrBase64)
        }

        // Strategija B: ZCS SDK
        if (driverManager == null) {
            return PrintResult.error("ZCS SDK ni inicializiran")
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

            // ZCS SDK ima interno mejo bufferja (~45 vrstic). Natisnemo v sklopih po 40 vrstic,
            // da se prepreči samodejni flush pred koncem vsebine in predčasni QR izpis.
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

            var qrOk = false
            if (!qrBase64.isNullOrBlank()) {
                try {
                    val pngBytes = Base64.decode(qrBase64, Base64.DEFAULT)
                    val bmp = BitmapFactory.decodeByteArray(pngBytes, 0, pngBytes.size)
                    if (bmp != null) {
                        val qrSize = 200
                        val scaled = Bitmap.createScaledBitmap(bmp, qrSize, qrSize, true)
                            .copy(Bitmap.Config.ARGB_8888, false)
                        // setPrintAppendStrings(Bitmap) doda sliko v isti string buffer
                        // kot tekst — brez ločenega bitmap bufferja in brez rezanja.
                        printer.setPrintAppendStrings(scaled)
                        Log.i(TAG, "printText: QR bitmap ${qrSize}×${qrSize} dodan v buffer")
                        qrOk = true
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "printText: QR bitmap napaka (${e.message})")
                }
            }

            if (!qrOk && !qrUrl.isNullOrBlank()) {
                tiskajQrBesedilo(printer, qrUrl, format)
            }

            repeat(4) { printer.setPrintAppendString(" ", format) }
            printer.setPrintStart()

            Log.i(TAG, "printText: zaključeno, qrBitmap=$qrOk")
            PrintResult.ok()
        } catch (e: Exception) {
            Log.e(TAG, "ZCS printText napaka: ${e.message}", e)
            PrintResult.error("Napaka: ${e.message}")
        }
    }

    /**
     * Tiskanje prek device datoteke: zgradi ESC/POS tok in ga zapiše.
     * QR koda se izpiše kot besedilo (ESC/POS QR ukaz ni zanesljivo podprt brez SDK).
     */
    private fun printTextViaDeviceFile(
        path: String,
        lines: List<String>,
        formati: List<String>?,
        qrUrl: String?,
        qrBase64: String?
    ): PrintResult {
        return try {
            val out = java.io.ByteArrayOutputStream()

            fun writeBytes(vararg b: Int) = b.forEach { out.write(it) }
            fun writeString(s: String) = out.write(s.toByteArray(charset("windows-1250")))
            fun writeLn(s: String) { writeString(s); out.write(0x0A) }

            // ESC/POS INIT
            writeBytes(0x1B, 0x40)
            // Nastavi code page CP852 (ESC t 18)
            writeBytes(0x1B, 0x74, 0x12)

            for ((i, line) in lines.withIndex()) {
                val isBold = formati != null && i < formati.size && formati[i] == "B"
                if (isBold) writeBytes(0x1B, 0x45, 0x01) // bold on
                writeLn(line)
                if (isBold) writeBytes(0x1B, 0x45, 0x00) // bold off
            }

            // QR koda kot besedilo (rezervno)
            if (!qrUrl.isNullOrBlank()) {
                writeLn("")
                writeBytes(0x1B, 0x61, 0x01) // center align
                writeLn("QR:")
                var pos = 0
                while (pos < qrUrl.length) {
                    writeLn(qrUrl.substring(pos, minOf(pos + 30, qrUrl.length)))
                    pos += 30
                }
                writeBytes(0x1B, 0x61, 0x00) // left align
            }

            // 4 prazne vrstice + odrez
            repeat(4) { out.write(0x0A) }
            writeBytes(0x1D, 0x56, 0x00) // full cut

            java.io.FileOutputStream(path, true).use { it.write(out.toByteArray()) }
            Log.i(TAG, "printTextViaDeviceFile: ${out.size()} B na $path, ${lines.size} vrstic")
            PrintResult.ok()
        } catch (e: Exception) {
            Log.e(TAG, "printTextViaDeviceFile napaka: ${e.message}", e)
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

    fun isReady(): Boolean = sdkAvailable

    fun statusText(): String {
        deviceFilePath?.let { return "Tiskalnik: $it ✓" }
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
     * Bajti so kodirani v CP852/windows-1250.
     */
    private fun stripEscPos(data: ByteArray): List<String> {
        val cp852 = charset("windows-1250")
        val lines = mutableListOf<String>()
        val currentBytes = java.io.ByteArrayOutputStream()
        var i = 0

        while (i < data.size) {
            val b = data[i].toInt() and 0xFF
            when {
                b == 0x1B -> {
                    i++
                    if (i < data.size) {
                        val cmd = data[i].toInt() and 0xFF
                        i++
                        when (cmd) {
                            0x40 -> {}
                            0x61, 0x45, 0x21, 0x4D, 0x64, 0x74,
                            0x2D, 0x47, 0x56, 0x70 -> i++
                        }
                    }
                }
                b == 0x1D -> {
                    i++
                    if (i < data.size) {
                        val cmd = data[i].toInt() and 0xFF
                        i++
                        when (cmd) {
                            0x56, 0x21, 0x42 -> i++
                            0x4C, 0x57 -> i += 2
                            0x28 -> {
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
                b == 0x1C -> {
                    i++
                    if (i < data.size) { i++ }
                }
                b == 0x0A -> {
                    lines.add(currentBytes.toByteArray().toString(cp852))
                    currentBytes.reset()
                    i++
                }
                b == 0x0D -> i++
                b >= 0x20 -> {
                    currentBytes.write(b)
                    i++
                }
                else -> i++
            }
        }

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
