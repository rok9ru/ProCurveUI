import dgram from 'dgram';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

const OP = { RRQ: 1, WRQ: 2, DATA: 3, ACK: 4, ERROR: 5 };
const BLOCK_SIZE = 512;
const RETRY_TIMEOUT_MS = 3000;
const MAX_RETRIES = 5;

interface TransferState {
  clientAddress: string;
  clientPort: number;
  blockNum: number;
  retries: number;
  timer: ReturnType<typeof setTimeout> | null;
}

// Minimal read-only TFTP server (RFC 1350), serving exactly one file for the
// life of the instance — this is a one-shot "push this firmware image" tool,
// not a general file server. Replies from the same socket bound to port 69
// for the whole exchange (not a fresh ephemeral port per RFC 1350) because
// some switch-side NAT/firewalls only recognize a reply that comes back from
// port 69 as part of the same flow — a reply from a different source port
// gets silently dropped. Verified against real hardware this session.
export class TftpServer extends EventEmitter {
  private socket: dgram.Socket | null = null;
  private fileData: Buffer;
  private fileName: string;
  private totalBlocks: number;
  private transfer: TransferState | null = null;

  constructor(filePath: string) {
    super();
    this.fileData = fs.readFileSync(filePath);
    this.fileName = path.basename(filePath);
    this.totalBlocks = Math.ceil(this.fileData.length / BLOCK_SIZE) || 1;
  }

  get fileSize(): number {
    return this.fileData.length;
  }

  start(bindIp: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket('udp4');
      this.socket = socket;
      socket.on('message', (msg, rinfo) => this.onMessage(msg, rinfo));
      socket.once('error', (err) => {
        this.emit('error', err);
        reject(err);
      });
      socket.bind(69, bindIp, () => resolve());
    });
  }

  stop(): void {
    if (this.transfer?.timer) clearTimeout(this.transfer.timer);
    this.transfer = null;
    try { this.socket?.close(); } catch { /* already closed */ }
    this.socket = null;
  }

  // Resolves true once a client has fully downloaded the file, false if
  // `timeoutMs` elapses first (the switch's own `copy tftp` command has its
  // own, usually shorter, give-up logic — this is just a safety backstop).
  waitForCompletion(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        this.removeListener('complete', onComplete);
        this.removeListener('error', onError);
        resolve(ok);
      };
      const onComplete = () => done(true);
      const onError = () => done(false);
      this.once('complete', onComplete);
      this.once('error', onError);
      setTimeout(() => done(false), timeoutMs);
    });
  }

  private blockPayload(n: number): Buffer {
    const start = (n - 1) * BLOCK_SIZE;
    return this.fileData.subarray(start, Math.min(start + BLOCK_SIZE, this.fileData.length));
  }

  private sendBlock(): void {
    if (!this.transfer || !this.socket) return;
    const { clientAddress, clientPort, blockNum } = this.transfer;
    const payload = this.blockPayload(blockNum);
    const pkt = Buffer.alloc(4 + payload.length);
    pkt.writeUInt16BE(OP.DATA, 0);
    pkt.writeUInt16BE(blockNum & 0xffff, 2);
    payload.copy(pkt, 4);
    this.socket.send(pkt, clientPort, clientAddress);

    this.emit('progress', {
      block: blockNum,
      totalBlocks: this.totalBlocks,
      bytesSent: Math.min(blockNum * BLOCK_SIZE, this.fileData.length),
      totalBytes: this.fileData.length,
    });

    if (this.transfer.timer) clearTimeout(this.transfer.timer);
    this.transfer.timer = setTimeout(() => {
      if (!this.transfer) return;
      this.transfer.retries++;
      if (this.transfer.retries > MAX_RETRIES) {
        this.emit('error', new Error(`No ACK for block ${blockNum} after ${MAX_RETRIES} retries`));
        this.transfer = null;
        return;
      }
      this.sendBlock();
    }, RETRY_TIMEOUT_MS);
  }

  private sendError(address: string, port: number, code: number, msg: string): void {
    if (!this.socket) return;
    const buf = Buffer.alloc(4 + msg.length + 1);
    buf.writeUInt16BE(OP.ERROR, 0);
    buf.writeUInt16BE(code, 2);
    buf.write(msg, 4, 'ascii');
    buf[4 + msg.length] = 0;
    this.socket.send(buf, port, address);
  }

  private onMessage(msg: Buffer, rinfo: dgram.RemoteInfo): void {
    const op = msg.readUInt16BE(0);

    if (op === OP.RRQ) {
      let offset = 2;
      const end1 = msg.indexOf(0, offset);
      const filename = msg.toString('ascii', offset, end1);
      this.emit('log', `RRQ from ${rinfo.address}:${rinfo.port} file="${filename}"`);

      if (path.basename(filename) !== this.fileName) {
        this.sendError(rinfo.address, rinfo.port, 1, 'File not found');
        return;
      }
      if (this.transfer?.timer) clearTimeout(this.transfer.timer);
      this.transfer = { clientAddress: rinfo.address, clientPort: rinfo.port, blockNum: 1, retries: 0, timer: null };
      this.sendBlock();
      return;
    }

    if (op === OP.WRQ) {
      this.sendError(rinfo.address, rinfo.port, 2, 'write not supported');
      return;
    }

    if (!this.transfer || rinfo.address !== this.transfer.clientAddress) return;

    if (op === OP.ACK) {
      const ackedBlock = msg.readUInt16BE(2);
      if (ackedBlock !== this.transfer.blockNum) return; // stale/duplicate ack
      this.transfer.clientPort = rinfo.port;
      this.transfer.retries = 0;
      if (this.transfer.blockNum >= this.totalBlocks) {
        this.emit('log', `transfer complete (${this.totalBlocks} blocks)`);
        if (this.transfer.timer) clearTimeout(this.transfer.timer);
        this.transfer = null;
        this.emit('complete');
        return;
      }
      this.transfer.blockNum++;
      this.sendBlock();
    } else if (op === OP.ERROR) {
      const offset = 4;
      const end = msg.indexOf(0, offset);
      const errMsg = msg.toString('ascii', offset, end);
      this.emit('error', new Error(`Client sent ERROR: ${errMsg}`));
      this.transfer = null;
    }
  }
}

export default TftpServer;
