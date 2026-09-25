import dgram from 'dgram';

// Determines which local IP the OS would use to reach `host` — by "connecting"
// a UDP socket to it (no packets actually sent; UDP connect() just picks a
// route/source address) and reading back the address it bound to. This is
// the same address our SSH session to that host is already using, which is
// exactly what we need for a TFTP push: guessing wrong here (e.g. blindly
// picking "the" local IP) is how we lost an afternoon to a NAT/VPN routing
// mismatch earlier — the switch's TFTP client would connect back to an
// address that isn't actually reachable from it.
export function getLocalAddressFor(host: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    sock.once('error', (err) => { sock.close(); reject(err); });
    sock.connect(1, host, () => {
      try {
        const { address } = sock.address();
        sock.close();
        resolve(address);
      } catch (err) {
        sock.close();
        reject(err);
      }
    });
  });
}
