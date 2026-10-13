package com.locus.app;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.WindowManager;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.regex.Pattern;

/**
 * The Floor 7 walk recorder's storage, for the LOCUS Test app only (this file is in the
 * `sidetest` source set, so no other build contains it). Writes each recording into
 * files/recordings/<id>/, shares its files through the system share sheet, copies them to
 * Downloads/LOCUS, and keeps the screen on while a recording runs. It stores whatever the
 * JavaScript gives it and sends nothing over the network.
 */
@CapacitorPlugin(name = "Recorder")
public class RecorderPlugin extends Plugin {
    // One path segment, not starting with a dot, no slashes: a name can never leave the folder.
    private static final Pattern SAFE = Pattern.compile("^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$");

    private File root() {
        File dir = new File(getContext().getFilesDir(), "recordings");
        dir.mkdirs();
        return dir;
    }

    private File folder(String id, boolean create) {
        if (id == null || !SAFE.matcher(id).matches()) return null;
        File dir = new File(root(), id);
        if (create) dir.mkdirs();
        return dir;
    }

    private File file(PluginCall call, boolean create) {
        File dir = folder(call.getString("dir"), create);
        String name = call.getString("name");
        if (dir == null || name == null || !SAFE.matcher(name).matches()) return null;
        return new File(dir, name);
    }

    @PluginMethod
    public void writeFile(PluginCall call) {
        File target = file(call, true);
        String content = call.getString("content");
        if (target == null || content == null) { call.reject("BAD_ARGUMENT"); return; }
        // Write to a temporary name and rename, so a crash mid-save never leaves half a file.
        File temp = new File(target.getParentFile(), target.getName() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(temp)) {
            out.write(content.getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        } catch (IOException e) { call.reject("WRITE_FAILED", e); return; }
        if (!temp.renameTo(target)) {
            target.delete();
            if (!temp.renameTo(target)) { call.reject("WRITE_FAILED"); return; }
        }
        call.resolve();
    }

    @PluginMethod
    public void readFile(PluginCall call) {
        File target = file(call, false);
        if (target == null || !target.isFile()) { call.reject("NOT_FOUND"); return; }
        try {
            JSObject out = new JSObject();
            out.put("content", new String(Files.readAllBytes(target.toPath()), StandardCharsets.UTF_8));
            call.resolve(out);
        } catch (IOException e) { call.reject("READ_FAILED", e); }
    }

    @PluginMethod
    public void listRecordings(PluginCall call) {
        JSArray list = new JSArray();
        File[] dirs = root().listFiles(File::isDirectory);
        if (dirs != null) {
            Arrays.sort(dirs);
            for (File d : dirs) {
                JSObject one = new JSObject();
                one.put("id", d.getName());
                JSArray names = new JSArray();
                File[] files = d.listFiles(f -> f.isFile() && !f.getName().endsWith(".tmp"));
                if (files != null) for (File f : files) names.put(f.getName());
                one.put("files", names);
                list.put(one);
            }
        }
        JSObject out = new JSObject();
        out.put("recordings", list);
        call.resolve(out);
    }

    @PluginMethod
    public void deleteRecording(PluginCall call) {
        File dir = folder(call.getString("dir"), false);
        if (dir == null) { call.reject("BAD_ARGUMENT"); return; }
        File[] files = dir.listFiles();
        if (files != null) for (File f : files) f.delete();
        dir.delete();
        call.resolve();
    }

    private ArrayList<File> named(PluginCall call) {
        File dir = folder(call.getString("dir"), false);
        JSArray names = call.getArray("names");
        ArrayList<File> out = new ArrayList<>();
        if (dir == null || names == null) return null;
        try {
            for (int i = 0; i < names.length(); i++) {
                String n = names.getString(i);
                if (!SAFE.matcher(n).matches()) return null;
                File f = new File(dir, n);
                if (f.isFile()) out.add(f);
            }
        } catch (Exception e) { return null; }
        return out;
    }

    @PluginMethod
    public void shareRecording(PluginCall call) {
        ArrayList<File> files = named(call);
        if (files == null || files.isEmpty()) { call.reject("NOT_FOUND"); return; }
        try {
            ArrayList<Uri> uris = new ArrayList<>();
            for (File f : files) {
                uris.add(FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".recordings", f));
            }
            Intent send = new Intent(Intent.ACTION_SEND_MULTIPLE);
            send.setType("text/*");
            send.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
            send.putExtra(Intent.EXTRA_SUBJECT, "LOCUS Floor 7 walk recording");
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, "Share the walk recording");
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(chooser);
            call.resolve();
        } catch (Exception e) { call.reject("SHARE_FAILED", e); }
    }

    @PluginMethod
    public void saveToDownloads(PluginCall call) {
        ArrayList<File> files = named(call);
        if (files == null || files.isEmpty()) { call.reject("NOT_FOUND"); return; }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) { call.reject("UNSUPPORTED"); return; }
        ContentResolver resolver = getContext().getContentResolver();
        String folder = Environment.DIRECTORY_DOWNLOADS + "/LOCUS";
        int saved = 0;
        try {
            for (File f : files) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, f.getName());
                values.put(MediaStore.MediaColumns.MIME_TYPE, f.getName().endsWith(".csv") ? "text/csv" : "text/plain");
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, folder);
                Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) continue;
                try (OutputStream out = resolver.openOutputStream(uri)) {
                    if (out != null) { out.write(Files.readAllBytes(f.toPath())); saved++; }
                }
            }
        } catch (Exception e) { call.reject("SAVE_FAILED", e); return; }
        JSObject out = new JSObject();
        out.put("saved", saved);
        call.resolve(out);
    }

    @PluginMethod
    public void keepScreenOn(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }
}
