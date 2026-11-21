package android.print;

/**
 * The SDK declares LayoutResultCallback / WriteResultCallback constructors package-private.
 * Subclassing them from inside package android.print makes them usable (same shim expo-print ships).
 */
public final class PdfPrintCallbacks {
    private PdfPrintCallbacks() {}

    public abstract static class Layout extends PrintDocumentAdapter.LayoutResultCallback {}

    public abstract static class Write extends PrintDocumentAdapter.WriteResultCallback {}
}
