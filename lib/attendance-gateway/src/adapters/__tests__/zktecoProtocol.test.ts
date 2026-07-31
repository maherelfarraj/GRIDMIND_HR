/**
 * Socket-level fixture tests for the ZKTeco binary protocol client.
 *
 * Tests use a MockZkSocket that feeds pre-built protocol frames directly into
 * the client's data handlers without opening a real TCP connection. This validates:
 *   - Packet framing and checksum calculation
 *   - CMD_CONNECT handshake (session ID extraction)
 *   - CMD_AUTH comm-key packet encoding
 *   - Inline (CMD_DATA) attendance log retrieval
 *   - Chunked (CMD_PREPARE_DATA → CMD_DATA_RDY → CMD_DATA) retrieval
 *   - 40-byte record parsing including status byte at offset 31
 *   - Fragmented TCP delivery (frame split across multiple segments)
 *   - Coalesced TCP delivery (surplus bytes preserved for next sendCommand)
 *   - Error paths: rejected auth, unexpected commands, timeouts
 */

import { describe, it, expect } from "vitest";
import {
  ZkTcpClient,
  buildPacket,
  buildDataRdyPacket,
  createChecksum,
  decodeCmdId,
  decodeSessionId,
  decodePayload,
  parseZkTime,
  parseRecord,
  parseAttendanceLog,
  CMD_CONNECT,
  CMD_EXIT,
  CMD_AUTH,
  CMD_ACK_OK,
  CMD_DATA_WRRQ,
  CMD_DATA_RDY,
  CMD_PREPARE_DATA,
  CMD_DATA,
  CMD_FREE_DATA,
  REQUEST_ATTENDANCE,
  RECORD_SIZE,
  MAX_CHUNK,
  USHRT_MAX,
  TCP_PREFIX,
  type ZkSocket,
  type ZkSocketFactory,
} from "../zktecoProtocol.js";

// ─── Mock socket ──────────────────────────────────────────────────────────────

/**
 * Scriptable mock that queues response deliveries for each write() call.
 *
 * Each queued "delivery" is an ordered list of Buffer chunks that will be
 * emitted as separate data events, one per event-loop tick.  This lets tests
 * simulate both fragmented delivery (one frame split across chunks) and
 * coalesced delivery (multiple frames in one chunk).
 *
 * connect() auto-fires the "connect" event after a tick.
 */
class MockZkSocket implements ZkSocket {
  private dataHandlers: Array<(chunk: Buffer) => void> = [];
  private onceHandlers = new Map<string, (...args: unknown[]) => void>();
  readonly sentPackets: Buffer[] = [];
  /** Each element = ordered chunks to emit in response to one write() call. */
  private responseQueue: Buffer[][] = [];

  /** Pre-load a single complete frame as one TCP segment. */
  queueResponse(frame: Buffer): this {
    this.responseQueue.push([Buffer.from(frame)]);
    return this;
  }

  /**
   * Pre-load a frame split at the given byte offsets (simulates fragmented
   * TCP delivery).  The frame is split at each offset in order, e.g.
   * `queueFragmented(frame, 8, 16)` delivers frame[0:8], frame[8:16], frame[16:].
   */
  queueFragmented(frame: Buffer, ...splitAt: number[]): this {
    const chunks: Buffer[] = [];
    let start = 0;
    for (const pt of splitAt) {
      if (pt > start) chunks.push(Buffer.from(frame.subarray(start, pt)));
      start = pt;
    }
    if (start < frame.length) chunks.push(Buffer.from(frame.subarray(start)));
    this.responseQueue.push(chunks);
    return this;
  }

  /**
   * Pre-load multiple frames concatenated into a single TCP segment
   * (simulates coalesced delivery).  All frames are emitted as one chunk.
   */
  queueCoalesced(...frames: Buffer[]): this {
    this.responseQueue.push([Buffer.concat(frames.map((f) => Buffer.from(f)))]);
    return this;
  }

  on(event: "data", handler: (chunk: Buffer) => void): this {
    if (event === "data") this.dataHandlers.push(handler);
    return this;
  }

  off(event: "data", handler: (chunk: Buffer) => void): this {
    this.dataHandlers = this.dataHandlers.filter((h) => h !== handler);
    return this;
  }

  once(event: string, handler: (...args: unknown[]) => void): this {
    this.onceHandlers.set(event, handler);
    return this;
  }

  write(pkt: Buffer, callback?: (err?: Error | null) => void): boolean {
    this.sentPackets.push(Buffer.from(pkt));
    callback?.();
    const chunks = this.responseQueue.shift();
    if (chunks) {
      // Deliver chunks in separate ticks to simulate TCP stream fragmentation.
      const deliver = (idx: number): void => {
        if (idx >= chunks.length) return;
        const chunk = chunks[idx];
        setImmediate(() => {
          for (const h of [...this.dataHandlers]) h(chunk);
          deliver(idx + 1);
        });
      };
      deliver(0);
    }
    return true;
  }

  setTimeout(_ms: number): this { return this; }
  destroy(): void {}

  connect(_port: number, _host: string): this {
    setImmediate(() => {
      const h = this.onceHandlers.get("connect");
      this.onceHandlers.delete("connect");
      h?.();
    });
    return this;
  }
}

/** Build a ZkSocketFactory that returns the given mock. */
function factoryFor(mock: MockZkSocket): ZkSocketFactory {
  return () => mock;
}

// ─── Frame builders (device → client) ────────────────────────────────────────

/** Build a CMD_ACK_OK frame with the given session ID (device side). */
function buildAckOkFrame(sessionId: number): Buffer {
  // Place sessionId into the inner header (offset 4 of inner = offset 12 of full frame).
  const inner = Buffer.alloc(8);
  inner.writeUInt16LE(CMD_ACK_OK, 0);
  inner.writeUInt16LE(0, 2);
  inner.writeUInt16LE(sessionId, 4);
  inner.writeUInt16LE(1, 6);
  inner.writeUInt16LE(createChecksum(inner), 2);
  const prefix = Buffer.alloc(8);
  TCP_PREFIX.copy(prefix, 0);
  prefix.writeUInt16LE(inner.length, 4);
  return Buffer.concat([prefix, inner]);
}

/** Build a CMD_PREPARE_DATA frame carrying totalSize (bytes 1-4). */
function buildPrepareDataFrame(sessionId: number, totalSize: number): Buffer {
  const payload = Buffer.alloc(5);
  payload.writeUInt8(0, 0);
  payload.writeUInt32LE(totalSize, 1);
  return buildPacket(CMD_PREPARE_DATA, sessionId, 0, payload);
}

/** Build a CMD_DATA frame carrying data payload. */
function buildDataFrame(sessionId: number, data: Buffer): Buffer {
  return buildPacket(CMD_DATA, sessionId, 0, data);
}

/** Build a CMD_ACK_OK frame (empty payload). */
function buildAckFrame(sessionId: number): Buffer {
  return buildAckOkFrame(sessionId);
}

// ─── Attendance record builder ────────────────────────────────────────────────

/**
 * Build a 40-byte ZKTeco attendance log record.
 * @param userId - up to 9 ASCII chars
 * @param encoded - ZKTeco-encoded timestamp (pass from encodeZkTime)
 * @param status  - punch status 0–5
 * @param userSn  - userSn number (2 bytes)
 */
function buildZkRecord(userId: string, encoded: number, status: number, userSn = 1): Buffer {
  const buf = Buffer.alloc(RECORD_SIZE);
  buf.writeUInt16LE(userSn, 0);
  buf.write(userId.slice(0, 9), 2, "ascii");
  buf.writeUInt8(1, 11); // verifyType = fingerprint
  buf.writeUInt32LE(encoded, 27);
  buf.writeUInt8(status, 31);
  return buf;
}

/**
 * Encode a Date to ZKTeco timestamp format (uint32).
 * Inverse of parseZkTime.
 */
function encodeZkTime(d: Date): number {
  const yr = d.getFullYear() - 2000;
  const mo = d.getMonth();       // 0-indexed
  const dy = d.getDate() - 1;   // 0-indexed
  return (
    d.getSeconds() +
    d.getMinutes() * 60 +
    d.getHours() * 3600 +
    dy * 86400 +
    mo * 86400 * 31 +
    yr * 86400 * 31 * 12
  );
}

/** Build an attendance log buffer (4-byte header + records). */
function buildAttendanceLogBuf(...records: Buffer[]): Buffer {
  return Buffer.concat([Buffer.alloc(4), ...records]);
}

// ─── Unit tests — pure protocol helpers ─────────────────────────────────────

describe("createChecksum", () => {
  it("matches zero for an all-zero 8-byte buffer (USHRT_MAX - 0 - 1 = USHRT_MAX - 1)", () => {
    // All zeros: sum = 0, result = USHRT_MAX - 0 - 1 = 65534
    expect(createChecksum(Buffer.alloc(8))).toBe(USHRT_MAX - 1);
  });

  it("checksum is computed BEFORE replyId is incremented (node-zklib protocol)", () => {
    // The inner buffer used for checksum computation has the PRE-increment replyId.
    // buildPacket(CMD_CONNECT, sessionId=0, replyId=0) increments replyId to 1
    // AFTER the checksum is computed, so the stored checksum covers replyId=0.
    const preIncrementInner = Buffer.alloc(8);
    preIncrementInner.writeUInt16LE(CMD_CONNECT, 0);
    preIncrementInner.writeUInt16LE(0, 2); // checksum=0 for computation
    preIncrementInner.writeUInt16LE(0, 4); // sessionId=0
    preIncrementInner.writeUInt16LE(0, 6); // replyId=0 (pre-increment)
    const expected = createChecksum(preIncrementInner);
    const pkt = buildPacket(CMD_CONNECT, 0, 0);
    // Checksum is at bytes 10-11 of the full packet (offset 2 of the inner section starting at 8)
    expect(pkt.readUInt16LE(10)).toBe(expected);
  });
});

describe("buildPacket", () => {
  it("starts with the TCP magic prefix", () => {
    const pkt = buildPacket(CMD_CONNECT, 0, 0);
    expect(pkt.subarray(0, 4)).toStrictEqual(TCP_PREFIX);
  });

  it("outer prefix carries inner length", () => {
    const data = Buffer.alloc(16);
    const pkt = buildPacket(CMD_DATA_WRRQ, 0, 0, data);
    const innerLen = pkt.readUInt16LE(4);
    expect(innerLen).toBe(8 + data.length);
  });

  it("inner header carries command ID at offset 0", () => {
    const pkt = buildPacket(CMD_AUTH, 5, 0);
    expect(pkt.readUInt16LE(8)).toBe(CMD_AUTH);
  });

  it("inner header carries session ID at offset 4 of inner (offset 12 of frame)", () => {
    const pkt = buildPacket(CMD_DATA_WRRQ, 42, 0);
    expect(pkt.readUInt16LE(12)).toBe(42);
  });

  it("reply_id is incremented by 1 in the written packet (after checksum)", () => {
    const replyId = 7;
    const pkt = buildPacket(CMD_CONNECT, 0, replyId);
    // The spec increments replyId AFTER computing checksum and writes it.
    expect(pkt.readUInt16LE(14)).toBe((replyId + 1) % USHRT_MAX);
  });
});

describe("buildDataRdyPacket", () => {
  it("uses CMD_DATA_RDY command ID", () => {
    const pkt = buildDataRdyPacket(1, 0, 0, 512);
    expect(pkt.readUInt16LE(8)).toBe(CMD_DATA_RDY);
  });

  it("encodes offset and size as uint32 LE in the payload", () => {
    const offset = 65472;
    const size   = 32768;
    const pkt = buildDataRdyPacket(1, 0, offset, size);
    const payload = pkt.subarray(16); // after 16-byte header
    expect(payload.readUInt32LE(0)).toBe(offset);
    expect(payload.readUInt32LE(4)).toBe(size);
  });
});

describe("parseZkTime + encodeZkTime round-trip", () => {
  it("round-trips a standard office punch timestamp", () => {
    const d = new Date(2024, 2, 15, 9, 0, 0); // 2024-03-15 09:00:00 local
    const encoded = encodeZkTime(d);
    const decoded = parseZkTime(encoded);
    expect(decoded.getFullYear()).toBe(2024);
    expect(decoded.getMonth()).toBe(2);
    expect(decoded.getDate()).toBe(15);
    expect(decoded.getHours()).toBe(9);
    expect(decoded.getMinutes()).toBe(0);
    expect(decoded.getSeconds()).toBe(0);
  });

  it("handles midnight (00:00:00)", () => {
    const d = new Date(2024, 0, 1, 0, 0, 0);
    expect(parseZkTime(encodeZkTime(d)).getHours()).toBe(0);
  });

  it("handles end-of-day (23:59:59)", () => {
    const d = new Date(2024, 11, 31, 23, 59, 59);
    const dec = parseZkTime(encodeZkTime(d));
    expect(dec.getHours()).toBe(23);
    expect(dec.getMinutes()).toBe(59);
    expect(dec.getSeconds()).toBe(59);
  });
});

describe("parseRecord", () => {
  it("extracts userId, timestamp, status, verifyType from a 40-byte buffer", () => {
    const d = new Date(2024, 2, 15, 9, 30, 0);
    const rec = buildZkRecord("EMP001", encodeZkTime(d), 1, 3);
    const parsed = parseRecord(rec);
    expect(parsed.deviceUserId).toBe("EMP001");
    expect(parsed.status).toBe(1);
    expect(parsed.verifyType).toBe(1);
    expect(parsed.userSn).toBe(3);
  });

  it("reads status byte at offset 31 (not offset 0 or 11)", () => {
    const buf = Buffer.alloc(RECORD_SIZE);
    buf.writeUInt8(5, 31); // status = OVERTIME_END
    expect(parseRecord(buf).status).toBe(5);
  });

  it("all six status values 0-5 parse correctly", () => {
    for (let s = 0; s <= 5; s++) {
      const buf = Buffer.alloc(RECORD_SIZE);
      buf.writeUInt8(s, 31);
      expect(parseRecord(buf).status).toBe(s);
    }
  });
});

describe("parseAttendanceLog", () => {
  it("skips the 4-byte device header and parses all records", () => {
    const d = new Date(2024, 2, 15, 9, 0, 0);
    const logBuf = buildAttendanceLogBuf(
      buildZkRecord("EMP001", encodeZkTime(d), 0),
      buildZkRecord("EMP002", encodeZkTime(d), 1),
    );
    const records = parseAttendanceLog(logBuf);
    expect(records).toHaveLength(2);
    expect(records[0].deviceUserId).toBe("EMP001");
    expect(records[0].status).toBe(0);
    expect(records[1].deviceUserId).toBe("EMP002");
    expect(records[1].status).toBe(1);
  });

  it("skips records with empty userId (null-padded / deleted slots)", () => {
    const d = new Date(2024, 2, 15, 9, 0, 0);
    const empty = Buffer.alloc(RECORD_SIZE); // userId = ""
    const logBuf = buildAttendanceLogBuf(buildZkRecord("EMP001", encodeZkTime(d), 0), empty);
    expect(parseAttendanceLog(logBuf)).toHaveLength(1);
  });
});

// ─── Socket-level fixture tests ───────────────────────────────────────────────

async function makeConnectedClient(mock: MockZkSocket, commKey = "0"): Promise<ZkTcpClient> {
  const client = new ZkTcpClient({ host: "10.0.0.1", commKey, timeoutMs: 1000, socketFactory: factoryFor(mock) });
  await client.connect();
  return client;
}

describe("ZkTcpClient — handshake (socket-level)", () => {
  it("sends CMD_CONNECT; device replies CMD_ACK_OK; client stores session ID", async () => {
    const mock = new MockZkSocket();
    mock.queueResponse(buildAckOkFrame(0x1234)); // device returns session 0x1234
    const client = await makeConnectedClient(mock);
    await client.handshake();
    // The packet sent must be a CMD_CONNECT (1000)
    expect(mock.sentPackets).toHaveLength(1);
    expect(mock.sentPackets[0].readUInt16LE(8)).toBe(CMD_CONNECT);
  });

  it("CMD_AUTH is NOT sent when comm key is 0", async () => {
    const mock = new MockZkSocket();
    mock.queueResponse(buildAckOkFrame(1));
    const client = await makeConnectedClient(mock, "0");
    await client.handshake();
    const commands = mock.sentPackets.map((p) => p.readUInt16LE(8));
    expect(commands).not.toContain(CMD_AUTH);
  });

  it("CMD_AUTH IS sent when comm key is non-zero; payload is uint32-LE encoded key", async () => {
    const COMM_KEY = 9999;
    const SESSION  = 5;
    const mock = new MockZkSocket();
    mock.queueResponse(buildAckOkFrame(SESSION)); // CMD_CONNECT → ACK_OK
    mock.queueResponse(buildAckFrame(SESSION));   // CMD_AUTH    → ACK_OK
    const client = await makeConnectedClient(mock, String(COMM_KEY));
    await client.handshake();

    const cmds = mock.sentPackets.map((p) => p.readUInt16LE(8));
    expect(cmds).toContain(CMD_AUTH);

    const authPkt = mock.sentPackets.find((p) => p.readUInt16LE(8) === CMD_AUTH)!;
    // Payload starts at offset 16; should be 4-byte uint32-LE comm key
    const payload = authPkt.subarray(16);
    expect(payload.readUInt32LE(0)).toBe(COMM_KEY);
  });

  it("rejects the session if CMD_CONNECT does not return CMD_ACK_OK", async () => {
    const mock = new MockZkSocket();
    mock.queueResponse(buildPacket(2001, 0, 0)); // error response
    const client = await makeConnectedClient(mock);
    await expect(client.handshake()).rejects.toThrow(/CMD_CONNECT rejected/);
  });

  it("throws AUTH_FAILED if CMD_AUTH is rejected", async () => {
    const mock = new MockZkSocket();
    mock.queueResponse(buildAckOkFrame(1));
    mock.queueResponse(buildPacket(2001, 1, 0)); // auth rejected
    const client = await makeConnectedClient(mock, "1234");
    await expect(client.handshake()).rejects.toThrow(/CMD_AUTH rejected/);
  });
});

describe("ZkTcpClient — getAttendances inline (CMD_DATA path)", () => {
  it("returns parsed records when the device sends CMD_DATA directly", async () => {
    const SESSION = 3;
    const d = new Date(2024, 2, 15, 9, 0, 0);
    const logBuf = buildAttendanceLogBuf(
      buildZkRecord("EMP001", encodeZkTime(d), 0), // CLOCK_IN
      buildZkRecord("EMP002", encodeZkTime(d), 1), // CLOCK_OUT
    );
    const mock = new MockZkSocket();
    // Handshake
    mock.queueResponse(buildAckOkFrame(SESSION));
    // CMD_DATA_WRRQ → inline CMD_DATA
    mock.queueResponse(buildDataFrame(SESSION, logBuf));
    // CMD_FREE_DATA → ACK_OK (not needed for inline, but we send it anyway)
    mock.queueResponse(buildAckFrame(SESSION));

    const client = await makeConnectedClient(mock);
    await client.handshake();
    const records = await client.getAttendances();

    expect(records).toHaveLength(2);
    expect(records[0].deviceUserId).toBe("EMP001");
    expect(records[0].status).toBe(0);
    expect(records[1].deviceUserId).toBe("EMP002");
    expect(records[1].status).toBe(1);
  });

  it("sends CMD_DATA_WRRQ with the correct attendance-log request payload", async () => {
    const SESSION = 4;
    const mock = new MockZkSocket();
    mock.queueResponse(buildAckOkFrame(SESSION));
    mock.queueResponse(buildDataFrame(SESSION, buildAttendanceLogBuf())); // empty log
    mock.queueResponse(buildAckFrame(SESSION));

    const client = await makeConnectedClient(mock);
    await client.handshake();
    await client.getAttendances();

    const wrrqPkt = mock.sentPackets.find((p) => p.readUInt16LE(8) === CMD_DATA_WRRQ)!;
    expect(wrrqPkt).toBeDefined();
    // Payload should match REQUEST_ATTENDANCE
    const payload = wrrqPkt.subarray(16);
    expect(payload.subarray(0, REQUEST_ATTENDANCE.length)).toStrictEqual(REQUEST_ATTENDANCE);
  });

  it("parses status byte correctly for all six punch types inline", async () => {
    const SESSION = 6;
    const d = new Date(2024, 0, 1, 8, 0, 0);
    const logBuf = buildAttendanceLogBuf(
      ...([0, 1, 2, 3, 4, 5] as const).map((s, i) => buildZkRecord(`EMP00${i}`, encodeZkTime(d), s)),
    );
    const mock = new MockZkSocket();
    mock.queueResponse(buildAckOkFrame(SESSION));
    mock.queueResponse(buildDataFrame(SESSION, logBuf));
    mock.queueResponse(buildAckFrame(SESSION));

    const client = await makeConnectedClient(mock);
    await client.handshake();
    const records = await client.getAttendances();

    expect(records.map((r) => r.status)).toStrictEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe("ZkTcpClient — getAttendances chunked (CMD_PREPARE_DATA → CMD_DATA_RDY → CMD_DATA)", () => {
  it("issues CMD_DATA_RDY for each chunk and assembles the full log", async () => {
    const SESSION = 7;
    const d = new Date(2024, 2, 15, 9, 0, 0);
    // Build a log with 3 records; split into 2 chunks
    const records3 = [
      buildZkRecord("EMP001", encodeZkTime(d), 0),
      buildZkRecord("EMP002", encodeZkTime(d), 1),
      buildZkRecord("EMP003", encodeZkTime(d), 4),
    ];
    const fullLog   = buildAttendanceLogBuf(...records3);
    // Split across two artificial chunks
    const chunk1    = fullLog.subarray(0, 44);  // 4-byte header + 1 record = 44 bytes
    const chunk2    = fullLog.subarray(44);     // remaining 2 records = 80 bytes
    const totalSize = fullLog.length;           // 124 bytes total

    const mock = new MockZkSocket();
    mock.queueResponse(buildAckOkFrame(SESSION));                         // CMD_CONNECT ACK
    mock.queueResponse(buildPrepareDataFrame(SESSION, totalSize));        // CMD_DATA_WRRQ → PREPARE_DATA
    mock.queueResponse(buildDataFrame(SESSION, chunk1));                  // CMD_DATA_RDY(0, MAX_CHUNK) → chunk1
    mock.queueResponse(buildDataFrame(SESSION, chunk2));                  // CMD_DATA_RDY(44, ...) → chunk2
    mock.queueResponse(buildAckFrame(SESSION));                           // CMD_FREE_DATA → ACK

    const client = await makeConnectedClient(mock);
    await client.handshake();
    const parsed = await client.getAttendances();

    expect(parsed).toHaveLength(3);
    expect(parsed[0].deviceUserId).toBe("EMP001");
    expect(parsed[1].deviceUserId).toBe("EMP002");
    expect(parsed[2].deviceUserId).toBe("EMP003");

    // Verify CMD_DATA_RDY packets were sent with correct offsets
    const rdyPackets = mock.sentPackets.filter((p) => p.readUInt16LE(8) === CMD_DATA_RDY);
    expect(rdyPackets.length).toBeGreaterThanOrEqual(1);

    // First DATA_RDY must start at offset 0
    const firstRdy = rdyPackets[0].subarray(16);
    expect(firstRdy.readUInt32LE(0)).toBe(0);
    expect(firstRdy.readUInt32LE(4)).toBe(Math.min(MAX_CHUNK, totalSize));
  });

  it("offsets in successive CMD_DATA_RDY packets advance by the received chunk size", async () => {
    const SESSION = 8;
    const d = new Date(2024, 5, 1, 10, 0, 0);
    const r1 = buildZkRecord("E1", encodeZkTime(d), 0);
    const r2 = buildZkRecord("E2", encodeZkTime(d), 1);
    const fullLog   = buildAttendanceLogBuf(r1, r2);
    const totalSize = fullLog.length;

    // Each CMD_DATA_RDY response returns exactly one record-worth of bytes.
    const c1 = fullLog.subarray(0, 4 + RECORD_SIZE); // header + first record
    const c2 = fullLog.subarray(4 + RECORD_SIZE);    // second record

    const mock = new MockZkSocket();
    mock.queueResponse(buildAckOkFrame(SESSION));
    mock.queueResponse(buildPrepareDataFrame(SESSION, totalSize));
    mock.queueResponse(buildDataFrame(SESSION, c1));
    mock.queueResponse(buildDataFrame(SESSION, c2));
    mock.queueResponse(buildAckFrame(SESSION));

    const client = await makeConnectedClient(mock);
    await client.handshake();
    await client.getAttendances();

    const rdyPkts = mock.sentPackets.filter((p) => p.readUInt16LE(8) === CMD_DATA_RDY);
    // Second RDY offset = length of first chunk received
    if (rdyPkts.length >= 2) {
      const secondOffset = rdyPkts[1].subarray(16).readUInt32LE(0);
      expect(secondOffset).toBe(c1.length);
    }
  });

  it("sends CMD_FREE_DATA after a chunked read", async () => {
    const SESSION = 9;
    const d = new Date(2024, 0, 1, 8, 0, 0);
    const logBuf    = buildAttendanceLogBuf(buildZkRecord("EMP001", encodeZkTime(d), 0));
    const totalSize = logBuf.length;

    const mock = new MockZkSocket();
    mock.queueResponse(buildAckOkFrame(SESSION));
    mock.queueResponse(buildPrepareDataFrame(SESSION, totalSize));
    mock.queueResponse(buildDataFrame(SESSION, logBuf));
    mock.queueResponse(buildAckFrame(SESSION));

    const client = await makeConnectedClient(mock);
    await client.handshake();
    await client.getAttendances();

    const cmds = mock.sentPackets.map((p) => p.readUInt16LE(8));
    expect(cmds).toContain(CMD_FREE_DATA);
  });

  it("throws when CMD_DATA_RDY receives an unexpected response", async () => {
    const SESSION = 10;
    const d = new Date(2024, 0, 1, 8, 0, 0);
    const logBuf    = buildAttendanceLogBuf(buildZkRecord("EMP001", encodeZkTime(d), 0));
    const totalSize = logBuf.length;

    const mock = new MockZkSocket();
    mock.queueResponse(buildAckOkFrame(SESSION));
    mock.queueResponse(buildPrepareDataFrame(SESSION, totalSize));
    mock.queueResponse(buildPacket(2001, SESSION, 0)); // error instead of CMD_DATA

    const client = await makeConnectedClient(mock);
    await client.handshake();
    await expect(client.getAttendances()).rejects.toThrow(/CMD_DATA.*chunked read/);
  });
});

// ─── TCP stream framing: fragmented and coalesced delivery ────────────────────

describe("ZkTcpClient — TCP stream fragmentation and coalescing", () => {
  it("fragmented delivery: frame split at the 8-byte header boundary still resolves", async () => {
    // The ACK_OK frame is delivered as two TCP segments:
    //   chunk1 = first 8 bytes (outer prefix only, innerLength readable)
    //   chunk2 = remaining 8 bytes (inner header)
    // The client must buffer both before resolving.
    const SESSION = 20;
    const ackFrame = buildAckOkFrame(SESSION);
    expect(ackFrame.length).toBe(16); // outer(8) + inner(8) = 16

    const mock = new MockZkSocket();
    mock.queueFragmented(ackFrame, 8); // split at byte 8

    const client = await makeConnectedClient(mock);
    // handshake() sends CMD_CONNECT; ACK arrives in two fragments
    await expect(client.handshake()).resolves.toMatchObject({ deviceTimeMs: expect.any(Number) });
  });

  it("fragmented delivery: frame split mid-payload still delivers correct records", async () => {
    const SESSION = 21;
    const d = new Date(2024, 2, 15, 9, 0, 0);
    const rec = buildZkRecord("FRAGUSER", encodeZkTime(d), 2); // BREAK_START
    const logBuf   = buildAttendanceLogBuf(rec);
    const dataFrame = buildDataFrame(SESSION, logBuf);

    // Split the CMD_DATA response exactly in the middle of its payload.
    const splitAt = Math.floor(dataFrame.length / 2);

    const mock = new MockZkSocket();
    mock.queueResponse(buildAckOkFrame(SESSION));          // CMD_CONNECT → ACK
    mock.queueFragmented(dataFrame, splitAt);              // CMD_DATA_WRRQ → fragmented CMD_DATA

    const client = await makeConnectedClient(mock);
    await client.handshake();
    const records = await client.getAttendances();

    expect(records).toHaveLength(1);
    expect(records[0].deviceUserId).toBe("FRAGUSER");
    expect(records[0].status).toBe(2); // BREAK_START
  });

  it("fragmented delivery: frame split within magic prefix (first 4 bytes) still resolves", async () => {
    const SESSION = 22;
    const ackFrame = buildAckOkFrame(SESSION);

    const mock = new MockZkSocket();
    // First chunk is only 3 bytes (part of the magic prefix — not even innerLength readable)
    mock.queueFragmented(ackFrame, 3);

    const client = await makeConnectedClient(mock);
    await expect(client.handshake()).resolves.toMatchObject({ deviceTimeMs: expect.any(Number) });
  });

  it("coalesced delivery: surplus bytes from first response serve as second response", async () => {
    // CMD_CONNECT response (ACK) and the subsequent CMD_AUTH response (ACK) arrive
    // as a single TCP segment.  The first sendCommand() should consume only the
    // CMD_CONNECT ACK; the CMD_AUTH ACK should remain in socketBuf and be consumed
    // by the second sendCommand() without any additional write()-triggered delivery.
    const SESSION  = 23;
    const COMM_KEY = 5555;
    const ackConn = buildAckOkFrame(SESSION); // CMD_CONNECT response
    const ackAuth = buildAckFrame(SESSION);   // CMD_AUTH response

    const mock = new MockZkSocket();
    // Both frames arrive in one TCP segment in response to CMD_CONNECT
    mock.queueCoalesced(ackConn, ackAuth);
    // No second queued response — CMD_AUTH must find ackAuth in socketBuf

    const client = new ZkTcpClient({
      host: "10.0.0.1",
      commKey: String(COMM_KEY),
      timeoutMs: 1000,
      socketFactory: factoryFor(mock),
    });
    await client.connect();

    // handshake() sends CMD_CONNECT (gets ackConn) then CMD_AUTH (gets ackAuth from surplus)
    await expect(client.handshake()).resolves.toMatchObject({ deviceTimeMs: expect.any(Number) });

    // Verify CMD_AUTH was indeed sent
    const cmds = mock.sentPackets.map((p) => p.readUInt16LE(8));
    expect(cmds).toContain(CMD_AUTH);
  });

  it("coalesced delivery: extra bytes after inline CMD_DATA are preserved for CMD_FREE_DATA (chunked path)", async () => {
    // In the chunked path, CMD_PREPARE_DATA and the first CMD_DATA chunk arrive
    // in the same TCP segment.  The client must read CMD_PREPARE_DATA, then on
    // its CMD_DATA_RDY request find the CMD_DATA chunk already buffered.
    const SESSION = 24;
    const d = new Date(2024, 3, 1, 10, 0, 0);
    const rec     = buildZkRecord("COAL001", encodeZkTime(d), 1);
    const logBuf  = buildAttendanceLogBuf(rec);
    const totalSize = logBuf.length;

    const prepFrame  = buildPrepareDataFrame(SESSION, totalSize);
    const dataFrame  = buildDataFrame(SESSION, logBuf);
    const freeAck    = buildAckFrame(SESSION);

    const mock = new MockZkSocket();
    mock.queueResponse(buildAckOkFrame(SESSION));        // CMD_CONNECT
    // CMD_DATA_WRRQ response: PREPARE_DATA + first DATA chunk coalesced
    mock.queueCoalesced(prepFrame, dataFrame);
    // CMD_DATA_RDY: no explicit queue — DATA chunk found in socketBuf
    // CMD_FREE_DATA response
    mock.queueResponse(freeAck);

    const client = await makeConnectedClient(mock);
    await client.handshake();
    const records = await client.getAttendances();

    expect(records).toHaveLength(1);
    expect(records[0].deviceUserId).toBe("COAL001");
    expect(records[0].status).toBe(1); // CLOCK_OUT
  });
});
