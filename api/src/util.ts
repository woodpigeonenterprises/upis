
export function err(m: string): never {
  throw Error(m);
}


const eraStart = Date.parse('2019-01-01');

export function timeOrderedId() {
  return ((Date.now() - eraStart) * 24).toString(36); //could be even better, this - (random padding at end)
}
