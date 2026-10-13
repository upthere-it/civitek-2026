// device_id = UUID v4 casuale (ARCHITECTURE §7). Niente fingerprinting. In localStorage c'è solo questo.
const KEY = 'sp_device_id';
let memoryId: string | null = null;

function uuidV4(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID(); // solo in contesto sicuro (HTTPS)
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** `persisted` = false se localStorage non è disponibile (alcune modalità private): va mostrato il codice. */
export function getDeviceId(): { id: string; persisted: boolean } {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = uuidV4();
      localStorage.setItem(KEY, id);
    }
    return { id, persisted: true };
  } catch {
    memoryId ??= uuidV4();
    return { id: memoryId, persisted: false };
  }
}
