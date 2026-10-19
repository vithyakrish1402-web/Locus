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
  name: 'Give the place a name.',
  nameLong: `Keep the name under ${NAME_MAX} characters.`,
  category: 'Choose what kind of place it is.',
  offCampus: 'That spot is outside the campus. Choose it again on the map.',
  duplicate: 'A place with that name is already on the map.',
  aliasTaken: 'One of those short names already belongs to a place.',
  denied: "Not saved: the database refused it. The Firestore rules must allow your account to write campus_places.",
  failed: 'Not saved. Check your connection and try again.',
};
