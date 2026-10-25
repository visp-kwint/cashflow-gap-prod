const SEED = 42;
let state = SEED;

export function setSeed(seed) {
  state = seed;
}

export function random() {
  state = (state * 16807) % 2147483647;
  return (state - 1) / 2147483646;
}

export function randomRange(min, max) {
  return min + random() * (max - min);
}