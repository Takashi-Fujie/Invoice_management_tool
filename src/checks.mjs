export function validChecks(invoiced, paid) {
  return !paid || invoiced;
}
export function changeChecks(state, key, value) {
  if (key === "paid" && value && !state.invoiced) return state;
  if (key === "invoiced" && !value && state.paid) return state;
  return { ...state, [key]: value };
}
