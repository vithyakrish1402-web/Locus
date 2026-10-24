package com.locus.app.alerts;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.HashSet;
import org.junit.Test;

/** The alarm volume's bookkeeping: raised once, put back once, by the last holder or after a kill. */
public class AlertVolumeLedgerTest {

    @Test
    public void theFirstHolderSavesTheVolumeAndTheLastPutsItBack() {
        AlertVolumeLedger ledger = new AlertVolumeLedger();
        assertEquals(3, ledger.hold("app-sos", 3));
        assertEquals(-1, ledger.hold("svc-0", 7)); // already raised: the 7 is ours, not the user's
        assertEquals(-1, ledger.release("app-sos"));
        assertTrue(ledger.isRaised());
        assertEquals(3, ledger.release("svc-0"));
        assertFalse(ledger.isRaised());
    }

    @Test
    public void holdingTwiceIsOneHolder() {
        AlertVolumeLedger ledger = new AlertVolumeLedger();
        ledger.hold("app-ping", 2);
        ledger.hold("app-ping", 9);
        assertEquals(2, ledger.release("app-ping"));
    }

    @Test
    public void releasingWhatIsNotHeldChangesNothing() {
        AlertVolumeLedger ledger = new AlertVolumeLedger();
        assertEquals(-1, ledger.release("app-sos"));
        ledger.hold("svc-1", 4);
        assertEquals(-1, ledger.release("svc-2"));
        assertTrue(ledger.isRaised());
    }

    @Test
    public void aRestartedProcessLetsGoOfItsOwnHoldersOnly() {
        // Read back after the app was killed while its klaxon and a service alert rang.
        AlertVolumeLedger ledger = new AlertVolumeLedger(new HashSet<>(Arrays.asList("app-sos", "svc-0")), 5);
        assertEquals(-1, ledger.releaseAll(AlertVolumeLedger.APP)); // the service still rings
        assertEquals(5, ledger.releaseAll(AlertVolumeLedger.SERVICE));
        assertEquals(-1, ledger.releaseAll(AlertVolumeLedger.SERVICE)); // nothing left to put back
    }

    @Test
    public void aLedgerWithNoHoldersHasNothingSaved() {
        AlertVolumeLedger ledger = new AlertVolumeLedger(new HashSet<>(), 6);
        assertEquals(-1, ledger.savedVolume());
        assertEquals(-1, ledger.releaseAll(AlertVolumeLedger.APP));
    }

    @Test
    public void theTargetIsTheFractionOfTheMaximumWithinItsRange() {
        assertEquals(7, AlertVolumeLedger.targetVolume(7, 1.0));
        assertEquals(4, AlertVolumeLedger.targetVolume(7, 0.5));
        assertEquals(1, AlertVolumeLedger.targetVolume(7, 0.0)); // never silent
        assertEquals(7, AlertVolumeLedger.targetVolume(7, 3.0));
        assertEquals(7, AlertVolumeLedger.targetVolume(7, Double.NaN));
        assertEquals(0, AlertVolumeLedger.targetVolume(0, 1.0));
    }
}
