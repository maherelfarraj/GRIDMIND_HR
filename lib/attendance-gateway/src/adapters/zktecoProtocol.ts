/**
 * Minimal standalone ZKTeco TCP protocol client.
 *
 * Implements the ZKTeco standalone-SDK binary protocol (port 4370) using
 * Node.js built-in modules only (no vendor SDK required). Features:
 *   - TCP framing: 8-byte magic prefix + 8-byte inner header + payload
 *   - CMD_CONNECT handshake with session-ID extraction
 *   - CMD_AUTH communication-key authentication (plain uint32-LE; see note)
 *   - Attendance log retrieval: inline (CMD_DATA) and chunked (CMD_PREPARE_DATA
 *     → repeated CMD_DATA_RDY → CMD_DATA chunks) paths
 *   - Full 40-byte record parsing including the status byte (offset 31)
 *
 * COMM-KEY NOTE: ZKTeco firmware documents two auth variants. The plain
 * uint32-LE CMD_AUTH payload works on devices running the common standalone
 * firmware (comm key ≤ 65535). Rare firmware builds implement a session-
 * derived XOR challenge; those require on-site testing with the real device
 * and the official vendor SDK. When CMD_AUTH is rejected the adapter reports
 * AUTH_FAILED so the operator can fall back to the ZKTECO middleware path.
 *
 * References: ZKTeco standalone SDK documentation; node-zklib source code
 * (https://github.com/caobo171/node-zklib) for checksum algorithm, command
 * IDs, record format, and time encoding.
 *
 * TESTING: ZkTcpClient accepts an optional injectable ZkSocketFactory so
 * socket-level fixture tests can feed pre-built protocol frames without
 * opening a real TCP connection.
 */

import * as net from "net";

// ─── Protocol constants (exported for tests) ──────────────────────────────────

export const USHRT_MAX = 65535;

/** ZKTeco TCP packet magic prefix. */
export const TCP_PREFIX = Buffer.from([0x50, 0x50, 0x82, 0x7d]);

export const CMD_CONNECT      = 1000;
export const CMD_EXIT         = 1001;
export const CMD_AUTH         = 1102;
export const CMD_ACK_OK       = 2000;
export const CMD_DATA_WRRQ    = 1503; // request bulk data
export const CMD_DATA_RDY     = 1504; // ask device for one chunk
export const CMD_PREPARE_DATA = 1500; // device signals total size
export const CMD_DATA         = 1501; // device returns a data chunk
export const CMD_FREE_DATA    = 1502; // release device buffer

/** Request payload for the attendance log. */
export const REQUEST_ATTENDANCE = Buffer.from([0x01, 0x0d, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

/** Size of each attendance log record. */
export const RECORD_SIZE = 40;

/** Maximum chunk size requested per CMD_DATA_RDY. */
export const MAX_CHUNK = 65472;

// ─── Protocol helpers (exported for tests) ───────────────────────────────────

/**
 * ZKTeco ones-complement checksum.
 * Computed over the entire inner buffer (with the checksum field set to 0).
 */
export function createChecksum(buf: Buffer): number {
  let chksum = 0;
  for (let i = 0; i < buf.length; i += 2) {
    chksum += i === buf.length - 1 ? buf[i] : buf.readUInt16LE(i);
    chksum %= USHRT_MAX;
  }
  return USHRT_MAX - chksum - 1;
}

/**
 * Build a ZKTeco TCP frame: outer prefix (8 bytes) + inner header (8 bytes)
 * + data payload.
 */
export function buildPacket(command: number, sessionId: number, replyId: number, data: Buffer = Buffer.alloc(0)): Buffer {
  const inner = Buffer.alloc(8 + data.length);
  inner.writeUInt16LE(command, 0);
  inner.writeUInt16LE(0, 2);          // checksum placeholder
  inner.writeUInt16LE(sessionId, 4);
  inner.writeUInt16LE(replyId, 6);
  data.copy(inner, 8);
  inner.writeUInt16LE(createChecksum(inner), 2); // fill checksum
  inner.writeUInt16LE((replyId + 1) % USHRT_MAX, 6); // increment reply_id last

  const prefix = Buffer.alloc(8);
  TCP_PREFIX.copy(prefix, 0);
  prefix.writeUInt16LE(inner.length, 4);
  return Buffer.concat([prefix, inner]);
}

/** Decode the command ID from the inner header of a received frame. */
export function decodeCmdId(frame: Buffer): number {
  return frame.length >= 16 ? frame.readUInt16LE(8) : -1;
}

/** Decode the session ID from the inner header of a received frame. */
export function decodeSessionId(frame: Buffer): number {
  return frame.length >= 16 ? frame.readUInt16LE(12) : 0;
}

/** Extract the inner payload (bytes after the 16-byte header). */
export function decodePayload(frame: Buffer): Buffer {
  return frame.length > 16 ? frame.subarray(16) : Buffer.alloc(0);
}

/**
 * Build a CMD_DATA_RDY request packet to pull one chunk from the device.
 * @param offset - byte offset into the device's prepared data buffer
 * @param size   - number of bytes to request (≤ MAX_CHUNK)
 */
export function buildDataRdyPacket(sessionId: number, replyId: number, offset: number, size: number): Buffer {
  const data = Buffer.alloc(8);
  data.writeUInt32LE(offset, 0);
  data.writeUInt32LE(size, 4);
  return buildPacket(CMD_DATA_RDY, sessionId, replyId, data);
}

/**
 * Parse a ZKTeco custom timestamp (uint32 LE, encoding seconds since a
 * device-local custom epoch starting 2000-01-01).
 */
export function parseZkTime(t: number): Date {
  const second = t % 60; t = (t - second) / 60;
  const minute = t % 60; t = (t - minute) / 60;
  const hour   = t % 24; t = (t - hour) / 24;
  const day    = t % 31; t = (t - day) / 31;
  const month  = t % 12; t = (t - month) / 12;
  return new Date(2000 + t, month, day + 1, hour, minute, second);
}

/** Parse a single 40-byte attendance log record. */
export function parseRecord(buf: Buffer): ZkRawRecord {
  return {
    userSn:       buf.readUInt16LE(0),
    deviceUserId: buf.slice(2, 11).toString("ascii").split("\0")[0] ?? "",
    verifyType:   buf.readUInt8(11),
    recordTime:   parseZkTime(buf.readUInt32LE(27)),
    status:       buf.readUInt8(31),
  };
}

/** Parse a complete attendance log buffer (with 4-byte device header) into records. */
export function parseAttendanceLog(buf: Buffer): ZkRawRecord[] {
  const records: ZkRawRecord[] = [];
  let offset = 4; // skip 4-byte device header
  while (offset + RECORD_SIZE <= buf.length) {
    const rec = parseRecord(buf.subarray(offset, offset + RECORD_SIZE));
    if (rec.deviceUserId) records.push(rec);
    offset += RECORD_SIZE;
  }
  return records;
}

// ─── ZkRawRecord ──────────────────────────────────────────────────────────────

export interface ZkRawRecord {
  userSn: number;
  deviceUserId: string;
  verifyType: number;
  recordTime: Date;
  /** Punch status 0–5 (maps to ZK_PUNCH_STATE). */
  status: number;
}

// ─── Injectable socket interface ──────────────────────────────────────────────

/**
 * Minimal socket interface used by ZkTcpClient.
 * Real code uses net.Socket; tests inject a mock that feeds pre-built frames.
 */
export interface ZkSocket {
  on(event: "data", handler: (chunk: Buffer) => void): this;
  off(event: "data", handler: (chunk: Buffer) => void): this;
  once(event: "connect" | "error" | "close" | "timeout", handler: (...args: unknown[]) => void): this;
  write(data: Buffer, callback?: (err?: Error | null) => void): boolean;
  setTimeout(ms: number): this;
  destroy(): void;
  connect(port: number, host: string): this;
}

/** Factory that creates a ZkSocket — real or mock. */
export type ZkSocketFactory = () => ZkSocket;

function defaultSocketFactory(): ZkSocketFactory {
  return () => new net.Socket() as unknown as ZkSocket;
}

// ─── TCP client ───────────────────────────────────────────────────────────────

export interface ZkClientOptions {
  host: string;
  port?: number;
  commKey?: string;
  timeoutMs?: number;
  /** Injectable socket factory for tests. */
  socketFactory?: ZkSocketFactory;
}

export class ZkTcpClient {
  private readonly host: string;
  private readonly port: number;
  private readonly commKey: number;
  private readonly timeoutMs: number;
  private readonly socketFactory: ZkSocketFactory;

  private socket: ZkSocket | null = null;
  private sessionId = 0;
  private replyId   = 0;
  /**
   * Persistent socket-level receive buffer.
   * TCP is a byte stream; a single recv() may deliver less than one frame
   * (fragmented) or more than one frame (coalesced). This buffer accumulates
   * bytes across all data events and sendCommand() extracts exactly one
   * complete frame per call, leaving any surplus bytes for the next call.
   */
  private socketBuf = Buffer.alloc(0);

  constructor(opts: ZkClientOptions) {
    this.host          = opts.host;
    this.port          = opts.port ?? 4370;
    this.commKey       = parseInt(opts.commKey ?? "0", 10) || 0;
    this.timeoutMs     = opts.timeoutMs ?? 5000;
    this.socketFactory = opts.socketFactory ?? defaultSocketFactory();
  }

  /** Open the TCP connection and register the persistent data accumulator. */
  async connect(): Promise<void> {
    const sock = this.socketFactory();
    await new Promise<void>((resolve, reject) => {
      sock.setTimeout(this.timeoutMs);
      sock.once("connect", resolve as () => void);
      sock.once("error", reject as (e: unknown) => void);
      sock.once("timeout", () => reject(new Error(`ZKTeco: connect timeout to ${this.host}:${this.port}`)));
      sock.connect(this.port, this.host);
    });
    // Single persistent listener — accumulates bytes into socketBuf so they are
    // available to the next sendCommand() call even if they arrive between calls.
    sock.on("data", (chunk: Buffer) => {
      this.socketBuf = Buffer.concat([this.socketBuf, chunk]);
    });
    this.socketBuf = Buffer.alloc(0);
    this.socket = sock;
  }

  /** Close the TCP connection cleanly. */
  async disconnect(): Promise<void> {
    if (!this.socket) return;
    try { await this.sendCommand(CMD_EXIT, Buffer.alloc(0)); } catch { /* best-effort */ }
    this.socket.destroy();
    this.socket = null;
    this.socketBuf = Buffer.alloc(0);
  }

  /**
   * Send one command and wait for exactly one complete response frame.
   *
   * Frame length is determined from the outer prefix:
   *   totalBytes = 8 (outer prefix) + innerLength (bytes 4-5 of prefix)
   *
   * Surplus bytes past the end of the frame are kept in `socketBuf` and will
   * be consumed by the next sendCommand() call, correctly handling both
   * fragmented delivery (frame split across multiple TCP segments) and
   * coalesced delivery (multiple frames in one TCP segment).
   */
  sendCommand(command: number, data: Buffer, isConnect = false): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const sock = this.socket;
      if (!sock) { reject(new Error("ZKTeco: not connected")); return; }

      if (isConnect) { this.sessionId = 0; this.replyId = 0; }
      const pkt = buildPacket(command, this.sessionId, this.replyId, data);
      this.replyId = (this.replyId + 1) % USHRT_MAX;

      /**
       * Try to extract one complete frame from socketBuf.
       * Returns true (and resolves) when a complete frame is available;
       * false when more bytes are needed.
       */
      const tryConsume = (): boolean => {
        // Need at least the 8-byte outer prefix to know the frame length.
        if (this.socketBuf.length < 8) return false;
        const innerLength    = this.socketBuf.readUInt16LE(4);
        const totalFrameLen  = 8 + innerLength;
        if (this.socketBuf.length < totalFrameLen) return false;

        // Extract the frame and preserve surplus bytes for the next call.
        const frame = Buffer.from(this.socketBuf.subarray(0, totalFrameLen));
        this.socketBuf = this.socketBuf.subarray(totalFrameLen);
        clearTimeout(timer);
        // Remove our one-shot watcher (the persistent accumulator stays).
        sock.off("data", onMoreData);
        resolve(frame);
        return true;
      };

      const timer = setTimeout(() => {
        sock.off("data", onMoreData);
        reject(new Error(`ZKTeco: timeout waiting for response to cmd ${command}`));
      }, this.timeoutMs);

      // Watcher that re-tries consumption whenever new bytes arrive.
      const onMoreData = (_chunk: Buffer): void => {
        // socketBuf already updated by the persistent accumulator — just retry.
        tryConsume();
      };

      sock.on("data", onMoreData);

      // Write the command; also attempt to consume immediately in case bytes
      // from a previous (pipelined) response are already in socketBuf.
      sock.write(pkt, (err) => {
        if (err) { clearTimeout(timer); sock.off("data", onMoreData); reject(err); return; }
        tryConsume(); // surplus bytes may already satisfy the requirement
      });
    });
  }

  /**
   * Perform the CMD_CONNECT handshake; optionally authenticate with the
   * configured comm key via CMD_AUTH.
   *
   * Comm-key encoding: plain uint32-LE. This covers devices running the
   * common standalone firmware. If the device rejects CMD_AUTH, the error
   * propagates so the adapter can report AUTH_FAILED.
   */
  async handshake(): Promise<{ deviceTimeMs: number }> {
    const reply = await this.sendCommand(CMD_CONNECT, Buffer.alloc(0), true);
    if (decodeCmdId(reply) !== CMD_ACK_OK) {
      throw new Error(`ZKTeco: CMD_CONNECT rejected (cmd=${decodeCmdId(reply)})`);
    }
    this.sessionId = decodeSessionId(reply);

    if (this.commKey !== 0) {
      const keyBuf = Buffer.alloc(4);
      keyBuf.writeUInt32LE(this.commKey >>> 0, 0);
      const authReply = await this.sendCommand(CMD_AUTH, keyBuf);
      if (decodeCmdId(authReply) !== CMD_ACK_OK) {
        throw new Error(
          `ZKTeco: CMD_AUTH rejected (cmd=${decodeCmdId(authReply)}) — ` +
          "check ZKTECO_COMM_KEY; some firmware requires on-site validation with the vendor SDK",
        );
      }
    }

    return { deviceTimeMs: Date.now() };
  }

  /**
   * Read all attendance log records from the device.
   *
   * Two device response paths:
   *   - CMD_DATA (inline): small log returned in a single frame.
   *   - CMD_PREPARE_DATA → chunks: large log; we issue one CMD_DATA_RDY
   *     per chunk (specifying offset + size), receive the chunk in CMD_DATA,
   *     and repeat until all bytes are collected; then free with CMD_FREE_DATA.
   */
  async getAttendances(): Promise<ZkRawRecord[]> {
    const reply = await this.sendCommand(CMD_DATA_WRRQ, REQUEST_ATTENDANCE);
    const cmdId = decodeCmdId(reply);

    let fullBuf: Buffer;

    if (cmdId === CMD_DATA) {
      fullBuf = decodePayload(reply);
    } else if (cmdId === CMD_PREPARE_DATA) {
      const sizePayload = decodePayload(reply);
      // Total size of prepared data is at bytes 1-4 of the payload.
      const totalSize = sizePayload.readUInt32LE(1);
      fullBuf = await this.fetchChunks(totalSize);
      await this.sendCommand(CMD_FREE_DATA, Buffer.alloc(0));
    } else {
      throw new Error(`ZKTeco: unexpected response to CMD_DATA_WRRQ (cmd=${cmdId})`);
    }

    return parseAttendanceLog(fullBuf);
  }

  /**
   * Pull prepared data from the device using CMD_DATA_RDY chunk requests.
   *
   * For each chunk:
   *   1. Build CMD_DATA_RDY(sessionId, replyId, offset, chunkSize)
   *   2. Await CMD_DATA response containing the chunk payload
   *   3. Advance offset by the chunk payload length
   * Repeat until totalSize bytes have been received.
   */
  private async fetchChunks(totalSize: number): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let offset = 0;

    while (offset < totalSize) {
      const chunkSize = Math.min(MAX_CHUNK, totalSize - offset);

      // Build and send CMD_DATA_RDY with current offset + requested size.
      const rdyData = Buffer.alloc(8);
      rdyData.writeUInt32LE(offset, 0);
      rdyData.writeUInt32LE(chunkSize, 4);
      const chunkReply = await this.sendCommand(CMD_DATA_RDY, rdyData);

      const chunkCmdId = decodeCmdId(chunkReply);
      if (chunkCmdId !== CMD_DATA) {
        throw new Error(`ZKTeco: expected CMD_DATA (${CMD_DATA}) in chunked read at offset ${offset}, got ${chunkCmdId}`);
      }

      const chunk = decodePayload(chunkReply);
      if (chunk.length === 0) break; // device signals end early
      chunks.push(chunk);
      offset += chunk.length;
    }

    return Buffer.concat(chunks);
  }
}
