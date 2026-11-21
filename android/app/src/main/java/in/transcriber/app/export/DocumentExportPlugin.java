package in.transcriber.app.export;

import android.content.Context;
import android.net.Uri;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PdfPrintCallbacks;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.IOException;

/**
 * HTML -> PDF using Chromium layout (vector text, correct Devanagari shaping).
 * Never logs the HTML (it is meeting text).
 */
@CapacitorPlugin(name = "DocumentExport")
public class DocumentExportPlugin extends Plugin {
    private static final long TIMEOUT_MS = 90_000;

    private final Handler main = new Handler(Looper.getMainLooper());
    private boolean busy = false;
    private boolean settled = false;
    private boolean pageHandled = false;
    private WebView renderView;
    private WebView printView;
    private Runnable timeoutRunnable;
    private ParcelFileDescriptor openFd;

    private static void configure(WebView wv) {
        wv.getSettings().setJavaScriptEnabled(false);
        wv.getSettings().setAllowFileAccess(false);
        wv.getSettings().setAllowContentAccess(false);
    }

    @PluginMethod
    public void htmlToPdf(final PluginCall call) {
        final String html = call.getString("html");
        final String fileName = call.getString("fileName");
        if (html == null || fileName == null) {
            call.reject("html and fileName are required", "BAD_ARGS");
            return;
        }
        synchronized (this) {
            if (busy) {
                call.reject("Another export is running", "BUSY");
                return;
            }
            busy = true;
            settled = false;
            pageHandled = false;
        }
        String safe = fileName.replaceAll("[^A-Za-z0-9._-]", "_");
        if (!safe.toLowerCase().endsWith(".pdf")) safe = safe + ".pdf";
        final String safeName = safe;

        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    final File dir = new File(getContext().getCacheDir(), "exports");
                    //noinspection ResultOfMethodCallIgnored
                    dir.mkdirs();
                    final File out = new File(dir, safeName);

                    timeoutRunnable = new Runnable() {
                        @Override
                        public void run() {
                            fail(call, "Export timed out", "TIMEOUT");
                        }
                    };
                    main.postDelayed(timeoutRunnable, TIMEOUT_MS);

                    renderView = new WebView(getContext());
                    configure(renderView);
                    renderView.setWebViewClient(new WebViewClient() {
                        @Override
                        public void onPageFinished(final WebView view, String url) {
                            if (pageHandled) return;
                            pageHandled = true;
                            view.postVisualStateCallback(1, new WebView.VisualStateCallback() {
                                @Override
                                public void onComplete(long requestId) {
                                    startPrint(view, out, call);
                                }
                            });
                        }
                    });
                    renderView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
                } catch (Throwable t) {
                    fail(call, "Could not start export", "IO");
                }
            }
        });
    }

    private void startPrint(WebView view, final File out, final PluginCall call) {
        try {
            final PrintDocumentAdapter adapter = view.createPrintDocumentAdapter("Transcriber export");
            final PrintAttributes attrs = new PrintAttributes.Builder()
                    .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                    .setResolution(new PrintAttributes.Resolution("pdf", "pdf", 300, 300))
                    .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                    .build();
            adapter.onStart();
            adapter.onLayout(null, attrs, new CancellationSignal(), new PdfPrintCallbacks.Layout() {
                @Override
                public void onLayoutFinished(PrintDocumentInfo info, boolean changed) {
                    try {
                        openFd = ParcelFileDescriptor.open(out,
                                ParcelFileDescriptor.MODE_CREATE
                                        | ParcelFileDescriptor.MODE_TRUNCATE
                                        | ParcelFileDescriptor.MODE_READ_WRITE);
                        adapter.onWrite(new PageRange[]{PageRange.ALL_PAGES}, openFd,
                                new CancellationSignal(), new PdfPrintCallbacks.Write() {
                                    @Override
                                    public void onWriteFinished(PageRange[] pages) {
                                        closeFd();
                                        try {
                                            adapter.onFinish();
                                        } catch (Throwable ignored) {
                                        }
                                        succeed(call, Uri.fromFile(out).toString());
                                    }

                                    @Override
                                    public void onWriteFailed(CharSequence error) {
                                        closeFd();
                                        fail(call, "PDF write failed", "WRITE_FAILED");
                                    }

                                    @Override
                                    public void onWriteCancelled() {
                                        closeFd();
                                        fail(call, "PDF write cancelled", "CANCELLED");
                                    }
                                });
                    } catch (IOException e) {
                        closeFd();
                        fail(call, "Could not open output file", "IO");
                    } catch (Throwable t) {
                        closeFd();
                        fail(call, "Print shim failed", "SHIM_FAILED");
                    }
                }

                @Override
                public void onLayoutFailed(CharSequence error) {
                    fail(call, "PDF layout failed", "LAYOUT_FAILED");
                }

                @Override
                public void onLayoutCancelled() {
                    fail(call, "PDF layout cancelled", "CANCELLED");
                }
            }, new Bundle());
        } catch (Throwable t) {
            fail(call, "Print shim failed", "SHIM_FAILED");
        }
    }

    private void closeFd() {
        try {
            if (openFd != null) openFd.close();
        } catch (IOException ignored) {
        }
        openFd = null;
    }

    private void succeed(PluginCall call, String uri) {
        if (!markSettled()) return;
        JSObject r = new JSObject();
        r.put("uri", uri);
        call.resolve(r);
        cleanup();
    }

    private void fail(PluginCall call, String message, String code) {
        if (!markSettled()) return;
        call.reject(message, code);
        cleanup();
    }

    private synchronized boolean markSettled() {
        if (settled) return false;
        settled = true;
        return true;
    }

    private void cleanup() {
        main.post(new Runnable() {
            @Override
            public void run() {
                if (timeoutRunnable != null) main.removeCallbacks(timeoutRunnable);
                timeoutRunnable = null;
                if (renderView != null) {
                    try {
                        renderView.destroy();
                    } catch (Throwable ignored) {
                    }
                    renderView = null;
                }
                synchronized (DocumentExportPlugin.this) {
                    busy = false;
                }
            }
        });
    }

    // D-03 fallback: system print dialog (user picks "Save as PDF").
    @PluginMethod
    public void printHtml(final PluginCall call) {
        final String html = call.getString("html");
        final String jobName = call.getString("jobName");
        if (html == null || jobName == null) {
            call.reject("html and jobName are required", "BAD_ARGS");
            return;
        }
        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    if (printView != null) {
                        try {
                            printView.destroy();
                        } catch (Throwable ignored) {
                        }
                    }
                    final WebView wv = new WebView(getContext());
                    printView = wv;
                    configure(wv);
                    wv.setWebViewClient(new WebViewClient() {
                        private boolean done = false;

                        @Override
                        public void onPageFinished(WebView view, String url) {
                            if (done) return;
                            done = true;
                            try {
                                PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                                pm.print(jobName, view.createPrintDocumentAdapter(jobName),
                                        new PrintAttributes.Builder()
                                                .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                                                .build());
                                JSObject r = new JSObject();
                                r.put("started", true);
                                call.resolve(r);
                            } catch (Throwable t) {
                                call.reject("Could not open print dialog", "IO");
                            }
                        }
                    });
                    wv.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
                } catch (Throwable t) {
                    call.reject("Could not open print dialog", "IO");
                }
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        try {
            if (renderView != null) renderView.destroy();
        } catch (Throwable ignored) {
        }
        try {
            if (printView != null) printView.destroy();
        } catch (Throwable ignored) {
        }
        renderView = null;
        printView = null;
        super.handleOnDestroy();
    }
}
