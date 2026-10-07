// The words of the Emergency alert: sending, waiting for a connection, and the alert as it
// arrives. One place, so the wording is reviewed whole.

// An alert held for want of a connection (utils/sosOutbox.js). Never "sent" while it waits.
export const SOS_HELD = {
  title: 'Waiting for connection',
  body: "Your alert will send when you're back online. If you need help right now, call 112.",
};

// A held alert that went out once the phone was back in its group.
export const SOS_DELIVERED = {
  title: 'Emergency alert sent',
  body: 'It went to your group as soon as you were back online.',
};

// A held alert that can never go: the group is gone from the server, or this phone left it.
export const SOS_DROPPED = {
  gone: "Your group is no longer on the server, so your alert couldn't reach them. If you need help right now, call 112.",
  left: "You're no longer in the group, so your alert couldn't reach them. If you need help right now, call 112.",
};
