# Background sharing: phone test script

For Krish. You do not need to be a developer. You need two Android phones, about an hour of
attention spread over a day, and a way to take screenshots. Every test says what to do, what you
**should see**, and what to **tell me if you don't**.

**What this tests:** LOCUS keeps showing your position to your Group after you swipe the app
away or turn the screen off, shows a notification that says so, stops when you tell it to, and
never starts by itself where Android does not allow it.

> **Before you start (once):**
> 1. The test app is **"LOCUS RC Test"** (app id `com.locus.app.rctest`, "RC" for release candidate).
>    It is the real app as it will be released, with automatic updates switched off so nothing can
>    replace it while you test. It is a **separate** app: it sits next to normal LOCUS, next to
>    "LOCUS Test" **and next to the earlier "LOCUS BG Test"**, and replaces none of them. See
>    **Installing LOCUS RC Test** below. Phone B can run any of them.
> 2. The server needs two settings on Render (Krish only; the secret is never pasted anywhere), and
>    the server must have the status route live (pull request #95 merged). See **Settings on
>    Render** below. When you are done testing, **delete `LOCUS_BACKGROUND_SHARING_ENABLED`** to
>    switch it off again (or leave it off until the day you want it on for everyone).
> 3. In LOCUS RC Test, open **Settings**. Under **Sharing when LOCUS is closed** there is the
>    switch **Keep sharing when the app is closed**. It is **off** until you turn it on, and it only
>    appears when the server has background sharing switched on. There is no Developer mode.
>
> **Safety:** if your computer gets its internet from one of these phones' hotspot, do **not**
> use that phone as Phone A, and never switch airplane mode or mobile data off on it.

**Names used below.** *Phone A* = the phone being tested (ideally a **Samsung**, or another make
known for closing apps aggressively). *Phone B* = the phone that watches the map.

---

## Installing LOCUS RC Test (for a human, once per phone)

You are given one file: **`app-rctest.apk`** (about 10 MB). It is signed with the standard Android
*debug* key (the same kind as "LOCUS Test", and **not** the release key normal LOCUS is signed
with). That is fine and safe: its app id is its own, so Android treats it as a separate app. It can
never update or replace either of the others, and **you are never asked to uninstall anything**. (If a message ever says "App not installed" or offers to *replace* an existing app,
**stop and tell me**: that must not happen.)

1. Put the file on the phone: connect by USB and copy it into **Downloads**, or send it to yourself
   (Drive, email, WhatsApp) and download it on the phone.
2. On the phone open **Files** → **Downloads** → tap `app-rctest.apk`.
3. Android asks to **allow installs from this source** (the Files app, Drive or the browser you used).
   Turn it **on** for that app, go back, and tap Install. After testing, turn that permission **off**
   again (Settings → Apps → special access → Install unknown apps).
4. If Play Protect says the app is unknown, choose **Install anyway** (it is a test build of our own
   app).
5. Open **LOCUS RC Test** (the icon says "LOCUS RC Test"). Sign in with your usual account.
6. Check, in Android Settings → Apps → **LOCUS RC Test** → App info → Version: it should read
   **1.1.44-rctest** (the 1.1.45 navigation candidate; the earlier one read 1.1.39-rctest). The
   existing **LOCUS Test** and **LOCUS** are still in the list, unchanged.

If an earlier **LOCUS RC Test** is already on the phone, this one **updates it in place**: Android
says *"Do you want to update this app?"* (not "replace"), and you stay signed in. That is expected.

Do **not** open "LOCUS Test" for these tests. Its Floor 7 recorder is a different test.

## Settings on Render (Krish only, before the first test)

First: the **status route** (pull request #95) must be merged and deployed. Without it the app cannot
tell that the server has background sharing on, and the switch simply never appears. That is the safe
direction, not a bug.

In the Render dashboard, for the LOCUS server, Environment:

| Name | Value |
|---|---|
| `LOCUS_BACKGROUND_SHARING_ENABLED` | `true` |
| `LOCUS_DEVICE_TOKEN_SECRET` | a long random string, **at least 32 characters**; make it up in a password manager, never paste it into chat, a file or the repository |

Then redeploy **outside class hours** (a redeploy ends every live Group). In the deploy log look for
the line **"Using Node.js version ..."**: it must be **22 or higher** (the sign-in check needs it);
and for the `[BACKGROUND]` startup line, which says sharing is on. With either setting missing, the
switch in the app says *"The server has it switched off"*, which is the correct and safe answer.
A free Render server **sleeps after 15 minutes** without traffic and takes about a minute to wake;
the first action after a quiet period can be slow. That is the plan, not a fault.

---

## Set-up (do this first, every day you test)

1. **Phone B:** open LOCUS, create a Group. Note the code.
2. **Phone A:** open **LOCUS RC Test**, sign in, **join** the Group with the code.
3. **Phone B:** approve Phone A when the request appears.
4. **Both:** you should each see the other on the map list. Put Phone A's blue dot somewhere you
   can recognise, ideally outdoors.

**Write down:** Phone A's make and model, Android version (Settings → About phone → Software
information → Android version), and the time you start.

---

## Test 1: turning it on, and the permissions

**Do:** On Phone A, inside the Group, open Settings. Under **Sharing when LOCUS is closed**, the state line
under the switch reads **"Not sharing"**. Tap **Keep sharing when the app is closed**.

**You should see first, before any permission question:** a panel titled **"Share your location when
LOCUS is closed?"** that says LOCUS will share your live location with the members of your current
Group even when the app is closed or the screen is off; that a notification stays visible while
sharing is on; that it goes only to your Group and ends when you leave the Group; that you can pause it from
the notification, or stop it at any time from the notification or from Settings; and that it can use more battery. Two buttons:
**Turn on** and **Not now**.

**Try "Not now" first:** the panel closes, the switch stays off, **no** permission question appears.
Tap the switch again and choose **Turn on**.

**You should see:**
- If Android asks to allow **notifications**, allow it. If it asks for **location**, choose
  **Precise** and **While using the app**.
- A **notification stays at the top of the screen**: *"LOCUS is sharing your location"* /
  *"Sharing your location with <your Group>"*, with three buttons: **Pause 15 min**,
  **Pause 1 hour**, **Stop**.
- The line under the switch reads **"Sharing with <your Group's code>"**.
- On Phone B, nothing looks different yet (Phone A is still shown as normal).
- The panel does **not** appear again the next time you turn it on (it remembers you agreed).

**Now try the refusal.** Turn it off (Stop). Go to Android Settings → Apps → LOCUS RC Test →
Notifications and **turn notifications off**. Turn **Keep sharing when the app is closed** on again.

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
1. Turn on **Keep sharing when the app is closed** on Phone A. Check the notification is showing.
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
1. Turn on **Keep sharing when the app is closed** on Phone A. Check the notification is showing. (Do this one
   *after* Tests 3A and 3B, which should already have passed.)
2. Open the phone's recent-apps screen and **swipe LOCUS RC Test away**.
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

**5a, location permission "only while using the app".** In Android Settings → Apps → LOCUS RC Test →
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

Either is acceptable. What is **not** acceptable: a crash message, the phone showing "LOCUS RC Test
keeps stopping", the notification flickering on and off, or sharing silently carrying on with **no
notification**. **Tell me which of (a) or (b) happened**, the Android version, and a screenshot.

**5c, forcing it to stop.** Android Settings → Apps → LOCUS RC Test → **Force stop**.

> You should see: the notification disappears and sharing **stays stopped** (Android does not
> restart a force-stopped app). That is expected. **Tell me if** the notification comes back by
> itself.

---

## Test 6: restarting the phone

**Do:** With sharing on, **restart Phone A** and unlock it. Do not open LOCUS RC Test yet.

**You should see:**
- A notification: *"LOCUS stopped sharing your location. Tap to resume sharing with <Group>"*.
- **No** location icon at the top and **no** sharing notification. Phone B shows Phone A as lost.
  Sharing must **not** restart by itself.
- Tap the notification: LOCUS RC Test opens. Turn **Keep sharing when the app is closed** on again and sharing
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
what it shows for LOCUS RC Test**.

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
1. Sharing on. In LOCUS RC Test, **leave the Group**.
2. Join again, sharing on, then **turn the switch off** in Settings.
3. Join again, sharing on, then Settings → **Sign out**.

**You should see:** each time the sharing notification **disappears straight away**, and Phone B
no longer shows Phone A.

**Tell me if:** a notification is left behind after leaving, switching off or signing out.

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
3. Tapping the notice opens LOCUS RC Test and the notice goes away. After you sign in, the screen
   where you pick a Group says: **"Your Group ended (the server restarted). Rejoin with the code."**
   This works even if Android had closed the app in between. It is shown **once**: close and reopen
   the app and it is gone.
4. Sharing does **not** resume by itself: the Group has to be joined again and sharing switched on.

**Tell me if:** the sharing notification stays for more than five minutes after the server is
back, no notice appears, the notice stays after you tap it, the "Your Group ended" message is
missing or appears a second time, or sharing restarts without you.

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
2. Then add **LOCUS RC Test** to **Never sleeping apps** and repeat Test 4.

**Tell me:** whether the default setting made sharing stop, how long it lasted, and whether adding
it to "Never sleeping apps" fixed it. This decides whether the app should offer to open that screen.

---

## Test 12: the kill switch (Krish only)

This is how sharing is switched off for everyone within minutes if something goes wrong.

**Do:** Phone A sharing, app swiped away. In Render, **delete** `LOCUS_BACKGROUND_SHARING_ENABLED`
(or set it to anything but `true`) and let it redeploy. (This restarts the server, which ends every
live Group; do it outside class hours.)

**You should see:**
1. Within a few minutes Phone A's sharing notification **disappears** and a notice appears:
   **"Background sharing was switched off"**. Tapping it opens LOCUS RC Test and removes it.
2. In LOCUS RC Test, Settings no longer shows **Sharing when LOCUS is closed** at all.
3. No error messages, nothing keeps retrying, and the app itself works as before.
4. Set the variable back to `true` and redeploy: the switch comes back (still off, as you left it)
   after you open Settings.

**Tell me if:** the notification stays more than ten minutes, no notice appears, an error appears,
or the switch is still there with the server off.

---

## Test 13: Pause from the notification, and the state line

**Do:** Sharing on. Pull down the notification shade and tap **Pause 15 min**. Open LOCUS RC Test →
Settings.

**You should see:** the line under the switch reads **"Paused"**. After **Resume** (or 15 minutes) it
reads **"Sharing with <Group>"** again.

**Tell me if:** it keeps saying "Sharing" while paused, or the other way round.

---

## Test 14: navigation, and the Emergency button during it (1.1.45 candidate)

Navigation (Jose's turn-by-turn) hides the bottom bar the Emergency button normally sits in. In this
build the button **floats bottom-left** instead, so it is never out of reach. This test checks that,
and that the button still only arms on a hold.

> **Never send a real Emergency alert in this test.** A full alert needs **two** holds: hold once
> to arm, then hold **again within 4 seconds** to send. In this test you only ever do the **first**
> hold. After arming, take your finger off and **do not touch the button for 5 seconds**. Do it in
> the test Group with only Phone B in it, and tell whoever holds Phone B first.

**Do (start navigating):** On Phone A, in the Group, with location on, start a route in either of these ways:
- open the Group list, switch to **Buildings**, and tap the **navigate** button on a building's row
  (its label reads *"Navigate to <building>"*); or
- tap a building on the map, set it as the destination, then tap **Start Route** on the route card.

**You should see:** a turn instruction card at the top, the bottom bar **gone**, and the red
**SOS** button floating on the left, **above** the trip card at the bottom ("8 min · 713 m …") and
above the round speed badge, **not on top of** either. There is one SOS button, not two. If you walk
all the way to the destination, the "You Have Arrived!" panel replaces the trip card and the SOS
button drops back to the bottom-left corner, below that panel.

**Do (arm, then let it lapse):** press and **hold** SOS.

**You should see:** a card above it, **"Keep holding"** (*"Release to cancel. Nothing has been
sent."*), and a ring filling. After about a second the card changes to **"Hold again to send an
emergency alert"**. **Now take your finger off and wait 5 seconds without touching the button.**
The card goes away and the button reads **SOS** again. Phone B gets **nothing**.

**Do (cancel by sliding off):** press and hold SOS, and **before the ring fills** slide your finger
off the button (keep it on the screen).

**You should see:** the card goes away at once, the ring empties, and the button may briefly read
**"Hold longer"**. Nothing is armed and Phone B gets **nothing**. A quick tap does the same.

**Do (map controls still work):** while navigating, drag the map away, then tap the **re-centre**
button. Then end the route with the **End route** (X) button.

**You should see:** the map follows you again after re-centre. After End route the turn card goes,
the bottom bar comes back, and the SOS button is **back in the bottom bar** (not floating, and not
missing).

**Also look at, and tell me what you see (known open items, not failures yet):**
- whether any **red** appears in the navigation screen other than the SOS button (the speed badge
  ring, parts of the turn card);
- whether there is any way to open **AR Scan** pointed at the destination while navigating;
- if an error screen ever appears, whether the SOS button is still visible on top of it.

**Do (Settings):** open **Settings** (the gear on the right of the map), then go back.

**You should see:** **no SOS button anywhere** while Settings is open (it used to sit over the
Settings text). As soon as you go back, it is there again.

**Tell me if:** the SOS button covers any text or button while navigating; it shows in Settings or
is missing after leaving Settings; the SOS button is missing at any point while navigating; there are two of them;
it arms on a tap; sliding off does not cancel; anything at all reaches Phone B; or the bottom bar
does not come back after End route. Screenshot the navigation screen with the SOS button showing.

**Stop at once and tell me if** Phone B ever receives an Emergency alert during this test.

---

## What to send me

For each test that did not go as described: the **test number**, **Phone A's make, model and
Android version**, the **time** it started and the time it went wrong, **screenshots** of the
notification and of Phone B's map, and **one sentence** on what you did. If a phone showed an error
message, a photo of the message is worth more than a description.

If everything passed, just tell me **"all passed on <phone model>"** and send the battery numbers.

**Stop testing and tell me at once if:** a location notification stays after you pressed Stop;
sharing continues after you logged out or were blocked; or the phone gets noticeably hot or flat.
