// assets/manifest.json (tools/assets/build_manifest.py): tutto quello che la scena Boot carica.
export interface ManifestSheet {
  key: string;
  path: string;
  frameWidth: number;
  frameHeight: number;
  frames: number;
  originX: number;
  originY: number;
  group: string;
}

export interface Manifest {
  spritesheets: ManifestSheet[];
  images: { key: string; path: string }[];
  atlases: { key: string; image: string; json: string }[];
  tilemaps: { key: string; path: string }[];
}

export const MANIFEST_KEY = 'manifest';
