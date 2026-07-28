// ZCS AIDL vmesnik za vgrajen tiskalnik
// Vir: ZCS Android SDK dokumentacija
package com.zcs.android.aidl.printer;

interface IBasePrinter {
    /** Nastavi hitrost tiskanja (0=normalno, 1=hitro) */
    void setPrinterPrintDepth(int depth);
    /** Pošlji surove ESC/POS ukaze */
    void sendUserCmdData(in byte[] data);
    /** Tiskaj besedilo */
    void printRawData(in byte[] data, int length);
    /** Status tiskalnika (0=OK, 1=papir zmanjka, 2=pregretje) */
    int getPrinterStatus();
    /** Odreži papir */
    void cutPaper(int mode);
}
