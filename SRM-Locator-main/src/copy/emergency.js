// The words of the Emergency alert: sending, waiting for a connection, and the alert as it
// arrives. One place, so the wording is reviewed whole.

// An alert held for want of a connection (utils/sosOutbox.js). Never "sent" while it waits.
export const SOS_HELD = {
  title: 'Waiting for connection',
  body: "Your alert will send when you're back online. If you need help right now, call 112.",
};

// Sent, but the server hasn't said it got it (utils/sosOutbox.js): still trying, never "sent".
export const SOS_UNCONFIRMED = {
  title: 'Not delivered yet. Retrying',
  body: "Your group hasn't got your alert yet. LOCUS keeps sending it. If you need help right now, call 112.",
};

// Sent (E3). The location line says "last known": the phone sends the latest fix it has.
export const SOS_SENT = {
  title: 'Emergency alert sent to your group',
  withLocation: "Your phone's last known location was sent with it.",
  noLocationTitle: 'Alert sent, but without your location',
  noLocation: "Your phone couldn't get a location fix. If you can, tell your group where you are.",
  // A held alert that went once the phone was back in its group.
  late: 'It went as soon as you were back online.',
  stillPaused: 'Your sharing is still paused.',
  stillHidden: 'Your sharing is still hidden.',
};
// The offline fix's notice once a held alert goes: the same title.
export const SOS_DELIVERED = { title: SOS_SENT.title, body: SOS_SENT.late };

// An alert the server refused (backend/alertRules.js, its answer 'alert-result'). The "sent"
// notice is taken back first: it shows as the alert leaves the phone, before the server answers.
const timeLeft = (sec) => {
  const s = Math.max(1, Math.ceil(sec));
  const min = Math.floor(s / 60);
  const rest = s % 60;
  if (min === 0) return `${rest} s`;
  return rest === 0 ? `${min} min` : `${min} min ${rest} s`;
};
export const SOS_REFUSED = {
  title: 'SOS not sent',
  cooldown: (sec) => `You sent an alert a moment ago. You can send another in ${timeLeft(sec)}. If you need help right now, call 112.`,
  disabled: 'Your Group Lead has turned emergency alerts off for this group. If you need help right now, call 112.',
  quietZone: "Alerts can't be sent from a class building right now. If you need help right now, call 112.",
  other: "The server didn't send your alert. If you need help right now, call 112.",
};

// A Ping the server refused (alert-result, backend/alertRules.js), said to whoever sent it. It
// used to play the "sent" sound whatever the server decided.
export const PING_REFUSED = {
  title: 'Ping blocked',
  cooldown: (sec) => `Cooldown: you can ping again in ${timeLeft(sec)}.`,
  muted: 'Muted: your Group Lead has turned off your pings.',
  disabled: 'Your Group Lead has turned pings off for this group.',
  quietZone: "Pings can't be sent from a class building right now.",
  other: "The server didn't send your ping.",
};

// A held alert that can never go: the group is gone from the server, or this phone left it.
export const SOS_DROPPED = {
  gone: "Your group is no longer on the server, so your alert couldn't reach them. If you need help right now, call 112.",
  left: "You're no longer in the group, so your alert couldn't reach them. If you need help right now, call 112.",
};

// The button's own words (components/SosTrigger.jsx): one short word each, so the button keeps
// one width and never cuts a word off (it used to read "HOLD...", which looked cut off). The card
// above it says what is happening; a screen reader hears it in full (SOS_SPOKEN).
export const SOS_BUTTON = {
  sos: 'SOS',
  hold: 'Hold',
  armed: 'Armed',
  // Gone out, and the server hasn't said it got it yet (utils/sosOutbox.js): never "Sent" till it has.
  sending: 'Sending',
  sent: 'Sent',
  held: 'Waiting',
  early: 'Hold longer',
};

// The card above the button while it is held, and between the two holds.
export const SOS_HOLD = {
  arming: { title: 'Keep holding', body: 'Release to cancel. Nothing has been sent.' },
  armed: { title: 'Hold again to send an emergency alert', body: 'Your group will be alerted at once. Let go and wait 4 seconds to cancel.' },
  confirming: { title: 'Keep holding to send', body: 'Release to cancel.' },
  // While sharing is Paused or Hidden: an alert always carries the location.
  location: 'Your location will be sent to your group with this alert.',
  steps: ['Hold to arm', 'Hold again to send'],
};

// What a screen reader hears as the button changes (a polite live region).
export const SOS_SPOKEN = {
  arming: 'Keep holding.',
  armed: 'Armed. Hold again within 4 seconds to send an emergency alert.',
  confirming: 'Keep holding to send.',
  sending: 'Sending your emergency alert.',
  fired: 'Emergency alert sent.',
  held: 'Waiting for connection. Your alert will send when you are back online.',
  early: 'Hold longer, until the ring fills.',
};

// The alert as it arrives (E4, components/SosOverlay.jsx).
export const SOS_RECEIVED = {
  kicker: 'Emergency alert',
  needsHelp: (name) => `${name} needs help`,
  someone: 'Someone in your group',
  // How long ago the server got it, counted on from when it reached this phone.
  age: (minutes) => (minutes < 1 ? 'Sent just now' : `Sent ${minutes} min ago`),
  ofTotal: (position, total) => `${position} of ${total}`,
  // 13a (owner, 2026-10-07): with a location, where it is from here; without, say so.
  located: "Their phone's last known location",
  noLocation: 'No location came with this alert',
  about: (distance) => `about ${distance}`,
  closeBy: 'within about 15 m of you',
  footer: "An alert includes the sender's location whenever their phone has one, even if they paused sharing or are hidden. This stays on screen until you acknowledge it; the next alert shows after this one.",
  acknowledge: 'Acknowledge',
};
