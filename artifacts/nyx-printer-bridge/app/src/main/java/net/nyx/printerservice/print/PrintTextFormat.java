// PAKET SE NE SME SPREMENITI — net.nyx.printerservice.print
// Vir: https://github.com/SZNoryox/PrinterClient (veja a13)
// Točna implementacija z vsemi polji in pravilnim vrstnim redom Parcelable serializacije.
package net.nyx.printerservice.print;

import android.os.Parcel;
import android.os.Parcelable;

/**
 * Oblikovanje besedila za NYX IPrinterService.printText().
 *
 * KRITIČNO: Vrstni red v writeToParcel/readFromParcel MORA ujemati s sistemskim servisom.
 * Vsako neskladje povzroči "attempt to invoke virtual method on a null object reference".
 *
 * Polja (po vrstnem redu serializacije):
 *   textSize      — velikost fonta v px (privzeto 24)
 *   underline     — podčrtano (privzeto false)
 *   textScaleX    — horizontalno skaliranje (privzeto 1.0)
 *   textScaleY    — vertikalno skaliranje (privzeto 1.0)
 *   letterSpacing — razmik med znaki (privzeto 0)
 *   lineSpacing   — razmik med vrsticami (privzeto 0)
 *   topPadding    — zgornji odmik (privzeto 0)
 *   leftPadding   — levi odmik (privzeto 0)
 *   ali           — poravnava: 0=levo, 1=sredina, 2=desno (privzeto 0)
 *   style         — stil: 0=normalno, 1=krepko, 2=ležeče, 3=krepko+ležeče (privzeto 0)
 *   font          — pisava: 0=privzeta, 4=MONOSPACE, 5=po meri (privzeto 0)
 *   path          — pot do pisave po meri (privzeto null → serializira kot prazen niz)
 */
public class PrintTextFormat implements Parcelable {

    private int textSize = 24;
    private boolean underline = false;
    private float textScaleX = 1.0f;
    private float textScaleY = 1.0f;
    private float letterSpacing = 0;
    private float lineSpacing = 0;
    private int topPadding = 0;
    private int leftPadding = 0;
    private int ali = 0;    // 0=LEFT, 1=CENTER, 2=RIGHT
    private int style = 0;  // 0=NORMAL, 1=BOLD, 2=ITALIC, 3=BOLD_ITALIC
    private int font = 0;   // 0=DEFAULT, 1=DEFAULT_BOLD, 2=SANS_SERIF, 3=SERIF, 4=MONOSPACE, 5=CUSTOM
    private String path;    // pot do pisave po meri (null = ne uporabljaj)

    public PrintTextFormat() {}

    // ── Getterji ──────────────────────────────────────────────────────────────

    public int getTextSize()        { return textSize; }
    public boolean isUnderline()    { return underline; }
    public float getTextScaleX()    { return textScaleX; }
    public float getTextScaleY()    { return textScaleY; }
    public float getLetterSpacing() { return letterSpacing; }
    public float getLineSpacing()   { return lineSpacing; }
    public int getTopPadding()      { return topPadding; }
    public int getLeftPadding()     { return leftPadding; }
    public int getAli()             { return ali; }
    public int getStyle()           { return style; }
    public int getFont()            { return font; }
    public String getPath()         { return path; }

    // ── Setterji ──────────────────────────────────────────────────────────────

    public void setTextSize(int textSize)             { this.textSize = textSize; }
    public void setUnderline(boolean underline)       { this.underline = underline; }
    public void setTextScaleX(float textScaleX)       { this.textScaleX = textScaleX; }
    public void setTextScaleY(float textScaleY)       { this.textScaleY = textScaleY; }
    public void setLetterSpacing(float letterSpacing) { this.letterSpacing = letterSpacing; }
    public void setLineSpacing(float lineSpacing)     { this.lineSpacing = lineSpacing; }
    public void setTopPadding(int topPadding)         { this.topPadding = topPadding; }
    public void setLeftPadding(int leftPadding)       { this.leftPadding = leftPadding; }
    public void setAli(int ali)                       { this.ali = ali; }
    public void setStyle(int style)                   { this.style = style; }
    public void setFont(int font)                     { this.font = font; }
    public void setPath(String path)                  { this.path = path; }

    // ── Parcelable ────────────────────────────────────────────────────────────
    // VRSTNI RED MORA BITI IDENTIČEN SISTEMU — ne premikajte polj!

    protected PrintTextFormat(Parcel in) {
        textSize      = in.readInt();
        underline     = in.readByte() != 0;
        textScaleX    = in.readFloat();
        textScaleY    = in.readFloat();
        letterSpacing = in.readFloat();
        lineSpacing   = in.readFloat();
        topPadding    = in.readInt();
        leftPadding   = in.readInt();
        ali           = in.readInt();
        style         = in.readInt();
        font          = in.readInt();
        path          = in.readString();
    }

    @Override
    public void writeToParcel(Parcel dest, int flags) {
        dest.writeInt(textSize);
        dest.writeByte((byte) (underline ? 1 : 0));
        dest.writeFloat(textScaleX);
        dest.writeFloat(textScaleY);
        dest.writeFloat(letterSpacing);
        dest.writeFloat(lineSpacing);
        dest.writeInt(topPadding);
        dest.writeInt(leftPadding);
        dest.writeInt(ali);
        dest.writeInt(style);
        dest.writeInt(font);
        // path je null → writeString piše null-safe (prazno)
        dest.writeString(path != null ? path : "");
    }

    @Override
    public int describeContents() { return 0; }

    public static final Creator<PrintTextFormat> CREATOR = new Creator<PrintTextFormat>() {
        @Override
        public PrintTextFormat createFromParcel(Parcel in) { return new PrintTextFormat(in); }

        @Override
        public PrintTextFormat[] newArray(int size) { return new PrintTextFormat[size]; }
    };
}
