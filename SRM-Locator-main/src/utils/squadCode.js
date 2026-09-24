/**
 * Squad codes are read off one screen and typed into another, often in the app's dot font,
 * where O/0 and I/1 are nearly indistinguishable. A code with one of those pairs was misread
 * during device testing (AV4MV0 typed as AV4MVO, which found no squad). So the alphabet
 * leaves all four out: 24 letters + 8 digits = 32 symbols, 32^6 ≈ 1.07 billion codes.
 *
 * Only generation changes. The join box still accepts every letter and digit, so codes
 * handed out before this keep working.
 */
export const SQUAD_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Generates an alphanumeric squad identifier code (6 characters).
 */
export const generateRandomSquadCode = (length = 6) => {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += SQUAD_CODE_ALPHABET.charAt(Math.floor(Math.random() * SQUAD_CODE_ALPHABET.length));
  }
  return result;
};
