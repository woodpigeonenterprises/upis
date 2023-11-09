
export function delay(ms: number) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}


export function uuid() {
  return crypto.randomUUID();
}


const eraStart = Date.parse('2019-01-01');

export function timeOrderedId() {
  return ((Date.now() - eraStart) * 24).toString(36); //could be even better, this - (random padding at end)
}


declare global {
  interface Crypto {
    randomUUID: () => `${string}-${string}-${string}-${string}-${string}`
  }
}
