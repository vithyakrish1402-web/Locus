# Background sharing: phone test script

For Krish. You do not need to be a developer. You need two Android phones, about an hour of
attention spread over a day, and a way to take screenshots. Every test says what to do, what you
**should see**, and what to **tell me if you don't**.

**What this tests:** LOCUS keeps showing your position to your Group after you swipe the app
away or turn the screen off, shows a notification that says so, stops when you tell it to, and
never starts by itself where Android does not allow it.

> **Before you start (once):**
> 1. The test app **"LOCUS Test"** is installed on **Phone A** (it sits next to normal LOCUS and
>    never touches it). Phone B can run normal LOCUS or LOCUS Test.
> 2. The two settings are on Render (Krish only, never pasted anywhere): the secret
>    `LOCUS_DEVICE_TOKEN_SECRET` and `LOCUS_BACKGROUND_SHARING_ENABLED=true`. When you are
>    done testing, **delete `LOCUS_BACKGROUND_SHARING_ENABLED`** to switch it off again.
> 3. The JavaScript half (Part B) of this work is in the test app. Until it is, the test app
>    cannot start sharing and these tests cannot be run. Claude will tell you when it is.
> 4. In LOCUS Test, open **Settings** with Developer mode on. There is a plain switch,
>    **"Background sharing (test)"**. That is the only way to turn it on.
>
> **Safety:** if your computer gets its internet from one of these phones' hotspot, do **not**
> use that phone as Phone A, and never switch airplane mode or mobile data off on it.

**Names used below.** *Phone A* = the phone being tested (ideally a **Samsung**, or another make
known for closing apps aggressively). *Phone B* = the phone that watches the map.

---

## Set-up (do this first, every day you test)

1. **Phone B:** open LOCUS, create a Group. Note the code.
2. **Phone A:** open LOCUS Test, sign in, **join** the Group with the code.
3. **Phone B:** approve Phone A when the request appears.
4. **Both:** you should each see the other on the map list. Put Phone A's blue dot somewhere you
   can recognise, ideally outdoors.

**Write down:** Phone A's make and model, Android version (Settings → About phone → Software
information → Android version), and the time you start.

---

## Test 1: turning it on, and the permissions

**Do:** On Phone A open Settings (inside the Group), Developer mode, and turn on
**Background sharing (test)**.

**You should see:**
- If Android asks to allow **notifications**, allow it. If it asks for **location**, choose
  **Precise** and **While using the app**.
- A **notification stays at the top of the screen**: *"LOCUS is sharing your location"* /
  *"Sharing your location with <your Group>"*, with three buttons: **Pause 15 min**,
  **Pause 1 hour**, **Stop**.
- On Phone B, nothing looks different yet (Phone A is still shown as normal).

**Now try the refusal.** Turn it off (Stop). Go to Android Settings → Apps → LOCUS Test →
Notifications and **turn notifications off**. Turn **Background sharing (test)** on again.

**You should see:** it does **not** start, and the app tells you it needs notifications. No
notification, no sharing. (Turn notifications back on afterwards.)

**Tell me if:** it starts without a notification showing; no permission question appeared at all;
or the app crashed. Include a screenshot and what you pressed.

---

## Test 2: the notification buttons

**Do:** With sharing on, pull down the notification shade on Phone A.

1. Tap **Pause 15 min**.
2. Look at Phone B for about 30 seconds.
3. Tap **Resume** on Phone A's notification.
4. Tap **Pause 1 hour**, then **Resume**.
5. Tap **Stop**.

**You should see:**
- After Pause: the notification changes to *"LOCUS sharing is paused"* with a **Resume** button.
  On Phone B, Phone A's marker **stays where it was** and is shown as **Paused**, not missing.
- After Resume: the notification returns to normal and Phone B's marker moves again.
- After **Stop**: the notification **disappears**, and within about a minute Phone B no longer
  shows Phone A as sharing in the background. (If the app is open on Phone A, Phone A is still
  shown by the app itself. That is normal.)

**Tell me if:** a button does nothing; the notification does not change; the pause lasts much
longer or shorter than it says; or Stop leaves the notification behind. Screenshot it.

---

## Test 3A: Home button, WITHOUT swiping

This matters most. The moment you leave LOCUS, its screen is frozen; the sharing has to carry on from
that very moment, not only after the app is swiped away.

**Do:**
1. Turn on **Background sharing (test)** on Phone A. Check the notification is showing.
2. Stand somewhere you can **walk** from, with Phone B open on the map showing Phone A.
3. Press the **Home button** on Phone A (do **not** open recent apps, do **not** swipe anything).
4. **Write down the time.** Walk about 30 steps.

**You should see:**
- The sharing notification stays.
- On Phone B, within **about 2 to 5 seconds** of pressing Home, Phone A's marker starts following you
  as you walk, about once a second to once every 15 seconds (it follows your Settings "Location
  refresh rate"). No "signal lost".
- Nothing goes wrong when you open LOCUS again: it picks up from where it was.

**Tell me if:** Phone B's marker stays still for more than about 10 seconds after you pressed Home, then
moves; the marker only starts moving much later (30 seconds or more); or you see "signal lost". Write
down the time you pressed Home and when the marker first moved.

---

## Test 3B: screen off, WITHOUT swiping

**Do:**
1. LOCUS open on Phone A, sharing on, notification showing.
2. Press the **power button** to turn the screen off. Do **not** swipe the app away.
3. **Write down the time.** Put the phone in your pocket and **walk** for 2 minutes.

**You should see:** the same as Test 3A. Phone B follows you within a few seconds of the screen going
off, and keeps following for the whole walk.

**Tell me if:** it looks frozen for more than about 10 seconds after the screen goes off, or stops
partway.

**Optional (if your phone has split screen):** open LOCUS and a second app together in split screen,
then tap the second app so LOCUS is no longer the one you are using. It should behave like Test 3A.

---

## Test 3: swiping the app away

**Do:**
1. Turn on **Background sharing (test)** on Phone A. Check the notification is showing. (Do this one
   *after* Tests 3A and 3B, which should already have passed.)
2. Open the phone's recent-apps screen and **swipe LOCUS Test away**.
3. **Walk** with Phone A for at least 5 minutes (or carry it somewhere else). Keep Phone B open
   on the map.

**You should see:**
- The **notification stays** after the swipe.
- On Phone B, Phone A's marker **keeps moving** as you walk, with **no "signal lost"** message.
  For up to about a minute after the swipe it may look still: that is normal while the phone
  hands over.

**Tell me if:** the notification vanishes after the swipe; Phone B shows "signal lost"; the
marker stops for more than two minutes; or the marker jumps somewhere wrong. Note the time of
the swipe and the time it stopped.

**Then, and this is the long one, leave the swipe in place and do Test 4.**

---

## Test 4: screen off for 30 minutes (and an hour)

**Do:** After Test 3, with the app still swiped away, **turn Phone A's screen off** and put it in
your pocket or bag. Keep moving a little (walk around the building) or leave it on a desk for
half the time. Watch Phone B.

Check at **10, 30 and 60 minutes**.

**You should see:**
- The notification is still there when you wake the phone.
- Phone B still shows Phone A **updating**, with no "signal lost". When the phone is still it may
  update less often (about every 15 to 45 seconds); that is normal and saves battery.

**Tell me if:** at any of the checks Phone B shows Phone A as lost or missing, or the marker has
not moved while you were moving. Write down how long it lasted.

---

## Test 5: Android 14 and newer

(Skip the parts that don't apply if Phone A is on Android 13 or older, and say so.)

**5a, location permission "only while using the app".** In Android Settings → Apps → LOCUS Test →
Permissions → Location, check it says **Allow only while using the app**. Redo Test 3.

> You should see: it **keeps working after the swipe** even though you never chose "allow all
> the time". **Tell me if** it stops: that tells us we need to ask for "all the time".

**5b, Android restarting the service by itself (the "sticky restart").** This one needs the
computer. With Phone A connected by USB, sharing on, app swiped away, open PowerShell and run:

```bash
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" shell am crash com.locus.app.sidetest
```

(Do **not** use airplane mode or change the phone's network.)

**You should see, within a minute, one of these two:**
- **(a)** the sharing notification comes back and Phone B's marker keeps updating, **or**
- **(b)** a notification *"LOCUS stopped sharing your location. Tap to resume sharing with <Group>"*,
  and sharing is **not** running.

Either is acceptable. What is **not** acceptable: a crash message, the phone showing "LOCUS Test
keeps stopping", the notification flickering on and off, or sharing silently carrying on with **no
notification**. **Tell me which of (a) or (b) happened**, the Android version, and a screenshot.

**5c, forcing it to stop.** Android Settings → Apps → LOCUS Test → **Force stop**.

> You should see: the notification disappears and sharing **stays stopped** (Android does not
> restart a force-stopped app). That is expected. **Tell me if** the notification comes back by
> itself.

---

## Test 6: restarting the phone

**Do:** With sharing on, **restart Phone A** and unlock it. Do not open LOCUS Test yet.

**You should see:**
- A notification: *"LOCUS stopped sharing your location. Tap to resume sharing with <Group>"*.
- **No** location icon at the top and **no** sharing notification. Phone B shows Phone A as lost.
  Sharing must **not** restart by itself.
- Tap the notification: LOCUS Test opens. Turn **Background sharing (test)** on again and sharing
  resumes.

**Tell me if:** sharing restarts by itself after the reboot; the "tap to resume" notice never
appears (wait two minutes); or tapping it does nothing.

---

## Test 7: battery over an hour

**Do:** Charge Phone A to **100%**. Turn on background sharing. Swipe the app away. Turn the screen
off. Leave the phone **still on a table** for one hour (no other apps in use). Then note the battery.

Repeat on another day **with sharing off** (same hour, same table, same Wi-Fi/mobile) so we can
compare.

**Write down:**

| | Sharing ON | Sharing OFF |
|---|---|---|
| Battery at the start | | |
| Battery after one hour | | |

Then look at Settings → Battery → Battery usage (or "Device care" on Samsung) and **screenshot
what it shows for LOCUS Test**.

**Tell me:** both numbers and the screenshot. A drop of about **2 to 4 percentage points more** than
the "off" hour is reasonable. **More than about 8 points more**, tell me straight away.

If you can, do one more hour **walking** with the phone in a pocket and note the same numbers.

---

## Test 8: mobile data

**Do:** Turn Phone A's **Wi-Fi off** (so it uses mobile data only), then do Test 3 again for 5
minutes. (Remember: never do this on the phone your computer's internet comes from.)

**You should see:** the same as Test 3. **Tell me if** it works on Wi-Fi but not on mobile data.

---

## Test 9: being removed while the app is closed

**Do:** Sharing on, app swiped away, Phone A's notification showing. On **Phone B** (the Group's
Commander), find Phone A in the member list and **block** it.

**You should see:** within about **a minute** Phone A's sharing **notification disappears** and
sharing stops, with no message needed. Phone B no longer shows Phone A.

**Tell me if:** the notification stays more than two minutes, or Phone B keeps showing Phone A.
(Unblock/approve Phone A again afterwards to continue testing.)

---

## Test 10: logging out and leaving

**Do, one at a time:**
1. Sharing on. In LOCUS Test, **leave the Group**.
2. Join again, sharing on. **Log out** of LOCUS Test.

**You should see:** each time the sharing notification **disappears straight away**, and Phone B
no longer shows Phone A.

**Tell me if:** a notification is left behind after leaving or logging out.

---

## Test 10A: the server restarts while the app is closed ("Your Group ended")

LOCUS's server runs on Render's free plan. A restart or a new deploy wipes every Group (they live
in memory only), and a free instance takes **about a minute** to wake up afterwards. This is how
that looks to Phone A. **Ask Krish to redeploy the server** (or do it with the Render "Manual
Deploy" button) while the test below is running; do it outside class hours, it ends live Groups.

**Do:** Sharing on, app swiped away, Phone A's notification showing, Phone B shows Phone A.
Then redeploy the server.

**You should see:**
1. For up to about a minute the sharing notification **stays**, and Phone B shows Phone A's
   last position, then "signal lost" (the Group is gone with the restart).
2. Once the server is back, within a minute or two Phone A's sharing notification **disappears** and a
   new notice appears: **"Your Group ended. Tap to reopen LOCUS."**
3. Tapping the notice opens LOCUS and the notice goes away. (Until the lobby message from the app
   half exists it simply opens LOCUS; later it says "Your Group ended (the server restarted).
   Rejoin with the code".)
4. Sharing does **not** resume by itself: the Group has to be joined again and sharing switched on.

**Tell me if:** the sharing notification stays for more than five minutes after the server is
back, no notice appears, the notice stays after you tap it, or sharing restarts without you.

---

## Test 10B: the server is away for a long time

**Do:** Same start as Test 10A, but ask Krish to **suspend** the Render service (not redeploy) and
leave it suspended for **12 minutes**, then resume it.

**You should see:** the sharing notification stays for the first ten minutes (LOCUS keeps trying
with longer and longer pauses); around the ten-minute mark it disappears and a notice says **"LOCUS
stopped sharing your location. The server could not be reached. Tap to reopen LOCUS."** It does not
vanish silently, and it does not try forever.

**Tell me if:** it gives up in under three minutes, never gives up, or gives up with no notice.

---

## Test 11 (Samsung and similar): "sleeping apps"

Some phones close apps they think you are not using. On a Samsung: Settings → Battery → Background
usage limits.

1. First test with the phone's **default** settings (Tests 3 and 4).
2. Then add **LOCUS Test** to **Never sleeping apps** and repeat Test 4.

**Tell me:** whether the default setting made sharing stop, how long it lasted, and whether adding
it to "Never sleeping apps" fixed it. This decides whether the app should offer to open that screen.

---

## What to send me

For each test that did not go as described: the **test number**, **Phone A's make, model and
Android version**, the **time** it started and the time it went wrong, **screenshots** of the
notification and of Phone B's map, and **one sentence** on what you did. If a phone showed an error
message, a photo of the message is worth more than a description.

If everything passed, just tell me **"all passed on <phone model>"** and send the battery numbers.

**Stop testing and tell me at once if:** a location notification stays after you pressed Stop;
sharing continues after you logged out or were blocked; or the phone gets noticeably hot or flat.
