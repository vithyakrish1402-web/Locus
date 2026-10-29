// Words for the admin's Add Place tool (components/admin/AddPlace.jsx).
import { NAME_MAX } from '../utils/campusPlaces';

export const CATEGORY_LABELS = {
  ACADEMIC: 'Academic',
  ENGINEERING: 'Engineering',
  MEDICAL: 'Medical',
  RESIDENTIAL: 'Hostel',
  LOGISTICS: 'Cafe or hub',
  GROUNDS: 'Ground or open area',
};

export const ADD_PLACE_PROBLEMS = {
  // Add a place while a path is being recorded: map taps belong to the recording.
  recording: 'Finish or abort the path you are recording first, then add a place.',
  name: 'Give the place a name.',
  nameLong: `Keep the name under ${NAME_MAX} characters.`,
  category: 'Choose what kind of place it is.',
  offCampus: 'That spot is outside the campus. Choose it again on the map.',
  duplicate: 'A place with that name is already on the map.',
  aliasTaken: 'One of those short names already belongs to a place.',
  denied: "Not saved: the database refused it. The Firestore rules must allow your account to write campus_places.",
  failed: 'Not saved. Check your connection and try again.',
  // No answer within ADMIN_SAVE_TIMEOUT_MS. Firestore still holds the write and sends it once
  // the phone is back online; trying again saves the same place, never a second one.
  offline: "You're offline. It isn't saved yet: try again when you have signal.",
};

// The admin's Remove, in Admin tools: asked first, as removing a person is.
export const REMOVE_PLACE = {
  title: (name) => `Remove ${name}?`,
  body: 'It goes from every phone: the map, the list, search and navigation.',
  confirm: 'REMOVE',
  cancel: 'CANCEL',
  removing: 'REMOVING…',
  offline: "You're offline. The place isn't removed yet: try again when you have signal.",
};
