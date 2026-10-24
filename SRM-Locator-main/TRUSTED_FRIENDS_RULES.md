# Trusted friends: what to set up in Firebase and on Render

For whoever manages Firestore. Nothing here is live until it is published by hand; the repo has no
`firestore.rules`. Until both parts are done, the feature **fails safe**: friend requests can't be
saved (the app says so), and every SOS keeps going to the whole Group, as it does today.

## 1. Firestore rules (Firebase console > Firestore > Rules)

Add this block inside `match /databases/{database}/documents { ... }`, next to the existing
`wifi_aps` and `campus_places` rules. Do not replace those.

```
match /friendships/{id} {
  // Only the two people in a friendship can see it.
  allow read: if request.auth != null
    && request.auth.uid in resource.data.users;

  // A request: made by one of the two, for a pair of two different people, under the pair's
  // own id (the two uids sorted, joined with "_"), always starting as pending.
  allow create: if request.auth != null
    && request.resource.data.keys().hasOnly(['users', 'requester', 'status', 'names', 'createdAt'])
    && request.resource.data.users is list
    && request.resource.data.users.size() == 2
    && request.resource.data.users[0] < request.resource.data.users[1]
    && id == request.resource.data.users[0] + '_' + request.resource.data.users[1]
    && request.resource.data.requester == request.auth.uid
    && request.auth.uid in request.resource.data.users
    && request.resource.data.status == 'pending'
    && request.resource.data.names is map
    && request.resource.data.createdAt == request.time;

  // Accepting: only the person who was asked, only a pending request, and only the status
  // and the time it was accepted change.
  allow update: if request.auth != null
    && resource.data.status == 'pending'
    && request.auth.uid in resource.data.users
    && request.auth.uid != resource.data.requester
    && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status', 'acceptedAt'])
    && request.resource.data.status == 'accepted'
    && request.resource.data.acceptedAt == request.time;

  // Declining, cancelling or ending it: either of the two.
  allow delete: if request.auth != null
    && request.auth.uid in resource.data.users;
}
```

No extra index is needed: the app and the server each ask with one filter
(`users array-contains <uid>`), which Firestore indexes on its own.

**Limit to know about.** The rules can't check that the two people share a Group: Groups live
only in the server's memory. The app only offers "Add as trusted friend" on a group member's
card, and a request does nothing until the other person accepts it.

## 2. Let the server read friendships (Render)

The server decides who hears an SOS, so it reads accepted friendships with the Firebase Admin SDK.
That needs a service account key. A read-only one is enough and is the safer choice:

1. Google Cloud console > IAM & Admin > Service accounts (project `locus-5c6a8`) > **Create
   service account**, e.g. `locus-server-friends`.
2. Give it the role **Cloud Datastore Viewer** (read-only Firestore). No other role.
3. On that account: Keys > Add key > JSON. A file downloads.
4. On Render, in the LOCUS service's Environment, add `LOCUS_FIREBASE_SERVICE_ACCOUNT` with the
   **whole contents** of that JSON file as its value. Delete the downloaded file afterwards.
5. Redeploy. The server's log then says
   `[FRIENDS] Trusted friends are read from Firestore: ...`. Without the key it says
   `[FRIENDS] No LOCUS_FIREBASE_SERVICE_ACCOUNT: ... every SOS goes to the whole Group.`

Never commit the key or paste it into the app: it is a server secret, unlike the app's Firebase
config.

## What an SOS does then

It goes to the sender's trusted friends, and always to the Group Lead (whoever holds command, and
the Group's own Commander) and every moderator, so an SOS from someone with no friends still
reaches someone. It goes to the whole Group instead when the server can't tell (no key, Firestore
unreachable, a phone with no sign-in) or when nobody would be left.
