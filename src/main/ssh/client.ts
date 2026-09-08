import { Client, ClientChannel } from 'ssh2';
import { EventEmitter } from 'events';
import type { SSHConnectionConfig } from '../../types/ssh.js';

// Emits 'log' events (raw SSH protocol debug lines and stripped terminal
// data) so the renderer can show a live SSH log — see ssh:log in index.ts.
export class SSHClient extends EventEmitter {
  private client: Client | null = null;
  private shellStream: ClientChannel | null = null;
  private isConnected: boolean = false;
  private config: SSHConnectionConfig | null = null;
  // Matches ProCurve prompts: "Switch-name> ", "Switch-name# ", "Switch-name(config)# ", etc.
  private promptRegex: RegExp = /[>#]\s*$/;
  private paginationRegex: RegExp = /-- MORE --/i;
  // Serialize all execute() calls — SSH shell is a single stream, no concurrent commands
  private execQueue: Array<() => void> = [];
  private execRunning: boolean = false;
  // Login banner (e.g. "ProCurve J9279A Switch 2510G-24") — the only place the
  // real hardware model appears; `show system`/`show version` never print it.
  private banner: string = '';

  private stripAnsi(str: string): string {
    // Must consume the leading ESC (0x1B) itself, not just the "[...letter"
    // part after it — otherwise a stray ESC is left behind wherever a CSI
    // sequence follows text within the same chunk (e.g. a prompt immediately
    // followed by a cursor reposition). That leftover byte survives .trim()
    // (it isn't whitespace), so promptRegex's trailing "#"/">" check can miss
    // a prompt that arrived just fine — seen in practice on this switch,
    // which repositions the cursor right after printing its prompt.
    return str
      .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
      .replace(/\r/g, '');
  }

  async connect(config: SSHConnectionConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      this.config = config;
      this.client = new Client();

      this.client.on('ready', async () => {
        try {
          this.shellStream = await this.openShell();
          this.isConnected = true;
          try {
            await this.execute('no page', 5000);
          } catch {
            // pagination might not be disableable; handle manually
          }
          resolve();
        } catch (err) {
          this.client?.end();
          reject(err);
        }
      });

      this.client.on('error', (err) => {
        this.isConnected = false;
        reject(new Error(`SSH connection error: ${err.message}`));
      });

      this.client.on('close', () => {
        this.isConnected = false;
        this.shellStream = null;
      });

      this.client.connect({
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        readyTimeout: config.readyTimeout || 30000,
        tryKeyboard: config.tryKeyboard || true,
        debug: (msg: string) => {
          console.log('[SSH DEBUG]', msg);
          this.emit('log', `[SSH] ${msg}`);
        },
        algorithms: {
          kex: [
            'diffie-hellman-group-exchange-sha1',
            'diffie-hellman-group14-sha1',
            'diffie-hellman-group14-sha256',
          ] as any,
          cipher: [
            'aes128-cbc',
            'aes192-cbc',
            'aes256-cbc',
            '3des-cbc',
            'aes128-ctr',
            'aes192-ctr',
            'aes256-ctr',
          ] as any,
          serverHostKey: ['ssh-rsa', 'ssh-dss'] as any,
          hmac: ['hmac-sha1', 'hmac-sha1-96', 'hmac-md5'] as any,
        },
      });
    });
  }

  // The switch's login banner/prompt sequence can simply never arrive (seen in
  // practice on overloaded/flaky ProCurve units) — without a timeout this left
  // connect() hanging forever with no error, stuck on "Connecting..." in the UI.
  private openShell(timeoutMs: number = 20000): Promise<ClientChannel> {
    return new Promise((resolve, reject) => {
      this.client!.shell({ term: 'vt100', cols: 2000, rows: 1000 }, (err, stream) => {
        if (err) return reject(err);

        let buffer = '';
        this.banner = '';

        const timeoutId = setTimeout(() => {
          stream.removeListener('data', onData);
          reject(new Error(`Timed out after ${timeoutMs}ms waiting for the switch's shell prompt — it may be slow or unresponsive.`));
        }, timeoutMs);

        const onData = (data: Buffer) => {
          const chunk = this.stripAnsi(data.toString());
          this.emit('log', `[DATA] ${chunk}`);
          buffer += chunk;

          if (buffer.includes('Press any key to continue') || buffer.includes('Press any key to configure')) {
            // The pagination gate's banner text must survive the buffer reset below.
            this.banner += buffer;
            stream.write('\n');
            buffer = '';
            return;
          }

          if (this.promptRegex.test(buffer.trim())) {
            clearTimeout(timeoutId);
            this.banner += buffer;
            stream.removeListener('data', onData);
            resolve(stream);
          }
        };
        stream.on('data', onData);
        stream.on('error', (e) => console.error('Shell stream error:', e));
      });
    });
  }

  async disconnect(): Promise<void> {
    if (this.shellStream) {
      try { this.shellStream.write('exit\n'); } catch {}
      this.shellStream.end();
    }
    if (this.client) {
      this.client.end();
      this.isConnected = false;
    }
  }

  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  getBanner(): string {
    return this.banner;
  }

  async execute(command: string, timeout: number = 20000): Promise<string> {
    if (!this.isConnected || !this.shellStream) {
      throw new Error('SSH client not connected');
    }
    // Serialize: queue this call and run it only after any ongoing command finishes
    return new Promise((resolve, reject) => {
      const run = () => {
        this.execRunning = true;
        this._executeNow(command, timeout).then(
          (result) => { this.execRunning = false; this._drainQueue(); resolve(result); },
          (err)    => { this.execRunning = false; this._drainQueue(); reject(err); }
        );
      };
      if (this.execRunning) {
        this.execQueue.push(run);
      } else {
        run();
      }
    });
  }

  private _drainQueue() {
    const next = this.execQueue.shift();
    if (next) next();
  }

  private _executeNow(command: string, timeout: number): Promise<string> {
    return new Promise((resolve, reject) => {
      let buffer = '';
      let fullOutput = '';

      const timeoutId = setTimeout(() => {
        this.shellStream?.removeListener('data', onData);
        reject(new Error(`Command timeout after ${timeout}ms: ${command}`));
      }, timeout);

      const onData = (data: Buffer) => {
        const chunk = this.stripAnsi(data.toString());
        this.emit('log', `[DATA] ${chunk}`);
        buffer += chunk;
        fullOutput += chunk;

        if (this.paginationRegex.test(buffer)) {
          this.shellStream!.write(' ');
          buffer = '';
          return;
        }

        if (this.promptRegex.test(buffer.trim())) {
          clearTimeout(timeoutId);
          this.shellStream!.removeListener('data', onData);

          const lines = fullOutput.split('\n');
          const resultLines = lines.filter(line => {
            const trimmed = line.trim();
            return trimmed !== '' &&
              !trimmed.endsWith(command.trim()) &&
              !this.promptRegex.test(trimmed) &&
              !this.paginationRegex.test(trimmed);
          });

          resolve(resultLines.join('\n').trim());
        }
      };

      this.shellStream!.on('data', onData);
      this.emit('log', `[SEND] ${command}`);
      this.shellStream!.write(command + '\n');
    });
  }

  async executeSequence(commands: string[]): Promise<string[]> {
    const results: string[] = [];
    for (const cmd of commands) {
      results.push(await this.execute(cmd));
    }
    return results;
  }

  // Run commands in config mode, exit back to manager mode when done.
  async executeInteractive(commands: string[]): Promise<string> {
    const results: string[] = [];
    await this.execute('config', 8000);
    for (const cmd of commands) {
      try {
        const out = await this.execute(cmd, 10000);
        if (out) results.push(out);
      } catch (e: any) {
        results.push(`Error: ${e.message}`);
      }
    }
    try { await this.execute('end', 5000); } catch {}
    return results.join('\n');
  }
}

export default SSHClient;
