/*
 * This file is auto-generated.  DO NOT MODIFY.
 * Using: /nix/store/1m0wfsd7m2wl1yl3q6ddb5q00h8bzn48-android-sdk-build-tools-36.0.0/libexec/android-sdk/build-tools/36.0.0/aidl -p/nix/store/6q9y0sdi9v94sdm9qsrw8gc20ay9vsm2-android-sdk-platforms-36/libexec/android-sdk/platforms/android-36/framework.aidl -o/home/runner/workspace/artifacts/zcs-printer-bridge/app/build/generated/aidl_source_output_dir/debug/out -I/home/runner/workspace/artifacts/zcs-printer-bridge/app/src/main/aidl -I/home/runner/workspace/artifacts/zcs-printer-bridge/app/src/debug/aidl -I/home/runner/.gradle/caches/8.14.2/transforms/80fdad1f1d6fbf230ed0ca26cf119d6b/transformed/core-1.13.1/aidl -I/home/runner/.gradle/caches/8.14.2/transforms/aa1b272eedeeffa588298072f3a66a5d/transformed/versionedparcelable-1.1.1/aidl -d/tmp/aidl2474416434571677706.d /home/runner/workspace/artifacts/zcs-printer-bridge/app/src/main/aidl/com/zcs/android/aidl/printer/IBasePrinter.aidl
 *
 * DO NOT CHECK THIS FILE INTO A CODE TREE (e.g. git, etc..).
 * ALWAYS GENERATE THIS FILE FROM UPDATED AIDL COMPILER
 * AS A BUILD INTERMEDIATE ONLY. THIS IS NOT SOURCE CODE.
 */
package com.zcs.android.aidl.printer;
public interface IBasePrinter extends android.os.IInterface
{
  /** Default implementation for IBasePrinter. */
  public static class Default implements com.zcs.android.aidl.printer.IBasePrinter
  {
    /** Nastavi hitrost tiskanja (0=normalno, 1=hitro) */
    @Override public void setPrinterPrintDepth(int depth) throws android.os.RemoteException
    {
    }
    /** Pošlji surove ESC/POS ukaze */
    @Override public void sendUserCmdData(byte[] data) throws android.os.RemoteException
    {
    }
    /** Tiskaj besedilo */
    @Override public void printRawData(byte[] data, int length) throws android.os.RemoteException
    {
    }
    /** Status tiskalnika (0=OK, 1=papir zmanjka, 2=pregretje) */
    @Override public int getPrinterStatus() throws android.os.RemoteException
    {
      return 0;
    }
    /** Odreži papir */
    @Override public void cutPaper(int mode) throws android.os.RemoteException
    {
    }
    @Override
    public android.os.IBinder asBinder() {
      return null;
    }
  }
  /** Local-side IPC implementation stub class. */
  public static abstract class Stub extends android.os.Binder implements com.zcs.android.aidl.printer.IBasePrinter
  {
    /** Construct the stub and attach it to the interface. */
    @SuppressWarnings("this-escape")
    public Stub()
    {
      this.attachInterface(this, DESCRIPTOR);
    }
    /**
     * Cast an IBinder object into an com.zcs.android.aidl.printer.IBasePrinter interface,
     * generating a proxy if needed.
     */
    public static com.zcs.android.aidl.printer.IBasePrinter asInterface(android.os.IBinder obj)
    {
      if ((obj==null)) {
        return null;
      }
      android.os.IInterface iin = obj.queryLocalInterface(DESCRIPTOR);
      if (((iin!=null)&&(iin instanceof com.zcs.android.aidl.printer.IBasePrinter))) {
        return ((com.zcs.android.aidl.printer.IBasePrinter)iin);
      }
      return new com.zcs.android.aidl.printer.IBasePrinter.Stub.Proxy(obj);
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
        case TRANSACTION_setPrinterPrintDepth:
        {
          int _arg0;
          _arg0 = data.readInt();
          this.setPrinterPrintDepth(_arg0);
          reply.writeNoException();
          break;
        }
        case TRANSACTION_sendUserCmdData:
        {
          byte[] _arg0;
          _arg0 = data.createByteArray();
          this.sendUserCmdData(_arg0);
          reply.writeNoException();
          break;
        }
        case TRANSACTION_printRawData:
        {
          byte[] _arg0;
          _arg0 = data.createByteArray();
          int _arg1;
          _arg1 = data.readInt();
          this.printRawData(_arg0, _arg1);
          reply.writeNoException();
          break;
        }
        case TRANSACTION_getPrinterStatus:
        {
          int _result = this.getPrinterStatus();
          reply.writeNoException();
          reply.writeInt(_result);
          break;
        }
        case TRANSACTION_cutPaper:
        {
          int _arg0;
          _arg0 = data.readInt();
          this.cutPaper(_arg0);
          reply.writeNoException();
          break;
        }
        default:
        {
          return super.onTransact(code, data, reply, flags);
        }
      }
      return true;
    }
    private static class Proxy implements com.zcs.android.aidl.printer.IBasePrinter
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
      /** Nastavi hitrost tiskanja (0=normalno, 1=hitro) */
      @Override public void setPrinterPrintDepth(int depth) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeInt(depth);
          boolean _status = mRemote.transact(Stub.TRANSACTION_setPrinterPrintDepth, _data, _reply, 0);
          _reply.readException();
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
      }
      /** Pošlji surove ESC/POS ukaze */
      @Override public void sendUserCmdData(byte[] data) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeByteArray(data);
          boolean _status = mRemote.transact(Stub.TRANSACTION_sendUserCmdData, _data, _reply, 0);
          _reply.readException();
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
      }
      /** Tiskaj besedilo */
      @Override public void printRawData(byte[] data, int length) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeByteArray(data);
          _data.writeInt(length);
          boolean _status = mRemote.transact(Stub.TRANSACTION_printRawData, _data, _reply, 0);
          _reply.readException();
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
      }
      /** Status tiskalnika (0=OK, 1=papir zmanjka, 2=pregretje) */
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
      /** Odreži papir */
      @Override public void cutPaper(int mode) throws android.os.RemoteException
      {
        android.os.Parcel _data = android.os.Parcel.obtain();
        android.os.Parcel _reply = android.os.Parcel.obtain();
        try {
          _data.writeInterfaceToken(DESCRIPTOR);
          _data.writeInt(mode);
          boolean _status = mRemote.transact(Stub.TRANSACTION_cutPaper, _data, _reply, 0);
          _reply.readException();
        }
        finally {
          _reply.recycle();
          _data.recycle();
        }
      }
    }
    static final int TRANSACTION_setPrinterPrintDepth = (android.os.IBinder.FIRST_CALL_TRANSACTION + 0);
    static final int TRANSACTION_sendUserCmdData = (android.os.IBinder.FIRST_CALL_TRANSACTION + 1);
    static final int TRANSACTION_printRawData = (android.os.IBinder.FIRST_CALL_TRANSACTION + 2);
    static final int TRANSACTION_getPrinterStatus = (android.os.IBinder.FIRST_CALL_TRANSACTION + 3);
    static final int TRANSACTION_cutPaper = (android.os.IBinder.FIRST_CALL_TRANSACTION + 4);
  }
  /** @hide */
  public static final java.lang.String DESCRIPTOR = "com.zcs.android.aidl.printer.IBasePrinter";
  /** Nastavi hitrost tiskanja (0=normalno, 1=hitro) */
  public void setPrinterPrintDepth(int depth) throws android.os.RemoteException;
  /** Pošlji surove ESC/POS ukaze */
  public void sendUserCmdData(byte[] data) throws android.os.RemoteException;
  /** Tiskaj besedilo */
  public void printRawData(byte[] data, int length) throws android.os.RemoteException;
  /** Status tiskalnika (0=OK, 1=papir zmanjka, 2=pregretje) */
  public int getPrinterStatus() throws android.os.RemoteException;
  /** Odreži papir */
  public void cutPaper(int mode) throws android.os.RemoteException;
}
