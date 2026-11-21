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
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * HTML -> PDF using Chromium layout (vector text, correct Devanagari shaping).
 * Never logs the HTML (it is meeting text).
 *
 * Each call gets its own Job so a stale callback from a timed-out call can never
 * settle or tear down a newer call.
 */
@CapacitorPlugin(name = "DocumentExport")
public class DocumentExportPlugin extends Plugin {
    private static final long TIMEOUT_MS = 90_000;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final AtomicBoolean busy = new AtomicBoolean(false);
    private final AtomicBoolean printBusy = new AtomicBoolean(false);
    // Print-dialog views stay alive until plugin destroy: the system print job reads them.
    private final List<WebView> printViews = new ArrayList<>();

    private static void configure(WebView wv) {
        wv.getSettings().setJavaScriptEnabled(false);
        wv.getSettings().setAllowFileAccess(false);
        wv.getSettings().setAllowContentAccess(false);
    }

    /** State for one htmlToPdf call. */
    private final class Job {
        final PluginCall call;
        final File out;
        final AtomicBoolean settled = new AtomicBoolean(false);
        boolean pageHandled = false;
        WebView renderView;
        ParcelFileDescriptor fd;
        PrintDocumentAdapter adapter;
        CancellationSignal layoutSignal;
        CancellationSignal writeSignal;
        Runnable timeout;

        Job(PluginCall call, File out) {
            this.call = call;
            this.out = out;
        }

        void closeFd() {
            try {
                if (fd != null) fd.close();
            } catch (IOException ignored) {
            }
            fd = null;
        }

        void succeed(String uri) {
            if (!settled.compareAndSet(false, true)) return;
            JSObject r = new JSObject();
            r.put("uri", uri);
            call.resolve(r);
            cleanup(false);
        }

        void fail(String message, String code) {
            if (!settled.compareAndSet(false, true)) return;
            call.reject(message, code);
            cleanup(true);
        }

        void cleanup(final boolean failed) {
            main.post(new Runnable() {
                @Override
                public void run() {
                    if (timeout != null) main.removeCallbacks(timeout);
                    timeout = null;
                    if (failed) {
                        if (layoutSignal != null) {
                            try {
                                layoutSignal.cancel();
                            } catch (Throwable ignored) {
                            }
                        }
                        if (writeSignal != null) {
                            try {
                                writeSignal.cancel();
                            } catch (Throwable ignored) {
                            }
                        }
                    }
                    closeFd();
                    if (adapter != null) {
                        try {
                            adapter.onFinish();
                        } catch (Throwable ignored) {
                        }
                    }
                    if (failed) {
                        //noinspection ResultOfMethodCallIgnored
                        out.delete();
                    }
                    if (renderView != null) {
                        try {
                            renderView.destroy();
                        } catch (Throwable ignored) {
                        }
                        renderView = null;
                    }
                    busy.set(false);
                }
            });
        }
    }

    @PluginMethod
    public void htmlToPdf(final PluginCall call) {
        final String html = call.getString("html");
        final String fileName = call.getString("fileName");
        if (html == null || fileName == null) {
            call.reject("html and fileName are required", "BAD_ARGS");
            return;
        }
        if (getActivity() == null) {
            call.reject("No activity", "IO");
            return;
        }
        if (!busy.compareAndSet(false, true)) {
            call.reject("Another export is running", "BUSY");
            return;
        }
        String safe = fileName.replaceAll("[^A-Za-z0-9._-]", "_");
        if (!safe.toLowerCase().endsWith(".pdf")) safe = safe + ".pdf";
        final String safeName = safe;

        try {
            getActivity().runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    final File dir = new File(getContext().getCacheDir(), "exports");
                    //noinspection ResultOfMethodCallIgnored
                    dir.mkdirs();
                    final Job job = new Job(call, new File(dir, safeName));
                    try {
                        job.timeout = new Runnable() {
                            @Override
                            public void run() {
                                job.fail("Export timed out", "TIMEOUT");
                            }
                        };
                        main.postDelayed(job.timeout, TIMEOUT_MS);

                        job.renderView = new WebView(getContext());
                        configure(job.renderView);
                        job.renderView.setWebViewClient(new WebViewClient() {
                            @Override
                            public void onPageFinished(final WebView view, String url) {
                                if (job.pageHandled) return;
                                job.pageHandled = true;
                                view.postVisualStateCallback(1, new WebView.VisualStateCallback() {
                                    @Override
                                    public void onComplete(long requestId) {
                                        startPrint(job, view);
                                    }
                                });
                            }
                        });
                        job.renderView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
                    } catch (Throwable t) {
                        job.fail("Could not start export", "IO");
                    }
                }
            });
        } catch (Throwable t) {
            busy.set(false);
            call.reject("Could not start export", "IO");
        }
    }

    private void startPrint(final Job job, WebView view) {
        if (job.settled.get()) return;
        try {
            final PrintDocumentAdapter adapter = view.createPrintDocumentAdapter("Transcriber export");
            job.adapter = adapter;
            final PrintAttributes attrs = new PrintAttributes.Builder()
                    .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                    .setResolution(new PrintAttributes.Resolution("pdf", "pdf", 300, 300))
                    .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                    .build();
            adapter.onStart();
            job.layoutSignal = new CancellationSignal();
            adapter.onLayout(null, attrs, job.layoutSignal, new PdfPrintCallbacks.Layout() {
                @Override
                public void onLayoutFinished(PrintDocumentInfo info, boolean changed) {
                    if (job.settled.get()) return;
                    try {
                        job.fd = ParcelFileDescriptor.open(job.out,
                                ParcelFileDescriptor.MODE_CREATE
                                        | ParcelFileDescriptor.MODE_TRUNCATE
                                        | ParcelFileDescriptor.MODE_READ_WRITE);
                        job.writeSignal = new CancellationSignal();
                        adapter.onWrite(new PageRange[]{PageRange.ALL_PAGES}, job.fd,
                                job.writeSignal, new PdfPrintCallbacks.Write() {
                                    @Override
                                    public void onWriteFinished(PageRange[] pages) {
                                        job.succeed(Uri.fromFile(job.out).toString());
                                    }

                                    @Override
                                    public void onWriteFailed(CharSequence error) {
                                        job.fail("PDF write failed", "WRITE_FAILED");
                                    }

                                    @Override
                                    public void onWriteCancelled() {
                                        job.fail("PDF write cancelled", "CANCELLED");
                                    }
                                });
                    } catch (IOException e) {
                        job.fail("Could not open output file", "IO");
                    } catch (Throwable t) {
                        job.fail("Print shim failed", "SHIM_FAILED");
                    }
                }

                @Override
                public void onLayoutFailed(CharSequence error) {
                    job.fail("PDF layout failed", "LAYOUT_FAILED");
                }

                @Override
                public void onLayoutCancelled() {
                    job.fail("PDF layout cancelled", "CANCELLED");
                }
            }, new Bundle());
        } catch (Throwable t) {
            job.fail("Print shim failed", "SHIM_FAILED");
        }
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
        if (getActivity() == null) {
            call.reject("No activity", "IO");
            return;
        }
        if (!printBusy.compareAndSet(false, true)) {
            call.reject("Another print is running", "BUSY");
            return;
        }
        final AtomicBoolean settled = new AtomicBoolean(false);
        final Runnable[] timeout = new Runnable[1];
        final Runnable release = new Runnable() {
            @Override
            public void run() {
                if (timeout[0] != null) main.removeCallbacks(timeout[0]);
                printBusy.set(false);
            }
        };
        try {
            getActivity().runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        final WebView wv = new WebView(getContext());
                        synchronized (printViews) {
                            printViews.add(wv);
                        }
                        configure(wv);
                        timeout[0] = new Runnable() {
                            @Override
                            public void run() {
                                if (!settled.compareAndSet(false, true)) return;
                                call.reject("Print timed out", "TIMEOUT");
                                release.run();
                            }
                        };
                        main.postDelayed(timeout[0], TIMEOUT_MS);
                        wv.setWebViewClient(new WebViewClient() {
                            private boolean done = false;

                            @Override
                            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                                if (request != null && !request.isForMainFrame()) return;
                                if (!settled.compareAndSet(false, true)) return;
                                call.reject("Could not load print content", "IO");
                                release.run();
                            }

                            @Override
                            public void onPageFinished(WebView view, String url) {
                                if (done) return;
                                done = true;
                                if (!settled.compareAndSet(false, true)) return;
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
                                release.run();
                            }
                        });
                        wv.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
                    } catch (Throwable t) {
                        if (settled.compareAndSet(false, true)) {
                            call.reject("Could not open print dialog", "IO");
                            release.run();
                        }
                    }
                }
            });
        } catch (Throwable t) {
            printBusy.set(false);
            call.reject("Could not open print dialog", "IO");
        }
    }

    @Override
    protected void handleOnDestroy() {
        synchronized (printViews) {
            for (WebView wv : printViews) {
                try {
                    wv.destroy();
                } catch (Throwable ignored) {
                }
            }
            printViews.clear();
        }
        super.handleOnDestroy();
    }
}
