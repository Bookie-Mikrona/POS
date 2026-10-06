import java.io.File;
import javax.xml.XMLConstants;
import javax.xml.transform.stream.StreamSource;
import javax.xml.validation.SchemaFactory;

/** Offline test validation. Only bundled local XSD imports are allowed. */
public final class ValidateEdavkiXsd {
  public static void main(String[] args) throws Exception {
    SchemaFactory factory = SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI);
    factory.setProperty(XMLConstants.ACCESS_EXTERNAL_DTD, "");
    factory.setProperty(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "file");
    factory.newSchema(new File(args[0])).newValidator().validate(new StreamSource(new File(args[1])));
  }
}
