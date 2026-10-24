package com.locus.app.sharing;

/**
 * Which stop reasons deserve a notice instead of a silent disappearance. Pure.
 *
 * With the app closed nobody hears a state event, so a service that simply ended would leave the
 * person believing they were still sharing. Reasons the person caused themselves (they pressed Stop,
 * logged out, left) need no notice; neither does a pass that merely ran out or a person who was
 * removed (the notification disappearing is the signal, and they asked for or were told that).
 *
 *   GROUP_ENDED  the Group is gone (410), or a Group of that code was started afresh and this pass
 *                means nothing to it (401 "revoked"): both are what a server restart looks like. The
 *                pass is wiped, and a new one needs a fresh sign-in, which only the app can do.
 *   UNREACHABLE  the server could not be reached for the whole retry window.
 *   DISABLED     the server says background sharing is switched off (the kill switch). The person did not
 *                do this and the notification would otherwise just vanish.
 */
public final class ReasonNotice {
    public enum Kind { NONE, GROUP_ENDED, UNREACHABLE, DISABLED }

    public static final String SERVER_UNREACHABLE = "server-unreachable";

    private ReasonNotice() {}

    public static Kind forStopReason(String reason) {
        if (ResponseHandler.GROUP_GONE.equals(reason) || ResponseHandler.REVOKED.equals(reason)) return Kind.GROUP_ENDED;
        if (SERVER_UNREACHABLE.equals(reason)) return Kind.UNREACHABLE;
        if (ResponseHandler.DISABLED.equals(reason)) return Kind.DISABLED;
        return Kind.NONE;
    }
}
