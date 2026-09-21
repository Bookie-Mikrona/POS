/*
 * This file is auto-generated.  DO NOT MODIFY.
 * Using: /nix/store/1m0wfsd7m2wl1yl3q6ddb5q00h8bzn48-android-sdk-build-tools-36.0.0/libexec/android-sdk/build-tools/36.0.0/aidl -p/nix/store/6q9y0sdi9v94sdm9qsrw8gc20ay9vsm2-android-sdk-platforms-36/libexec/android-sdk/platforms/android-36/framework.aidl -o/home/runner/workspace/artifacts/nb80-printer-bridge/app/build/generated/aidl_source_output_dir/debug/out -I/home/runner/workspace/artifacts/nb80-printer-bridge/app/src/main/aidl -I/home/runner/workspace/artifacts/nb80-printer-bridge/app/src/debug/aidl -I/home/runner/.gradle/caches/8.14.2/transforms/00cdd3706229341f98bdfa73c9d7cd09/transformed/core-1.9.0/aidl -I/home/runner/.gradle/caches/8.14.2/transforms/875115849eb7790d9709e3791f3a3671/transformed/versionedparcelable-1.1.1/aidl -d/tmp/aidl9950611309050363708.d /home/runner/workspace/artifacts/nb80-printer-bridge/app/src/main/aidl/net/nyx/printerservice/print/IPrinterService.aidl
 *
 * DO NOT CHECK THIS FILE INTO A CODE TREE (e.g. git, etc..).
 * ALWAYS GENERATE THIS FILE FROM UPDATED AIDL COMPILER
 * AS A BUILD INTERMEDIATE ONLY. THIS IS NOT SOURCE CODE.
 */
package net.nyx.printerservice.print;
public interface IPrinterService extends android.os.IInterface
{
  /** Default implementation for IPrinterService. */
  public static class Default implements net.nyx.printerservice.print.IPrinterService
  {
    @Override public java.lang.String getServiceVersion() throws android.os.RemoteException
    {
      return null;
    }
    @Override public int getPrinterVersion(java.lang.String[] ver) throws android.os.RemoteException
    {
      return 0;
    }
    @Override public int getPrinterModel(java.lang.String[] model) throws android.os.RemoteException
    {
      return 0;
    }
    @Override public int getPrinterStatus() throws android.os.RemoteException
    {
      return 0;
    }
    @Override public int paperOut(int px) throws android.os.RemoteException
    {
      return 0;
    }
    @Override public int paperBack(int px) throws android.os.RemoteException
    {
      return 0;
    }
    @Override public int printText(java.lang.String text, net.nyx.printerservice.print.PrintTextFormat textFormat) throws android.os.RemoteException
    {
      return 0;
    }
    @Override public int printText2(java.lang.String text, net.nyx.printerservice.print.PrintTextFormat textFormat, int textWidth, int align) throws android.os.RemoteException
    {
      return 0;
    }
    // barcode: symbology 0=CODE128,1=CODE39,...  textPosition 0=none,1=above,2=below  align 0=left,1=center,2=right
    @Override public int printBarcode(java.lang.String content, int width, int height, int textPosition, int align, int symbology) throws android.os.RemoteException
    {
      return 0;
    }
    // QR code: align 0=left,1=center,2=right
    @Override public int printQrCode(java.lang.String content, int width, int height, int align) throws android.os.RemoteException
    {
      return 0;
    }
    @Override public int printBitmap(android.graphics.Bitmap bitmap, int type, int align) throws android.os.RemoteException
    {
      return 0;
    }
    @Override public int labelLocate(int labelHeight, int labelGap) throws android.os.RemoteException
    {
      return 0;
    }
    @Override public int labelPrintEnd() throws android.os.RemoteException
    {
      return 0;
    }
    @Override public int labelLocateAuto(int labelHeight, int labelGap) throws android.os.RemoteException
    {
      return 0;
    }
    @Override public int labelDetectAuto() throws android.os.RemoteException
    {
      return 0;
    }
    // Auto paper feed and cut after printing
    @Override public int printEndAutoOut() throws android.os.RemoteException
    {
      return 0;
    }
    @Override public int openCashBox() throws android.os.RemoteException
    {
      return 0;
    }
    @Override public int triggerQscScan(int opt) throws android.os.RemoteException
    {
      return 0;
    }
    @Override public int setLcdLogo(android.graphics.Bitmap bitmap) throws android.os.RemoteException
    {
      return 0;
    }
    @Override public int getPrinterDensity(int[] density) throws android.os.RemoteException
    {
      return 0;
    }
    @Override public int setPrinterDensity(int density) throws android.os.RemoteException
    {
      return 0;
    }
    @Override public int setPaperWidth(int width) throws android.os.RemoteException
    {
      return 0;
    }
    @Override
    public android.os.IBinder asBinder() {
      return null;
    }
  }
  /** Local-side IPC implementation stub class. */
  public static abstract class Stub extends android.os.Binder implements net.nyx.printerservice.print.IPrinterService
  {
    /** Construct the stub and attach it to the interface. */
    @SuppressWarnings("this-escape")
    public Stub()
    {
      this.attachInterface(this, DESCRIPTOR);
    }
    /**
     * Cast an IBinder object into an net.nyx.printerservice.print.IPrinterService interface,
     * generating a proxy if needed.
     */
    public static net.nyx.printerservice.print.IPrinterService asInterface(android.os.IBinder obj)
    {
      if ((obj==null)) {
        return null;
      }
      android.os.IInterface iin = obj.queryLocalInterface(DESCRIPTOR);
      if (((iin!=null)&&(iin instanceof net.nyx.printerservice.print.IPrinterService))) {
        return ((net.nyx.printerservice.print.IPrinterService)iin);
      }
      return new net.nyx.printerservice.print.IPrinterService.Stub.Proxy(obj);
    }
    @Override public android.os.IBinder asBinder()
    {
      return this;
    }
    @Override public boolean onTransact(int code, android.os.Parcel data, android.os.Parcel reply, int flags) throws android.os.RemoteException
    {
      java.lang.String descriptor = DESCRIPTOR;
      if (code >= android.os.IBinder.FIRST_CALL_TRANSACTION && code <= android.os.IBinder.LAST_CALL_TRANSACTION) {
        data.enforceInterface(descriptor);
      }
      if (code == INTERFACE_TRANSACTION) {
        reply.writeString(descriptor);
        return true;
      }
      switch (code)
      {
        case TRANSACTION_getServiceVersion:
        {
          java.lang.String _result = this.getServiceVersion();
          reply.writeNoException();
          reply.writeString(_result);
          break;
        }
        case TRANSACTION_getPrinterVersion:
        {
          java.lang.String[] _arg0;
          int _arg0_length = data.readInt();
          if (_arg0_length > 1000000) {
            throw new android.os.BadParcelableException("Array too large: " + _arg0_length);
          } else if (_arg0_length < 0) {
            _arg0 = null;
          } else {
            _arg0 = new java.lang.String[_arg0_length];
          }
          int _result = this.getPrinterVersion(_arg0);
          reply.writeNoException();
          reply.writeInt(_result);
          reply.writeStringArray(_arg0);
          break;
        }
        case TRANSACTION_getPrinterModel:
        {
          java.lang.String[] _arg0;
          int _arg0_length = data.readInt();
          if (_arg0_length > 1000000) {
            throw new android.os.BadParcelableException("Array too large: " + _arg0_length);
          } else if (_arg0_length < 0) {
            _arg0 = null;
          } else {
            _arg0 = new java.lang.String[_arg0_length];
          }
          int _result = this.getPrinterModel(_arg0);
          reply.writeNoException();
          reply.writeInt(_result);
          reply.writeStringArray(_arg0);
          break;
        }
        case TRANSACTION_getPrinterStatus:
        {
          int _result = this.getPrinterStatus();
          reply.writeNoException();
          reply.writeInt(_result);
          break;
        }
        case TRANSACTION_paperOut:
        {
          int _arg0;
          _arg0 = data.readInt();
          int _result = this.paperOut(_arg0);
          reply.writeNoException();
          reply.writeInt(_result);
          break;
        }
        case TRANSACTION_paperBack:
        {
          int _arg0;
          _arg0 = data.readInt();
          int _result = this.paperBack(_arg0);
          reply.writeNoException();
          reply.writeInt(_result);
          break;
        }
        case TRANSACTION_printText:
        {
          java.lang.String _arg0;
          _arg0 = data.readString();
          net.nyx.printerservice.print.PrintTextFormat _arg1;
          _arg1 = _Parcel.readTypedObject(data, net.nyx.printerservice.print.PrintTextFormat.CREATOR);
          int _result = this.printText(_arg0, _arg1);
          reply.writeNoException();
          reply.writeInt(_result);
          break;
        }
        case TRANSACTION_printText2:
        {
          java.lang.String _arg0;
          _arg0 = data.readString();
          net.nyx.printerservice.print.PrintTextFormat _arg1;
          _arg1 = _Parcel.readTypedObject(data, net.nyx.printerservice.print.PrintTextFormat.CREATOR);
          int _arg2;
          _arg2 = data.readInt();
          int _arg3;
          _arg3 = data.readInt();
          int _result = this.printText2(_arg0, _arg1, _arg2, _arg3);
          reply.writeNoException();
          reply.writeInt(_result);
          break;
        }
        case TRANSACTION_printBarcode:
        {
          java.lang.String _arg0;
          _arg0 = data.readString();
          int _arg1;
          _arg1 = data.readInt();
          int _arg2;
          _arg2 = data.readInt();
          int _arg3;
          _arg3 = data.readInt();
          int _arg4;
          _arg4 = data.readInt();
          int _arg5;
          _arg5 = data.readInt();
          int _result = this.printBarcode(_arg0, _arg1, _arg2, _arg3, _arg4, _arg5);
          reply.writeNoException();
          reply.writeInt(_result);
          break;
        }
        case TRANSACTION_printQrCode:
        {
          java.lang.String _arg0;
          _arg0 = data.readString();
          int _arg1;
          _arg1 = data.readInt();
          int _arg2;
          _arg2 = data.readInt();
          int _arg3;
          _arg3 = data.readInt();
          int _result = this.printQrCode(_arg0, _arg1, _arg2, _arg3);
          reply.writeNoException();
          reply.writeInt(_result);
          break;
        }
        case TRANSACTION_printBitmap:
        {
          android.graphics.Bitmap _arg0;
          _arg0 = _Parcel.readTypedObject(data, android.graphics.Bitmap.CREATOR);
          int _arg1;
          _arg1 = data.readInt();
          int _arg2;
          _arg2 = data.readInt();
          int _result = this.printBitmap(_arg0, _arg1, _arg2);
          reply.writeNoException();
          reply.writeInt(_result);
          break;
        }
        case TRANSACTION_labelLocate:
        {
          int _arg0;
          _arg0 = data.readInt();
          int _arg1;
          _arg1 = data.readInt();
          int _result = this.labelLocate(_arg0, _arg1);
          reply.writeNoException();
          reply.writeInt(_result);
          break;
        }
        case TRANSACTION_labelPrintEnd:
        {
          int _result = this.labelPrintEnd();
          reply.writeNoException();
          reply.writeInt(_result);
          break;
        }
        case TRANSACTION_labelLocateAuto:
        {
          int _arg0;
          _arg0 = data.readInt();
          int _arg1;
          _arg1 = data.readInt();
          int _result = this.labelLocateAuto(_arg0, _arg1);
          reply.writeNoException();
          reply.writeInt(_result);
          break;
        }
        case TRANSACTION_labelDetectAuto:
        {
          int _result = this.labelDetectAuto();
          reply.writeNoException();
          reply.writeInt(_result);
          break;
        }
        case TRANSACTION_printEndAutoOut:
        {
          int _result = this.printEndAutoOut();
          reply.writeNoException();
          reply.writeInt(_result);
          break;
        }
        case TRANSACTION_openCashBox:
        {
          int _result = this.openCashBox();
          reply.writeNoException();
          reply.writeInt(_result);
          break;
        }
        case TRANSACTION_triggerQscScan:
        {
          int _arg0;
          _arg0 = data.readInt();
          int _result = this.triggerQscScan(_arg0);
          reply.writeNoException();
          reply.writeInt(_result);
          break;
        }
        case TRANSACTION_setLcdLogo:
        {
          android.graphics.Bitmap _arg0;
          _arg0 = _Parcel.readTypedObject(data, android.graphics.Bitmap.CREATOR);
          int _result = this.setLcdLogo(_arg0);
          reply.writeNoException();
          reply.writeInt(_result);
          break;
        }
        case TRANSACTION_getPrinterDensity:
        {
          int[] _arg0;
          int _arg0_length = data.readInt();
          if (_arg0_length > 1000000) {
            throw new android.os.BadParcelableException("Array too large: " + _arg0_length);
          } else if (_arg0_length < 0) {
            _arg0 = null;
          } else {
            _arg0 = new int[_arg0_length];
          }
          int _result = this.getPrinterDensity(_arg0);
          reply.writeNoException();
          reply.writeInt(_result);
          reply.writeIntArray(_arg0);
          break;
        }
        case TRANSACTION_setPrinterDensity:
        {
          int _arg0;
          _arg0 = data.readInt();
          int _result = this.setPrinterDensity(_arg0);
          reply.writeNoException();
          reply.writeInt(_result);
          break;
        }
        case TRANSACTION_setPaperWidth:
        {
          int _arg0;
          _arg0 = data.readInt();
          int _result = this.setPaperWidth(_arg0);
          reply.writeNoException();
          reply.writeInt(_result);
          break;
        }
        default:
        {
          return super.onTransact(code, data, reply, flags);
        }
      }
      return true;
    }
    private static class Proxy implements net.nyx.printerservice.print.IPrinterService
    {
      private android.os.IBinder mRemote;
      Proxy(android.os.IBinder remote)
      {
        mRemote = remote;
      }
      @Override public android.os.IBinder asBinder()
      {
        return mRemote;
      }
      public java.lang.String getInterfaceDescriptor()
      {
        return DESCRIPTOR;
      }
      @Override public java.lang.String getServiceVersion() throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        java.lang.String _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          boolean _status = mRemote.transact(Stub.TRANSACTION_getServiceVersion, _data, _reply, 0);
          _reply.readException();
          _result = _reply.readString();
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
      @Override public int getPrinterVersion(java.lang.String[] ver) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        int _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeInt(ver.length);
          boolean _status = mRemote.transact(Stub.TRANSACTION_getPrinterVersion, _data, _reply, 0);
          _reply.readException();
          _result = _reply.readInt();
          _reply.readStringArray(ver);
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
      @Override public int getPrinterModel(java.lang.String[] model) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        int _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeInt(model.length);
          boolean _status = mRemote.transact(Stub.TRANSACTION_getPrinterModel, _data, _reply, 0);
          _reply.readException();
          _result = _reply.readInt();
          _reply.readStringArray(model);
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
      @Override public int getPrinterStatus() throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        int _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          boolean _status = mRemote.transact(Stub.TRANSACTION_getPrinterStatus, _data, _reply, 0);
          _reply.readException();
          _result = _reply.readInt();
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
      @Override public int paperOut(int px) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        int _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeInt(px);
          boolean _status = mRemote.transact(Stub.TRANSACTION_paperOut, _data, _reply, 0);
          _reply.readException();
          _result = _reply.readInt();
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
      @Override public int paperBack(int px) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        int _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeInt(px);
          boolean _status = mRemote.transact(Stub.TRANSACTION_paperBack, _data, _reply, 0);
          _reply.readException();
          _result = _reply.readInt();
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
      @Override public int printText(java.lang.String text, net.nyx.printerservice.print.PrintTextFormat textFormat) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        int _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeString(text);
          _Parcel.writeTypedObject(_data, textFormat, 0);
          boolean _status = mRemote.transact(Stub.TRANSACTION_printText, _data, _reply, 0);
          _reply.readException();
          _result = _reply.readInt();
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
      @Override public int printText2(java.lang.String text, net.nyx.printerservice.print.PrintTextFormat textFormat, int textWidth, int align) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        int _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeString(text);
          _Parcel.writeTypedObject(_data, textFormat, 0);
          _data.writeInt(textWidth);
          _data.writeInt(align);
          boolean _status = mRemote.transact(Stub.TRANSACTION_printText2, _data, _reply, 0);
          _reply.readException();
          _result = _reply.readInt();
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
      // barcode: symbology 0=CODE128,1=CODE39,...  textPosition 0=none,1=above,2=below  align 0=left,1=center,2=right
      @Override public int printBarcode(java.lang.String content, int width, int height, int textPosition, int align, int symbology) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        int _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeString(content);
          _data.writeInt(width);
          _data.writeInt(height);
          _data.writeInt(textPosition);
          _data.writeInt(align);
          _data.writeInt(symbology);
          boolean _status = mRemote.transact(Stub.TRANSACTION_printBarcode, _data, _reply, 0);
          _reply.readException();
          _result = _reply.readInt();
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
      // QR code: align 0=left,1=center,2=right
      @Override public int printQrCode(java.lang.String content, int width, int height, int align) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        int _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeString(content);
          _data.writeInt(width);
          _data.writeInt(height);
          _data.writeInt(align);
          boolean _status = mRemote.transact(Stub.TRANSACTION_printQrCode, _data, _reply, 0);
          _reply.readException();
          _result = _reply.readInt();
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
      @Override public int printBitmap(android.graphics.Bitmap bitmap, int type, int align) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        int _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _Parcel.writeTypedObject(_data, bitmap, 0);
          _data.writeInt(type);
          _data.writeInt(align);
          boolean _status = mRemote.transact(Stub.TRANSACTION_printBitmap, _data, _reply, 0);
          _reply.readException();
          _result = _reply.readInt();
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
      @Override public int labelLocate(int labelHeight, int labelGap) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        int _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeInt(labelHeight);
          _data.writeInt(labelGap);
          boolean _status = mRemote.transact(Stub.TRANSACTION_labelLocate, _data, _reply, 0);
          _reply.readException();
          _result = _reply.readInt();
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
      @Override public int labelPrintEnd() throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        int _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          boolean _status = mRemote.transact(Stub.TRANSACTION_labelPrintEnd, _data, _reply, 0);
          _reply.readException();
          _result = _reply.readInt();
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
      @Override public int labelLocateAuto(int labelHeight, int labelGap) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        int _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeInt(labelHeight);
          _data.writeInt(labelGap);
          boolean _status = mRemote.transact(Stub.TRANSACTION_labelLocateAuto, _data, _reply, 0);
          _reply.readException();
          _result = _reply.readInt();
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
      @Override public int labelDetectAuto() throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        int _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          boolean _status = mRemote.transact(Stub.TRANSACTION_labelDetectAuto, _data, _reply, 0);
          _reply.readException();
          _result = _reply.readInt();
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
      // Auto paper feed and cut after printing
      @Override public int printEndAutoOut() throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        int _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          boolean _status = mRemote.transact(Stub.TRANSACTION_printEndAutoOut, _data, _reply, 0);
          _reply.readException();
          _result = _reply.readInt();
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
      @Override public int openCashBox() throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        int _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          boolean _status = mRemote.transact(Stub.TRANSACTION_openCashBox, _data, _reply, 0);
          _reply.readException();
          _result = _reply.readInt();
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
      @Override public int triggerQscScan(int opt) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        int _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeInt(opt);
          boolean _status = mRemote.transact(Stub.TRANSACTION_triggerQscScan, _data, _reply, 0);
          _reply.readException();
          _result = _reply.readInt();
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
      @Override public int setLcdLogo(android.graphics.Bitmap bitmap) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        int _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _Parcel.writeTypedObject(_data, bitmap, 0);
          boolean _status = mRemote.transact(Stub.TRANSACTION_setLcdLogo, _data, _reply, 0);
          _reply.readException();
          _result = _reply.readInt();
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
      @Override public int getPrinterDensity(int[] density) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        int _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeInt(density.length);
          boolean _status = mRemote.transact(Stub.TRANSACTION_getPrinterDensity, _data, _reply, 0);
          _reply.readException();
          _result = _reply.readInt();
          _reply.readIntArray(density);
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
      @Override public int setPrinterDensity(int density) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        int _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeInt(density);
          boolean _status = mRemote.transact(Stub.TRANSACTION_setPrinterDensity, _data, _reply, 0);
          _reply.readException();
          _result = _reply.readInt();
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
      @Override public int setPaperWidth(int width) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        int _result;
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeInt(width);
          boolean _status = mRemote.transact(Stub.TRANSACTION_setPaperWidth, _data, _reply, 0);
          _reply.readException();
          _result = _reply.readInt();
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
        return _result;
      }
    }
    static final int TRANSACTION_getServiceVersion = (android.os.IBinder.FIRST_CALL_TRANSACTION + 0);
    static final int TRANSACTION_getPrinterVersion = (android.os.IBinder.FIRST_CALL_TRANSACTION + 1);
    static final int TRANSACTION_getPrinterModel = (android.os.IBinder.FIRST_CALL_TRANSACTION + 2);
    static final int TRANSACTION_getPrinterStatus = (android.os.IBinder.FIRST_CALL_TRANSACTION + 3);
    static final int TRANSACTION_paperOut = (android.os.IBinder.FIRST_CALL_TRANSACTION + 4);
    static final int TRANSACTION_paperBack = (android.os.IBinder.FIRST_CALL_TRANSACTION + 5);
    static final int TRANSACTION_printText = (android.os.IBinder.FIRST_CALL_TRANSACTION + 6);
    static final int TRANSACTION_printText2 = (android.os.IBinder.FIRST_CALL_TRANSACTION + 7);
    static final int TRANSACTION_printBarcode = (android.os.IBinder.FIRST_CALL_TRANSACTION + 8);
    static final int TRANSACTION_printQrCode = (android.os.IBinder.FIRST_CALL_TRANSACTION + 9);
    static final int TRANSACTION_printBitmap = (android.os.IBinder.FIRST_CALL_TRANSACTION + 10);
    static final int TRANSACTION_labelLocate = (android.os.IBinder.FIRST_CALL_TRANSACTION + 11);
    static final int TRANSACTION_labelPrintEnd = (android.os.IBinder.FIRST_CALL_TRANSACTION + 12);
    static final int TRANSACTION_labelLocateAuto = (android.os.IBinder.FIRST_CALL_TRANSACTION + 13);
    static final int TRANSACTION_labelDetectAuto = (android.os.IBinder.FIRST_CALL_TRANSACTION + 14);
    static final int TRANSACTION_printEndAutoOut = (android.os.IBinder.FIRST_CALL_TRANSACTION + 15);
    static final int TRANSACTION_openCashBox = (android.os.IBinder.FIRST_CALL_TRANSACTION + 16);
    static final int TRANSACTION_triggerQscScan = (android.os.IBinder.FIRST_CALL_TRANSACTION + 17);
    static final int TRANSACTION_setLcdLogo = (android.os.IBinder.FIRST_CALL_TRANSACTION + 18);
    static final int TRANSACTION_getPrinterDensity = (android.os.IBinder.FIRST_CALL_TRANSACTION + 19);
    static final int TRANSACTION_setPrinterDensity = (android.os.IBinder.FIRST_CALL_TRANSACTION + 20);
    static final int TRANSACTION_setPaperWidth = (android.os.IBinder.FIRST_CALL_TRANSACTION + 21);
  }
  /** @hide */
  public static final java.lang.String DESCRIPTOR = "net.nyx.printerservice.print.IPrinterService";
  public java.lang.String getServiceVersion() throws android.os.RemoteException;
  public int getPrinterVersion(java.lang.String[] ver) throws android.os.RemoteException;
  public int getPrinterModel(java.lang.String[] model) throws android.os.RemoteException;
  public int getPrinterStatus() throws android.os.RemoteException;
  public int paperOut(int px) throws android.os.RemoteException;
  public int paperBack(int px) throws android.os.RemoteException;
  public int printText(java.lang.String text, net.nyx.printerservice.print.PrintTextFormat textFormat) throws android.os.RemoteException;
  public int printText2(java.lang.String text, net.nyx.printerservice.print.PrintTextFormat textFormat, int textWidth, int align) throws android.os.RemoteException;
  // barcode: symbology 0=CODE128,1=CODE39,...  textPosition 0=none,1=above,2=below  align 0=left,1=center,2=right
  public int printBarcode(java.lang.String content, int width, int height, int textPosition, int align, int symbology) throws android.os.RemoteException;
  // QR code: align 0=left,1=center,2=right
  public int printQrCode(java.lang.String content, int width, int height, int align) throws android.os.RemoteException;
  public int printBitmap(android.graphics.Bitmap bitmap, int type, int align) throws android.os.RemoteException;
  public int labelLocate(int labelHeight, int labelGap) throws android.os.RemoteException;
  public int labelPrintEnd() throws android.os.RemoteException;
  public int labelLocateAuto(int labelHeight, int labelGap) throws android.os.RemoteException;
  public int labelDetectAuto() throws android.os.RemoteException;
  // Auto paper feed and cut after printing
  public int printEndAutoOut() throws android.os.RemoteException;
  public int openCashBox() throws android.os.RemoteException;
  public int triggerQscScan(int opt) throws android.os.RemoteException;
  public int setLcdLogo(android.graphics.Bitmap bitmap) throws android.os.RemoteException;
  public int getPrinterDensity(int[] density) throws android.os.RemoteException;
  public int setPrinterDensity(int density) throws android.os.RemoteException;
  public int setPaperWidth(int width) throws android.os.RemoteException;
  /** @hide */
  static class _Parcel {
    static private <T> T readTypedObject(
        android.os.Parcel parcel,
        android.os.Parcelable.Creator<T> c) {
      if (parcel.readInt() != 0) {
          return c.createFromParcel(parcel);
      } else {
          return null;
      }
    }
    static private <T extends android.os.Parcelable> void writeTypedObject(
        android.os.Parcel parcel, T value, int parcelableFlags) {
      if (value != null) {
        parcel.writeInt(1);
        value.writeToParcel(parcel, parcelableFlags);
      } else {
        parcel.writeInt(0);
      }
    }
  }
}
