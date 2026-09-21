package net.nyx.printerservice.print;

import android.os.Parcel;
import android.os.Parcelable;

public class PrintTextFormat implements Parcelable {

    private int textSize = 24;        // font size in px
    private boolean underline = false;
    private float textScaleX = 1.0f;
    private float textScaleY = 1.0f;
    private float letterSpacing = 0;
    private float lineSpacing = 0;
    private int topPadding = 0;
    private int leftPadding = 0;
    private int ali = 0;   // 0=LEFT, 1=CENTER, 2=RIGHT
    private int style = 0; // 0=NORMAL, 1=BOLD, 2=ITALIC, 3=BOLD_ITALIC
    private int font = 0;  // 0=DEFAULT, 1=DEFAULT_BOLD, 2=SANS_SERIF, 3=SERIF, 4=MONOSPACE, 5=CUSTOM
    private String path;   // custom font file path (public path required)

    public PrintTextFormat() {}

    public int getTextSize() { return textSize; }
    public void setTextSize(int textSize) { this.textSize = textSize; }

    public boolean isUnderline() { return underline; }
    public void setUnderline(boolean underline) { this.underline = underline; }

    public float getTextScaleX() { return textScaleX; }
    public void setTextScaleX(float textScaleX) { this.textScaleX = textScaleX; }

    public float getTextScaleY() { return textScaleY; }
    public void setTextScaleY(float textScaleY) { this.textScaleY = textScaleY; }

    public float getLetterSpacing() { return letterSpacing; }
    public void setLetterSpacing(float letterSpacing) { this.letterSpacing = letterSpacing; }

    public float getLineSpacing() { return lineSpacing; }
    public void setLineSpacing(float lineSpacing) { this.lineSpacing = lineSpacing; }

    public int getTopPadding() { return topPadding; }
    public void setTopPadding(int topPadding) { this.topPadding = topPadding; }

    public int getLeftPadding() { return leftPadding; }
    public void setLeftPadding(int leftPadding) { this.leftPadding = leftPadding; }

    public int getAli() { return ali; }
    public void setAli(int ali) { this.ali = ali; }

    public int getStyle() { return style; }
    public void setStyle(int style) { this.style = style; }

    public int getFont() { return font; }
    public void setFont(int font) { this.font = font; }

    public String getPath() { return path; }
    public void setPath(String path) { this.path = path; }

    protected PrintTextFormat(Parcel in) {
        textSize = in.readInt();
        underline = in.readByte() != 0;
        textScaleX = in.readFloat();
        textScaleY = in.readFloat();
        letterSpacing = in.readFloat();
        lineSpacing = in.readFloat();
        topPadding = in.readInt();
        leftPadding = in.readInt();
        ali = in.readInt();
        style = in.readInt();
        font = in.readInt();
        path = in.readString();
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
