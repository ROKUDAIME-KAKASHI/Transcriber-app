package in.transcriber.app.recorder;

import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.util.ArrayDeque;

/**
 * Audio recorded but not yet sent to Deepgram, oldest first.
 *
 * Normally it holds a fraction of a second. When the internet drops, audio keeps piling up: the
 * first ~65 s stay in memory, and beyond that they spill to a file in the app's cache, up to
 * MAX_FILE_BYTES (4 hours). When the connection is back, the sender drains it all, so the words
 * spoken while offline still end up in the transcript.
 *
 * Order is always: unread file bytes (older), then the memory queue (newer).
 */
final class AudioBacklog {
    private static final int MAX_MEMORY_BYTES = 2 * 1024 * 1024;
    private static final long MAX_FILE_BYTES = 4L * 3600 * RecordingService.BYTES_PER_SECOND;

    private final File file;
    private final ArrayDeque<byte[]> memory = new ArrayDeque<>();
    private int memoryBytes;
    private RandomAccessFile raf;
    private long fileLength;
    private long readPos;
    private boolean lastFromFile;
    private long droppedBytes;

    AudioBacklog(File file) {
        this.file = file;
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }

    synchronized void add(byte[] chunk) {
        memory.addLast(chunk);
        memoryBytes += chunk.length;
        if (memoryBytes > MAX_MEMORY_BYTES) spill();
        notifyAll();
    }

    /** Moves the memory queue to the end of the file. */
    private void spill() {
        try {
            if (raf == null) raf = new RandomAccessFile(file, "rw");
            raf.seek(fileLength);
            for (byte[] c : memory) {
                if (fileLength + c.length > MAX_FILE_BYTES) {
                    droppedBytes += c.length; // offline for over 4 hours: newest audio is lost
                    continue;
                }
                raf.write(c);
                fileLength += c.length;
            }
        } catch (IOException e) {
            droppedBytes += memoryBytes; // storage full
        }
        memory.clear();
        memoryBytes = 0;
    }

    /** The oldest audio (at most maxBytes), waiting up to waitMs for some to arrive; null if none. */
    synchronized byte[] poll(int maxBytes, long waitMs) {
        if (isEmptyLocked() && waitMs > 0) {
            try {
                wait(waitMs);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return null;
            }
        }
        if (raf != null && readPos < fileLength) {
            int n = (int) Math.min(maxBytes, fileLength - readPos);
            n -= n % 2; // whole 16-bit samples
            byte[] out = new byte[n];
            try {
                raf.seek(readPos);
                raf.readFully(out);
                readPos += n;
                lastFromFile = true;
                if (readPos >= fileLength) resetFile();
                return out;
            } catch (IOException e) {
                // Unreadable spool: skip it rather than stall the meeting, and go on with memory.
                droppedBytes += fileLength - readPos;
                resetFile();
            }
        }
        byte[] c = memory.pollFirst();
        if (c != null) memoryBytes -= c.length;
        lastFromFile = false;
        return c;
    }

    /** Puts back a chunk that could not be sent, so it goes out first next time. */
    synchronized void unread(byte[] chunk) {
        if (lastFromFile && raf != null && readPos >= chunk.length) {
            readPos -= chunk.length;
        } else {
            memory.addFirst(chunk);
            memoryBytes += chunk.length;
        }
        lastFromFile = false;
        notifyAll();
    }

    private void resetFile() {
        try {
            if (raf != null) raf.setLength(0);
        } catch (IOException ignored) {
        }
        fileLength = 0;
        readPos = 0;
    }

    private boolean isEmptyLocked() {
        return memory.isEmpty() && (raf == null || readPos >= fileLength);
    }

    synchronized boolean isEmpty() {
        return isEmptyLocked();
    }

    /** Seconds of audio waiting to be sent. */
    synchronized double seconds() {
        long bytes = memoryBytes + (raf == null ? 0 : fileLength - readPos);
        return bytes / (double) RecordingService.BYTES_PER_SECOND;
    }

    synchronized double droppedSeconds() {
        return droppedBytes / (double) RecordingService.BYTES_PER_SECOND;
    }

    synchronized void clear() {
        memory.clear();
        memoryBytes = 0;
        resetFile();
        notifyAll();
    }

    synchronized void close() {
        clear();
        try {
            if (raf != null) raf.close();
        } catch (IOException ignored) {
        }
        raf = null;
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }
}
