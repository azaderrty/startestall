package com.xsiloflex.startestall.wifi;

import android.content.Context;
import android.os.RemoteException;
import android.util.Log;

import androidx.annotation.Keep;

import com.xsiloflex.startestall.shizuku.IUserService;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.concurrent.TimeUnit;

/**
 * Shizuku user service. It is spawned by the Shizuku server as a separate process
 * running with the identity of the shell user (uid 2000) or root, which is what
 * allows us to run privileged shell commands such as `cmd wifi connect-network`.
 */
public class ShellUserService extends IUserService.Stub {

    private static final String TAG = "StarTestAllShell";

    public ShellUserService() {
        Log.i(TAG, "user service created");
    }

    @Keep
    public ShellUserService(Context context) {
        Log.i(TAG, "user service created with context: " + context);
    }

    @Override
    public void destroy() {
        Log.i(TAG, "user service destroyed");
        System.exit(0);
    }

    @Override
    public void exit() {
        destroy();
    }

    @Override
    public String execute(String command) throws RemoteException {
        StringBuilder out = new StringBuilder();
        int code = -1;
        Process process = null;
        try {
            ProcessBuilder builder = new ProcessBuilder("/system/bin/sh", "-c", command);
            builder.redirectErrorStream(true);
            process = builder.start();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    out.append(line).append('\n');
                }
            }
            if (!process.waitFor(30, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                out.append("[TIMEOUT]\n");
            }
            code = process.exitValue();
        } catch (Throwable t) {
            out.append("[ERROR] ").append(t.getClass().getSimpleName()).append(": ").append(t.getMessage()).append('\n');
        } finally {
            if (process != null) {
                process.destroy();
            }
        }
        return "exit=" + code + "\n" + out;
    }
}
