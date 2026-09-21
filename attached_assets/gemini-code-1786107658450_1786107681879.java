// 1. Povezava s storitvijo tiskalnika (Printer Service)
Intent intent = new Intent();
intent.setPackage("com.noryox.printer"); // ali com.pos.sdk
intent.setAction("com.noryox.printer.PRINTER_SERVICE");
bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE);

// 2. Pošiljanje ukazov za tiskanje
public void printReceipt() {
    try {
        printerService.initPrinter();
        printerService.setFontSize(24);
        printerService.printText("IZDAN RAČUN\n", 1); // 1 = Sredinska poravnava
        printerService.printBarcode("3830000000000", 2, 100, 2, 0);
        printerService.feedLine(3); // Pomik papirja
    } catch (RemoteException e) {
        e.printStackTrace;
    }
}