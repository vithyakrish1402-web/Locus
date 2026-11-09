// Which address a connection really comes from.
//
// Behind Render's proxy, Socket.IO's `socket.handshake.address` is the PROXY's address, the same
// for every phone, so a per-address limit keyed on it would count the whole campus as one
// caller. The real caller is in the forwarded-address header the proxy adds. Express does the
// same for its own requests with `app.set('trust proxy', 1)`; this does it for sockets.
//
//   LOCUS_TRUST_PROXY_HOPS   how many proxies sit in front of the server (default 1, like
//                            `trust proxy`); 0 reads the connection's own address (local use)
//   LOCUS_CLIENT_IP_HEADER   optional: a header the front proxy overwrites with the caller's
//                            address (e.g. true-client-ip); used when it is present
//
// With N trusted proxies the caller is the Nth entry from the RIGHT of X-Forwarded-For: the
// entries to its left were typed by the caller (or a proxy it passed through) and mean nothing.

const firstValue = (header) => (Array.isArray(header) ? header[0] : header);

export function clientAddressOf(handshake, { hops = 1, header = '' } = {}) {
  const headers = handshake?.headers ?? {};
  if (hops > 0) {
    const chosen = header ? String(firstValue(headers[header.toLowerCase()]) ?? '').trim() : '';
    if (chosen) return chosen;
    const forwarded = String(firstValue(headers['x-forwarded-for']) ?? '')
      .split(',').map((part) => part.trim()).filter(Boolean);
    if (forwarded.length > 0) return forwarded[Math.max(0, forwarded.length - hops)];
  }
  return handshake?.address ?? 'unknown';
}

export const clientAddressConfig = (env = process.env) => ({
  hops: env.LOCUS_TRUST_PROXY_HOPS === undefined || env.LOCUS_TRUST_PROXY_HOPS === ''
    ? 1
    : Math.max(0, Math.floor(Number(env.LOCUS_TRUST_PROXY_HOPS)) || 0),
  header: (env.LOCUS_CLIENT_IP_HEADER ?? '').trim(),
});
