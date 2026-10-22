package com.xsiloflex.startestall.wifi;

import android.content.ComponentName;
import android.content.Context;
import android.content.ServiceConnection;
import android.content.pm.PackageManager;
import android.os.IBinder;
import android.util.Log;

import com.xsiloflex.startestall.shizuku.IUserService;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import rikka.shizuku.Shizuku;

/**
 * Client side of the Shizuku user service. Binds lazily and keeps the binder alive
 * for the whole app session.
 */
public class ShellRunner {

    private static final String TAG = "StarTestAllShell";

    private final ComponentName componentName;
    private volatile IUserService service;
    private volatile CountDownLatch latch;

    public ShellRunner(Context context) {
        this.componentName = new ComponentName(context.getPackageName(), ShellUserService.class.getName());
    }

    public boolean isShizukuReady() {
        try {
            return Shizuku.pingBinder() && Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED;
        } catch (Throwable t) {
            return false;
        }
    }

    public boolean isServiceReady() {
        return service != null;
    }

    private boolean ensureService(long timeoutMs) {
        if (service != null) {
            return true;
        }
        if (!isShizukuReady()) {
            return false;
        }
        final CountDownLatch localLatch = new CountDownLatch(1);
        latch = localLatch;
        try {
            Shizuku.UserServiceArgs args = new Shizuku.UserServiceArgs(componentName)
                    .daemon(false)
                    .version(1);
            Shizuku.bindUserService(args, connection);
        } catch (Throwable t) {
            Log.w(TAG, "bindUserService failed", t);
            return false;
        }
        try {
            localLatch.await(timeoutMs, TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        return service != null;
    }

    private final ServiceConnection connection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder binder) {
            try {
                service = IUserService.Stub.asInterface(binder);
            } catch (Throwable t) {
                service = null;
            }
            CountDownLatch localLatch = latch;
            if (localLatch != null) {
                localLatch.countDown();
            }
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            service = null;
        }
    };

    /**
     * Runs a shell command through the Shizuku user service.
     *
     * @return raw output or null when the service is not reachable
     */
    public String exec(String command, long timeoutMs) {
        if (!ensureService(15000)) {
            return null;
        }
        IUserService local = service;
        if (local == null) {
            return null;
        }
        try {
            return local.execute(command);
        } catch (Throwable t) {
            Log.w(TAG, "command failed: " + command, t);
            service = null;
            return null;
        }
    }
}
