export const FLAVOR_PREFIX = '__SABOR__';
export const isFlavor = (name: string) => name.startsWith(FLAVOR_PREFIX);
export const isTopping = (name: string) => !name.startsWith(FLAVOR_PREFIX);
export const stripFlavorPrefix = (name: string) =>
  name.startsWith(FLAVOR_PREFIX) ? name.slice(FLAVOR_PREFIX.length) : name;
export const addFlavorPrefix = (name: string) => `${FLAVOR_PREFIX}${name}`;
