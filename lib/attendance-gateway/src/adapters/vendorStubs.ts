import type { DeviceAdapter, GatewayPunch, AdapterTestResult } from "../types.js";

/**
 * VENDOR SDK DEPENDENCY — explicitly flagged.
 *
 * ZKTeco and Suprema devices speak proprietary binary protocols (ZKTeco
 * "PUSH"/UDP 4370 protocol; Suprema BioStar SDK / TCP). Implementing real
 * ingestion requires either:
 *   - the vendor's licensed SDK / driver installed on the gateway host, or
 *   - a physical device on the network to reverse the protocol against.
 * Neither is available in this environment, so these adapters return a clear
 * "requires vendor SDK" status instead of pretending to connect. Sites can
 * use GENERIC_REST (if the device middleware exposes HTTP), CSV import, or
 * the simulator until the SDK integration is done on real hardware.
 *
 * IMPORTANT: even once implemented, these adapters must only forward punch
 * metadata — raw biometric templates never leave the device layer.
 */
abstract class VendorSdkStubAdapter implements DeviceAdapter {
  abstract readonly type: "ZKTECO" | "SUPREMA";
  protected abstract vendorLabel: string;

  async testConnection(): Promise<AdapterTestResult> {
    return {
      ok: false,
      requiresVendorSdk: true,
      message:
        `${this.vendorLabel} integration requires the vendor SDK/licensed driver and a physical device on the network. ` +
        `Use GENERIC_REST, CSV import, or SIMULATOR until the SDK is installed on the gateway host.`,
    };
  }

  async poll(_sinceCursor: string | null): Promise<{ punches: GatewayPunch[]; nextCursor: string | null }> {
    throw new Error(`${this.vendorLabel} adapter not operational: vendor SDK not installed`);
  }
}

export class ZktecoAdapter extends VendorSdkStubAdapter {
  readonly type = "ZKTECO" as const;
  protected vendorLabel = "ZKTeco (PUSH protocol, port 4370)";
}

export class SupremaAdapter extends VendorSdkStubAdapter {
  readonly type = "SUPREMA" as const;
  protected vendorLabel = "Suprema (BioStar SDK)";
}
