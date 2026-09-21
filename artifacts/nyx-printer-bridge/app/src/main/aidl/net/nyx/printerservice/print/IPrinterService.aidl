// PAKET SE NE SME SPREMENITI — net.nyx.printerservice.print
// Vir: https://github.com/SZNoryox/PrinterClient (veja a13)
// POZOR: vrstni red metod določa AIDL transaction kode — ne premikajte!
package net.nyx.printerservice.print;

import android.graphics.Bitmap;
import net.nyx.printerservice.print.PrintTextFormat;

interface IPrinterService {

    String getServiceVersion();

    int getPrinterVersion(out String[] ver);

    int getPrinterModel(out String[] model);

    int getPrinterStatus();

    int paperOut(int px);

    int paperBack(int px);

    int printText(String text, in PrintTextFormat textFormat);

    /**
     * textWidth = max širina besedila v px
     * align = poravnava besedila glede na širino (0=levo, 1=sredina, 2=desno)
     */
    int printText2(String text, in PrintTextFormat textFormat, int textWidth, int align);

    /**
     * content       — vsebina črtne kode
     * width/height  — px
     * textPosition  — pozicija besedila: 0=ne tiskaj, 1=zgoraj, 2=spodaj, 3=oba
     * align         — 0=levo, 1=sredina, 2=desno
     * symbology     — 0=CODE128, 1=CODE39, 2=CODE93, 3=UPC-A, 4=UPC-E, 5=EAN13,
     *                 6=EAN8, 7=ITF, 8=CODABAR
     */
    int printBarcode(String content, int width, int height, int textPosition, int align, int symbology);

    /**
     * content — vsebina QR kode
     * width/height — px
     * align   — 0=levo, 1=sredina, 2=desno
     */
    int printQrCode(String content, int width, int height, int align);

    /**
     * bitmap — Android Bitmap objekt
     * type   — 0=črno-belo, 1=sivinska (za barvne slike)
     * align  — 0=levo, 1=sredina, 2=desno
     */
    int printBitmap(in Bitmap bitmap, int type, int align);

    int labelLocate(int labelHeight, int labelGap);

    int labelPrintEnd();

    int labelLocateAuto(int labelHeight, int labelGap);

    int labelDetectAuto();

    boolean hasLabelLearning();

    int clearLabelLearning();

    int printEndAutoOut();

    int openCashBox();

    int setPaperWidth(int width);

    /**
     * Tiskaj surove ESC/POS bajte (od v1.5.9).
     * Če naprava ne podpira te metode, vrne RemoteException — v mostu je ovit v try-catch.
     */
    int printEscposData(in byte[] data);
}
