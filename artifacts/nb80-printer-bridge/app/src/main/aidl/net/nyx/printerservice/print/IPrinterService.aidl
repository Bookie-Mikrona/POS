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

    int printText2(String text, in PrintTextFormat textFormat, int textWidth, int align);

    // barcode: symbology 0=CODE128,1=CODE39,...  textPosition 0=none,1=above,2=below  align 0=left,1=center,2=right
    int printBarcode(String content, int width, int height, int textPosition, int align, int symbology);

    // QR code: align 0=left,1=center,2=right
    int printQrCode(String content, int width, int height, int align);

    int printBitmap(in Bitmap bitmap, int type, int align);

    int labelLocate(int labelHeight, int labelGap);

    int labelPrintEnd();

    int labelLocateAuto(int labelHeight, int labelGap);

    int labelDetectAuto();

    boolean hasLabelLearning();

    int clearLabelLearning();

    int printRasterData(in byte[] data);

    byte[] printEscposData(in byte[] data);

    int printTableText(in String[] text, in int[] widths, in PrintTextFormat[] formats);

    int showLcdBitmap(in Bitmap bitmap);

    int configLcd(int type);

    int printEndAutoOut();

    int openCashBox();

    int triggerQscScan(int opt);

    int setLcdLogo(in Bitmap bitmap);

    int getPrinterDensity(out int[] density);

    int setPrinterDensity(int density);

    int setPaperWidth(int width);
}
