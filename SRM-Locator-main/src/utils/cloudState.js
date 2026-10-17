// The building popup's state machine: closed -> peek (the cloud) -> open (the full sheet).
// Pure, so the transitions are testable without a browser. Only one building is ever
// selected: selecting another while one is showing swaps to it, so two clouds never stack.

export const CLOUD_CLOSED = { phase: 'closed', id: null };

/**
 * @param {{phase: 'closed'|'peek'|'open', id: *}} state
 * @param {{type: 'select'|'expand'|'collapse'|'dismiss', id?: *, open?: boolean}} action
 *   `select` with `open: true` goes straight to the sheet (a list-row tap has no map point to bloom from).
 */
export function cloudReducer(state, action) {
  switch (action.type) {
    case 'select': {
      if (action.id == null) return CLOUD_CLOSED;
      if (state.id === action.id && state.phase !== 'closed' && !action.open) return state;
      return { phase: action.open ? 'open' : 'peek', id: action.id };
    }
    case 'expand':
      return state.phase === 'peek' ? { ...state, phase: 'open' } : state;
    case 'collapse':
      return state.phase === 'open' ? { ...state, phase: 'peek' } : state;
    case 'dismiss':
      return CLOUD_CLOSED;
    default:
      return state;
  }
}
